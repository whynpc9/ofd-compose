using OFDCompose.FixedWriting;
using System.Text.Json;
using System.Xml;
using System.Xml.Linq;
using Ofdrw.Net.Core.Models;
using Ofdrw.Net.Packaging;
using static OFDCompose.OfdIrWriter.J;

namespace OFDCompose.OfdIrWriter;

/// <summary>Fixed primitives only. Never shapes, measures, paginates or subsets.</summary>
public sealed class OfdIrWriter
{
    private static readonly XNamespace Ns = "http://www.ofdspec.org/2016";
    public async Task<OfdWriteResult> WriteAsync(ReadOnlyMemory<byte> canonicalIr, string irDigest,
        IReadOnlyList<WriterResource> resources, WriterLimits? limits = null, CancellationToken cancellationToken = default)
    {
        limits ??= new WriterLimits();
        try
        {
            cancellationToken.ThrowIfCancellationRequested();
            limits.Validate();
            using var document = IrValidation.Parse(canonicalIr, irDigest, limits);
            var ir = document.RootElement;
            long entryReservation=3L+ir.P("pages").GetArrayLength()+ir.P("resources").GetArrayLength()+(ir.A("resources").Any(r=>r.S("kind")=="image")?1:0);
            Require(entryReservation<=limits.ZipEntries,"RESOURCE_LIMIT","output","ZIP entry reservation exceeded");
            var bytes = ResourceValidation.Validate(ir, resources, limits);
            // Reserve conservative XML/object expansion and package copies before allocating output models.
            long estimate = canonicalIr.Length * 8L + bytes.Values.Sum(b => (long)b.Length) * 2 + 65536;
            var clipSizes = ir.A("graphicsStates").ToDictionary(s => s.S("id"), s => s.Has("clip") ? s.P("clip").GetRawText().Length : 0);
            foreach (var page in ir.A("pages")) foreach (var obj in page.A("objects")) estimate += 2048L + clipSizes[obj.S("stateId")] * 8L;
            Require(estimate <= limits.OutputBytes, "RESOURCE_LIMIT", "output", "Output reservation exceeded");
            var package = new OfdDocumentPackage();
            package.Options.Namespace = Ns.NamespaceName;
            package.Options.DocType = "OFD";
            package.Options.Metadata.Creator = "OFDCompose.OfdIrWriter/0";
            var states = ir.A("graphicsStates").ToDictionary(s => s.S("id"));
            var descriptors = ir.A("resources").ToDictionary(r => r.S("id"));
            var fontMaps=descriptors.Values.Where(r=>r.S("kind")=="font"&&r.Has("glyphIdMap"))
                .ToDictionary(r=>r.S("id"),r=> (IReadOnlyDictionary<double,double>)r.A("glyphIdMap").ToDictionary(g=>g.N("original"),g=>g.N("subset")));
            int nextId = 1;
            string Id() => (nextId++).ToString(System.Globalization.CultureInfo.InvariantCulture);
            var resourceIds = descriptors.Keys.ToDictionary(key => key, _ => Id());
            foreach (var resource in descriptors.Values.Where(r => r.S("kind") == "font"))
                package.Fonts.Add(new OfdFontResource
                {
                    Id = resourceIds[resource.S("id")], FontName = "Subset-" + resource.S("subsetDigest"),
                    FileName = resource.S("subsetDigest") + (bytes[resource.S("id")].AsSpan().StartsWith("OTTO"u8) ? ".otf" : ".ttf"),
                    Data = bytes[resource.S("id")]
                });
            var map = new Dictionary<string, string[]>();
            var preciseMatrices = new Dictionary<string, string>();
            var logicalTexts = new Dictionary<string, string>();
            foreach (var page in ir.A("pages"))
            {
                cancellationToken.ThrowIfCancellationRequested();
                var output = new OfdPage { Id = Id(), Index = page.I("pageIndex"), WidthMillimeters = Mm(page.N("width")), HeightMillimeters = Mm(page.N("height")) };
                string layerId = Id();
                package.Pages.Add(output);
                foreach (var item in page.A("objects"))
                {
                    var state = states[item.S("stateId")];
                    string objectId = Id();
                    var matrix = Matrix(state.P("transform"));
                    var element = item.S("kind") switch
                    {
                        "text" => Text(item, state, page, fontMaps.GetValueOrDefault(item.S("fontId")), resourceIds[item.S("fontId")], matrix),
                        "path" => Path(item, state, page, matrix),
                        "image" => Image(item, state, page, descriptors[item.S("resourceId")], resourceIds[item.S("resourceId")], bytes[item.S("resourceId")], matrix),
                        _ => throw new WriterFailure("UNSUPPORTED_FEATURE", item.S("id"), "Unsupported primitive")
                    };
                    var exactMatrix = element switch { OfdImageElement image => image.Transform, OfdPathElement path => path.Transform, _ => null };
                    if(exactMatrix is not null) preciseMatrices.Add(objectId, string.Join(" ", exactMatrix.Select(F)));
                    if(element is OfdTextElement text) logicalTexts.Add(objectId, text.Text);
                    element.ObjectId = objectId; element.LayerId = layerId;
                    output.Elements.Add(element); map.Add(item.S("id"), [objectId]);
                }
            }
            using var destination = new LimitedStream(limits.OutputBytes);
            await new OfdPackageWriter().WriteAsync(package, destination, cancellationToken);
            return new(PackageFinalizer.Complete(destination.ToArray(), irDigest, map, preciseMatrices, logicalTexts, limits), map, []) { ResourceMap=resourceIds };
        }
        catch (WriterFailure failure) { return new(null, null, [failure.Diagnostic]); }
        catch (NotSupportedException) { return new(null, null, [new("UNSUPPORTED_FEATURE", "resource", "Resource decoder does not support this variant")]); }
        catch (Exception error) when (error is JsonException or InvalidOperationException or ArgumentException or XmlException or InvalidDataException or OverflowException or FormatException or EndOfStreamException or IndexOutOfRangeException)
        { return new(null, null, [new("IR_RESOURCE", "input", "Invalid IR or resource: " + error.GetType().Name)]); }
    }
    private static OfdElement Text(JsonElement item, JsonElement state, JsonElement page, IReadOnlyDictionary<double,double>? mapping, string fontId, double[] matrix)
    {
        string logical = item.S("logicalText");
        try { XmlConvert.VerifyXmlChars(logical); }
        catch(XmlException) { throw new WriterFailure("UNSUPPORTED_FEATURE",item.S("id"),"Logical text contains characters XML 1.0 cannot represent"); }
        var glyphs = item.A("glyphs").ToArray();
        Require(logical.Length > 0 || glyphs.Length == 0, "UNSUPPORTED_FEATURE", item.S("id"), "Painted glyphs with empty logical text have no OFD character mapping");
        var xml = Graphic("TextObject", state, page, matrix);
        xml.Add(new XAttribute("Font", fontId), new XAttribute("Size", F(Mm(item.N("fontSize")))),
            new XAttribute("Fill", glyphs.Length == 0 ? "false" : "true"), new XAttribute("Stroke", "false"));
        if (glyphs.Length > 0)
        {
            XElement Map(int start, int count, IEnumerable<JsonElement> mappedGlyphs)
            {
                var group = mappedGlyphs.ToArray();
                return new XElement(Ns + "CGTransform", new XAttribute("CodePosition", start), new XAttribute("CodeCount", count),
                    new XAttribute("GlyphCount", group.Length), new XElement(Ns + "Glyphs", string.Join(" ", group.Select(g => F(mapping is null ? g.N("glyphId") : mapping[g.N("glyphId")])))));
            }
            // This profile emits exact cluster mappings in the supplied visual glyph order.
            int logicalEnd = 0, glyphEnd = 0;
            bool partition = true;
            foreach(var cluster in item.A("clusters"))
            {
                var range = cluster.P("logicalRange");
                partition &= range.I("start") == logicalEnd && range.I("end") > logicalEnd;
                logicalEnd = range.I("end");
                foreach(var index in cluster.A("glyphIndices")) partition &= index.GetInt32() == glyphEnd++;
            }
            partition &= logicalEnd == logical.Length && glyphEnd == glyphs.Length;
            Require(partition,"UNSUPPORTED_FEATURE",item.S("id"),"OFD profile requires an ordered, nonoverlapping logical cluster partition");
            foreach(var cluster in item.A("clusters"))
            {
                var range = cluster.P("logicalRange");
                xml.Add(Map(range.I("start"), range.I("end")-range.I("start"), cluster.A("glyphIndices").Select(i => glyphs[i.GetInt32()])));
            }
        }
        double X(JsonElement g) => Mm(g.P("position").N("x") + g.P("offset").N("x"));
        double Y(JsonElement g) => Mm(g.P("position").N("y") + g.P("offset").N("y"));
        var code = new XElement(Ns + "TextCode", new XAttribute("X", F(glyphs.Length == 0 ? Mm(item.P("baseline").N("x")) : X(glyphs[0]))),
            new XAttribute("Y", F(glyphs.Length == 0 ? Mm(item.P("baseline").N("y")) : Y(glyphs[0]))));
        if (glyphs.Length > 1)
        {
            code.Add(new XAttribute("DeltaX", string.Join(" ", Enumerable.Range(1, glyphs.Length - 1).Select(i => F(X(glyphs[i]) - X(glyphs[i - 1]))))),
                new XAttribute("DeltaY", string.Join(" ", Enumerable.Range(1, glyphs.Length - 1).Select(i => F(Y(glyphs[i]) - Y(glyphs[i - 1]))))));
        }
        code.Add(new XText(logical)); xml.Add(code);
        return new OfdTextElement { FontResourceId = fontId, SourceXml = xml.ToString(SaveOptions.DisableFormatting), Text = logical };
    }
    private static OfdElement Path(JsonElement item, JsonElement state, JsonElement page, double[] matrix)
    {
        var xml = Graphic("PathObject", state, page, item.S("coordinateSpace") == "page" ? [1, 0, 0, 1, 0, 0] : matrix);
        xml.Add(new XAttribute("Fill", item.P("fill").GetBoolean() ? "true" : "false"), new XAttribute("Stroke", item.P("stroke").GetBoolean() ? "true" : "false"),
            new XAttribute("Rule", Rule(item)), new XElement(Ns + "AbbreviatedData", Commands(item)));
        return new OfdPathElement { SourceXml = xml.ToString(SaveOptions.DisableFormatting),
            WidthMillimeters = Mm(page.N("width")), HeightMillimeters = Mm(page.N("height")),
            Transform = item.S("coordinateSpace") == "page" ? [1, 0, 0, 1, 0, 0] : matrix,
            LineWidthMillimeters = Mm(state.N("lineWidth")), Fill = item.P("fill").GetBoolean(), Stroke = item.P("stroke").GetBoolean(),
            FillColor = ModelColor(state.P("fillColor")), StrokeColor = ModelColor(state.P("strokeColor")), AbbreviatedData = Commands(item) };
    }
    private static OfdElement Image(JsonElement item, JsonElement state, JsonElement page, JsonElement resource, string resourceId, byte[] data, double[] stateMatrix)
    {
        var pixelMatrix = Matrix(item.P("transform"));
        var combined = Multiply(stateMatrix, pixelMatrix);
        var unitMatrix = Multiply(combined, [resource.I("pixelWidth"), 0, 0, resource.I("pixelHeight"), 0, 0]);
        var xml = Graphic("ImageObject", state, page, unitMatrix);
        xml.Add(new XAttribute("ResourceID", resourceId));
        if (item.Has("clip"))
        {
            var clips = xml.Element(Ns + "Clips");
            if (clips is null) { clips = new XElement(Ns + "Clips"); xml.Add(clips); }
            clips.Add(Clip(item.P("clip"), combined));
        }
        return new OfdImageElement { SourceXml = xml.ToString(SaveOptions.DisableFormatting), ResourceId = resourceId,
            WidthMillimeters = Mm(page.N("width")), HeightMillimeters = Mm(page.N("height")), Transform = unitMatrix,
            Alpha = (int)Math.Round(state.N("opacity") * 255, MidpointRounding.AwayFromZero), ClipsXml = xml.Element(Ns + "Clips")?.ToString(SaveOptions.DisableFormatting),
            MediaType = resource.S("mimeType"), FileName = resource.S("digest") + (resource.S("mimeType") == "image/png" ? ".png" : ".jpg"), Data = data };
    }
    private static XElement Graphic(string name, JsonElement state, JsonElement page, double[] transform)
    {
        var xml = new XElement(Ns + name, new XAttribute("ID", "0"), new XAttribute("Boundary", $"0 0 {F(Mm(page.N("width")))} {F(Mm(page.N("height")))}"),
            new XAttribute("CTM", string.Join(" ", transform.Select(F))), new XAttribute("Alpha", (int)Math.Round(state.N("opacity") * 255, MidpointRounding.AwayFromZero)));
        if (name != "ImageObject")
        {
            xml.Add(new XAttribute("LineWidth", F(Mm(state.N("lineWidth")))), new XAttribute("Cap", state.S("lineCap") switch { "round" => "Round", "square" => "Square", _ => "Butt" }),
                new XAttribute("Join", state.S("lineJoin") switch { "round" => "Round", "bevel" => "Bevel", _ => "Miter" }), new XAttribute("MiterLimit", F(state.N("miterLimit"))));
            if (state.P("dash").GetArrayLength() > 0) xml.Add(new XAttribute("DashPattern", string.Join(" ", state.A("dash").Select(n => F(Mm(n.GetDouble()))))), new XAttribute("DashOffset", F(Mm(state.N("dashOffset")))));
            xml.Add(Color("FillColor", state.P("fillColor")), Color("StrokeColor", state.P("strokeColor")));
        }
        if (state.Has("clip")) xml.Add(new XElement(Ns + "Clips", Clip(state.P("clip"), Matrix(state.P("transform")))));
        return xml;
    }
    private static OfdColor ModelColor(JsonElement color) => new((int)Math.Round(color.N("r") * 255, MidpointRounding.AwayFromZero), (int)Math.Round(color.N("g") * 255, MidpointRounding.AwayFromZero), (int)Math.Round(color.N("b") * 255, MidpointRounding.AwayFromZero));
    private static XElement Color(string name, JsonElement color) => new(Ns + name, new XAttribute("Value", string.Join(" ", new[] { "r", "g", "b" }.Select(c => F(Math.Round(color.N(c) * 255, MidpointRounding.AwayFromZero))))));
    private static string Rule(JsonElement path) => path.S("fillRule") == "evenodd" ? "Even-Odd" : "NonZero";
    private static XElement Clip(JsonElement clip, double[] transform) => new(Ns + "Clip", new XElement(Ns + "Area", new XAttribute("CTM", string.Join(" ", transform.Select(F))),
        new XElement(Ns + "Path", new XAttribute("Stroke", "false"), new XAttribute("Fill", "true"), new XAttribute("Rule", Rule(clip)), new XElement(Ns + "AbbreviatedData", Commands(clip)))));
    private static string Commands(JsonElement item) => string.Join(" ", item.A("commands").Select(c => c.S("op") switch
    {
        "move" => $"M {F(Mm(c.N("x")))} {F(Mm(c.N("y")))}", "line" => $"L {F(Mm(c.N("x")))} {F(Mm(c.N("y")))}",
        "cubic" => $"B {F(Mm(c.N("x1")))} {F(Mm(c.N("y1")))} {F(Mm(c.N("x2")))} {F(Mm(c.N("y2")))} {F(Mm(c.N("x")))} {F(Mm(c.N("y")))}",
        "close" => "C", _ => throw new WriterFailure("UNSUPPORTED_FEATURE", "path", "Unknown path command")
    }));
    private static double Mm(double value) => value / 1000;
    private static string F(double value) => IrValidation.Number(value);
    private static double[] Matrix(JsonElement matrix) => [matrix.N("a"), matrix.N("b"), matrix.N("c"), matrix.N("d"), Mm(matrix.N("e")), Mm(matrix.N("f"))];
    private static double[] Multiply(double[] a, double[] b) => [a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1], a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3], a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]];
    private sealed class LimitedStream(int limit) : MemoryStream
    {
        public override void Write(byte[] buffer, int offset, int count) { Check(count); base.Write(buffer, offset, count); }
        public override void Write(ReadOnlySpan<byte> buffer) { Check(buffer.Length); base.Write(buffer); }
        public override ValueTask WriteAsync(ReadOnlyMemory<byte> buffer, CancellationToken token = default) { Check(buffer.Length); return base.WriteAsync(buffer, token); }
        public override Task WriteAsync(byte[] buffer, int offset, int count, CancellationToken token) { Check(count); return base.WriteAsync(buffer, offset, count, token); }
        private void Check(int count) => Require(Position + count <= limit, "RESOURCE_LIMIT", "output", "Output size exceeded");
    }
}
