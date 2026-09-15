using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Json.Schema;
#if PDF_WRITER
using OFDCompose.PdfIrWriter;
using static OFDCompose.PdfIrWriter.J;
#else
using OFDCompose.OfdIrWriter;
using static OFDCompose.OfdIrWriter.J;
#endif

namespace OFDCompose.FixedWriting;

internal static class IrValidation
{
    private static readonly Lazy<JsonSchema> Schema = new(() =>
    {
        using var stream = typeof(IrValidation).Assembly.GetManifestResourceStream("canonical-layout-ir.schema.json")!;
        using var reader = new StreamReader(stream);
        return JsonSchema.FromText(reader.ReadToEnd());
    });
    internal static string Digest(ReadOnlySpan<byte> bytes) => Convert.ToHexStringLower(SHA256.HashData(bytes));
    internal static JsonDocument Parse(ReadOnlyMemory<byte> bytes, string digest, WriterLimits limits)
    {
        Require(bytes.Length <= limits.JsonBytes, "RESOURCE_LIMIT", "ir", "IR byte budget exceeded");
        bytes = bytes.ToArray();
        var scan = new Utf8JsonReader(bytes.Span, new JsonReaderOptions { MaxDepth = 64 });
        int tokens = 0, strings = 0;
        while (scan.Read())
        {
            Require(++tokens <= limits.JsonTokens, "RESOURCE_LIMIT", "ir", "JSON token budget exceeded");
            if (scan.TokenType is JsonTokenType.String or JsonTokenType.PropertyName)
            {
                strings = checked(strings + scan.ValueSpan.Length);
                Require(strings <= limits.StringBytes, "RESOURCE_LIMIT", "ir", "String budget exceeded");
            }
        }
        Require(Digest(bytes.Span) == digest, "IR_DIGEST_MISMATCH", "ir", "IR byte digest mismatch");
        var document = JsonDocument.Parse(bytes, new JsonDocumentOptions { MaxDepth = 64 });
        try
        {
            var ir = document.RootElement;
            Require(ir.ValueKind == JsonValueKind.Object && ir.Has("irVersion") && ir.S("irVersion") == "ofd-compose/layout-ir@0",
                "IR_VERSION_UNSUPPORTED", "irVersion", "Unsupported IR version");
            Require(Schema.Value.Evaluate(JsonNode.Parse(bytes.Span), new EvaluationOptions { OutputFormat = OutputFormat.Flag }).IsValid,
                "IR_SCHEMA", "ir", "Canonical Layout IR schema validation failed");
            Require(Encoding.UTF8.GetString(bytes.Span) == Canonical(ir), "IR_NON_CANONICAL", "ir", "Wire bytes must be canonical JSON");
            References(ir, limits);
            return document;
        }
        catch { document.Dispose(); throw; }
    }
    // Match the shared canonical serializer. Numbers are checked, never used to re-hash the transport.
    internal static string Canonical(JsonElement value, bool omitId = false) => value.ValueKind switch
    {
        JsonValueKind.Object => "{" + string.Join(",", value.EnumerateObject().Where(p => !omitId || p.Name != "id")
            .OrderBy(p => p.Name, StringComparer.Ordinal).Select(p => Quote(p.Name) + ":" + Canonical(p.Value))) + "}",
        JsonValueKind.Array => "[" + string.Join(",", value.EnumerateArray().Select(v => Canonical(v))) + "]",
        JsonValueKind.String => Quote(value.GetString()!),
        JsonValueKind.Number => Number(value.GetDouble()),
        JsonValueKind.True => "true", JsonValueKind.False => "false", JsonValueKind.Null => "null",
        _ => throw new WriterFailure("IR_SCHEMA", "ir", "Non-JSON value")
    };
    private static string Quote(string value)
    {
        var b = new StringBuilder("\"");
        foreach (char c in value) b.Append(c switch
        {
            '"' => "\\\"", '\\' => "\\\\", '\b' => "\\b", '\f' => "\\f", '\n' => "\\n", '\r' => "\\r", '\t' => "\\t",
            < ' ' => "\\u" + ((int)c).ToString("x4", CultureInfo.InvariantCulture), _ => c.ToString()
        });
        return b.Append('"').ToString();
    }
    internal static string Number(double number)
    {
        if (number == 0) return "0";
        string raw = number.ToString("R", CultureInfo.InvariantCulture);
        int e = raw.IndexOf('E');
        if (e < 0) return raw;
        var negative = raw[0] == '-';
        var mantissa = raw[..e].TrimStart('-');
        int decimalAt = mantissa.IndexOf('.');
        if (decimalAt < 0) decimalAt = mantissa.Length;
        int point = decimalAt + int.Parse(raw[(e + 1)..], CultureInfo.InvariantCulture);
        var digits = mantissa.Replace(".", "");
        return (negative ? "-" : "") + (point <= 0 ? "0." + new string('0', -point) + digits :
            point >= digits.Length ? digits + new string('0', point - digits.Length) : digits.Insert(point, "."));
    }
    private static void Unique(IEnumerable<string> ids, string path)
    {
        var seen = new HashSet<string>(StringComparer.Ordinal);
        foreach (string id in ids) Require(seen.Add(id), "IR_DUPLICATE_ID", path, "Duplicate identity");
    }
    private static void OrderedDefinitions(JsonElement list, string prefix, bool allowEqualContent = false)
    {
        string? previous = null;
        int index = 0;
        foreach (var item in list.EnumerateArray())
        {
            string content = Canonical(item, true);
            Require(item.S("id") == prefix + index++ && (previous is null || string.CompareOrdinal(previous, content) < 0 || allowEqualContent && string.CompareOrdinal(previous, content) == 0),
                "IR_NON_CANONICAL", prefix, "Definitions must be sorted and deduplicated");
            previous = content;
        }
    }
    private static void References(JsonElement ir, WriterLimits limits)
    {
        Require(ir.P("pages").GetArrayLength() <= limits.Pages && ir.P("resources").GetArrayLength() <= limits.Resources,
            "RESOURCE_LIMIT", "ir", "Page/resource count budget exceeded");
        long objectsCount = 0, glyphCount = 0, commands = 0;
        // Preflight expansion before dictionaries, membership arrays or output objects.
        foreach (var page in ir.A("pages")) foreach (var obj in page.A("objects"))
        {
            objectsCount++;
            if (obj.Has("glyphs")) glyphCount += obj.P("glyphs").GetArrayLength();
            if (obj.Has("commands")) commands += obj.P("commands").GetArrayLength();
            if (obj.Has("clip")) commands += obj.P("clip").P("commands").GetArrayLength();
        }
        foreach (var state in ir.A("graphicsStates")) if (state.Has("clip")) commands += state.P("clip").P("commands").GetArrayLength();
        Require(objectsCount <= limits.Objects && glyphCount <= limits.Glyphs && commands <= limits.Commands,
            "RESOURCE_LIMIT", "ir", "Object/glyph/path budget exceeded");
        var clipCounts = ir.A("graphicsStates").ToDictionary(s => s.S("id"), s => s.Has("clip") ? s.P("clip").P("commands").GetArrayLength() : 0);
        long expandedCommands = commands;
        foreach (var page in ir.A("pages")) foreach (var obj in page.A("objects"))
            if (clipCounts.TryGetValue(obj.S("stateId"), out int clips)) expandedCommands += clips;
        Require(expandedCommands <= limits.Commands, "RESOURCE_LIMIT", "clips", "Expanded clip command budget exceeded");
        OrderedDefinitions(ir.P("resources"), "r"); OrderedDefinitions(ir.P("graphicsStates"), "s");
        OrderedDefinitions(ir.P("markers"), "m", allowEqualContent: true);
        foreach(var state in ir.A("graphicsStates")) if(state.Has("clip")) PathCommands(state.P("clip"),state.S("id")+"/clip");
        var resources = ir.A("resources").ToDictionary(r => r.S("id"));
        var states = ir.A("graphicsStates").Select(s => s.S("id")).ToHashSet();
        var fontGlyphSets=resources.Values.Where(r=>r.S("kind")=="font"&&r.Has("glyphIdMap"))
            .ToDictionary(r=>r.S("id"),r=>r.A("glyphIdMap").Select(g=>g.N("original")).ToHashSet());
        var objects = new Dictionary<string, (JsonElement Object, JsonElement Page)>();
        var pages = new Dictionary<string, JsonElement>();
        int pageIndex = 0;
        foreach (var page in ir.A("pages"))
        {
            Require(page.I("pageIndex") == pageIndex && page.S("id") == "p" + pageIndex++, "IR_NON_CANONICAL", "pages", "Invalid page order/ID");
            pages.Add(page.S("id"), page);
            var box = page.P("contentBox");
            Require(box.N("x") >= 0 && box.N("y") >= 0 && box.N("x") + box.N("width") <= page.N("width") && box.N("y") + box.N("height") <= page.N("height"), "IR_PAGE_BOUNDS", page.S("id"), "Content outside page");
            int objectIndex = 0; double order = -1;
            foreach (var obj in page.A("objects"))
            {
                Require(obj.S("id") == page.S("id") + "o" + objectIndex++ && obj.N("drawOrder") > order, "IR_NON_CANONICAL", page.S("id"), "Invalid object order/ID");
                order = obj.N("drawOrder"); objects.Add(obj.S("id"), (obj, page));
                Require(states.Contains(obj.S("stateId")), "IR_REFERENCE", obj.S("id"), "Missing state");
                if(obj.S("kind")=="path")PathCommands(obj,obj.S("id"));
                if(obj.Has("clip"))PathCommands(obj.P("clip"),obj.S("id")+"/clip");
                if (obj.S("kind") == "text")
                {
                    Require(resources.TryGetValue(obj.S("fontId"), out var font) && font.S("kind") == "font", "IR_REFERENCE", obj.S("id"), "Missing font");
                    Text(obj);
                    if (fontGlyphSets.TryGetValue(font.S("id"),out var map))
                    {
                        foreach (var glyph in obj.A("glyphs")) Require(map.Contains(glyph.N("glyphId")), "IR_RESOURCE", obj.S("id"), "Unmapped glyph");
                    }
                }
                else if (obj.S("kind") == "image") Require(resources.TryGetValue(obj.S("resourceId"), out var image) && image.S("kind") == "image", "IR_REFERENCE", obj.S("id"), "Missing image");
            }
        }
        foreach (var r in resources.Values.Where(r => r.S("kind") == "font" && r.Has("glyphIdMap")))
        {
            Require(r.Has("subsetDigest"), "IR_RESOURCE", r.S("id"), "Map requires subset digest");
            double previous = -1; var subsets = new HashSet<double>();
            foreach (var m in r.A("glyphIdMap"))
            {
                Require(m.N("original") > previous && subsets.Add(m.N("subset")), "IR_RESOURCE", r.S("id"), "Invalid subset map"); previous = m.N("original");
            }
        }
        Unique(ir.A("semantics").Select(s => s.S("objectId")), "semantics");
        double reading = -1;
        foreach (var sem in ir.A("semantics"))
        {
            Require(sem.N("readingOrder") > reading, "IR_NON_CANONICAL", "semantics", "Invalid reading order"); reading = sem.N("readingOrder");
            Require(objects.TryGetValue(sem.S("objectId"), out var target), "IR_REFERENCE", "semantics", "Missing semantic target");
            foreach (string field in new[] { "pageIndex", "sectionId", "sectionSourceId" }) if (sem.Has(field))
            {
                string pageField = field == "sectionSourceId" && !target.Page.Has(field) ? "sectionId" : field;
                Require(Canonical(sem.P(field)) == Canonical(target.Page.P(pageField)), "IR_REFERENCE", "semantics", "Page/section mismatch");
            }
            if (sem.Has("sourceText")) Source(sem.P("sourceText"));
            if (sem.Has("sourceRanges")) foreach (var source in sem.A("sourceRanges"))
            {
                Require(target.Object.S("kind") == "text", "IR_REFERENCE", "sourceRanges", "Text target required");
                Source(source.P("sourceText")); Range(target.Object.S("logicalText"), source.P("logicalRange"));
            }
        }
        foreach (var marker in ir.A("markers")) Require(pages.ContainsKey(marker.S("pageId")) && (!marker.Has("objectId") || objects.TryGetValue(marker.S("objectId"), out var target) && target.Page.S("id") == marker.S("pageId")), "IR_REFERENCE", marker.S("id"), "Invalid marker target");
        var features = ir.P("identity").P("layoutProfile").A("features").Select(f => f.GetString()!).ToArray();
        Require(features.SequenceEqual(features.Order(StringComparer.Ordinal)), "IR_NON_CANONICAL", "features", "Features must be sorted");
        Require(Digest(Encoding.UTF8.GetBytes(ir.P("semantics").GetRawText())) == ir.P("identity").S("semanticDigest"), "IR_DIGEST_MISMATCH", "semantics", "Semantic digest mismatch");
    }
    private static void PathCommands(JsonElement path,string location)
    {
        bool open=false;
        foreach(var command in path.A("commands"))
        {
            string operation=command.S("op");
            if(operation=="move")open=true;
            else Require(open,"IR_PATH_INVALID",location,"Path command requires an open subpath");
            if(operation=="close")open=false;
        }
    }
    private static void Source(JsonElement source) => Range(source.S("text"), source.P("range"));
    private static void Range(string text, JsonElement range)
    {
        double a = range.N("start"), b = range.N("end");
        Require(a <= b && b <= text.Length, "IR_TEXT_RANGE", "range", "Invalid UTF-16 range");
        foreach (int i in new[] { (int)a, (int)b }) Require(i == 0 || i == text.Length || !char.IsHighSurrogate(text[i - 1]) || !char.IsLowSurrogate(text[i]), "IR_TEXT_RANGE", "range", "Split surrogate pair");
    }
    private static void Text(JsonElement obj)
    {
        string logical = obj.S("logicalText"), display = obj.S("displayText");
        var glyphs = obj.P("glyphs"); var seen = new bool[glyphs.GetArrayLength()];
        int next = 0, id = 0, count = 0;
        foreach (var c in obj.A("clusters"))
        {
            Range(logical, c.P("logicalRange")); Range(display, c.P("displayRange"));
            Require(c.I("clusterId") == id++ && c.P("displayRange").I("start") == next && c.P("displayRange").I("end") > next, "IR_CLUSTER_MAP", obj.S("id"), "Invalid cluster partition");
            next = c.P("displayRange").I("end"); int previous = -1;
            foreach (var index in c.A("glyphIndices"))
            {
                double n = index.GetDouble(); Require(n > previous && n < seen.Length, "IR_CLUSTER_MAP", obj.S("id"), "Invalid glyph index");
                int i = (int)n; Require(!seen[i] && glyphs[i].N("clusterId") == c.N("clusterId"), "IR_CLUSTER_MAP", obj.S("id"), "Invalid glyph membership"); seen[i] = true; previous = i; count++;
            }
        }
        Require(next == display.Length && count == seen.Length, "IR_CLUSTER_MAP", obj.S("id"), "Unmapped text/glyph");
    }
}
