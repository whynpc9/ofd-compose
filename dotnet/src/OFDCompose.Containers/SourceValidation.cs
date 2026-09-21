using Json.Schema;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using static OFDCompose.Containers.ContainerBudget;

namespace OFDCompose.Containers;
internal static class SourceValidation
{
    private static readonly Lazy<JsonSchema> Schema = new(() => {
        using var stream = typeof(SourceValidation).Assembly.GetManifestResourceStream("source-content.schema.json")!;
        using var reader = new StreamReader(stream);
        return JsonSchema.FromText(reader.ReadToEnd());
    });
    private static readonly Lazy<JsonSchema> ReplaySchema = new(() => {
        using var stream=typeof(SourceValidation).Assembly.GetManifestResourceStream("replay-identity.schema.json")!;
        using var reader=new StreamReader(stream);return JsonSchema.FromText(reader.ReadToEnd());
    });
    internal static SourceReplayIdentity ParseReplayIdentity(JsonElement value,int containingJsonBytes,ContainerBudget budget)
    {
        budget.Charge(containingJsonBytes*8L+8192);string json=value.GetRawText();Need(json.Length<=1024,"SIZE_LIMIT");
        Need(ReplaySchema.Value.Evaluate(JsonNode.Parse(json),new EvaluationOptions {OutputFormat=OutputFormat.Flag}).IsValid,"SCHEMA_INVALID");budget.Charge(0);
        return new(Text(value,"version"),Text(value,"irDigest"));
    }
    internal static JsonDocument Parse(ReadOnlyMemory<byte> bytes, ContainerBudget budget)
    {
        var document = SafePackage.Json(bytes, budget);
        try
        {
            budget.Charge(bytes.Length * 8L);
            Need(Schema.Value.Evaluate(JsonNode.Parse(document.RootElement.GetRawText()), new EvaluationOptions { OutputFormat = OutputFormat.Flag }).IsValid, "SCHEMA_INVALID");
            budget.Charge(0);
            var resolved = document.RootElement.GetProperty("resolvedDocument");
            Need(!resolved.TryGetProperty("provenance", out _) && resolved.GetProperty("structure").GetProperty("conditionals").GetArrayLength() == 0
                && resolved.GetProperty("structure").GetProperty("repeats").GetArrayLength() == 0, "SOURCE_NOT_MINIMAL");
            var runtime = resolved.GetProperty("runtime");
            Need(Text(runtime,"temporalPolyfillVersion") == "not-retained" && runtime.GetProperty("tzdataVersion").ValueKind == JsonValueKind.Null, "SOURCE_NOT_MINIMAL");
            var styleIds = new HashSet<string>();
            Visit(resolved.GetProperty("body"), styleIds, budget);
            Visit(resolved.GetProperty("settings"), styleIds, budget);
            Need(resolved.GetProperty("styles").EnumerateObject().All(p => styleIds.Contains(p.Name)), "SOURCE_NOT_MINIMAL");
            foreach(var style in resolved.GetProperty("styles").EnumerateObject())Visit(style.Value,styleIds,budget);
            Visit(document.RootElement.GetProperty("renderProfile").GetProperty("layout").GetProperty("defaultStyle"),styleIds,budget);
            foreach(var entry in document.RootElement.GetProperty("semanticMap").GetProperty("entries").EnumerateArray())
            {
                budget.Charge(64);
                Need(!entry.TryGetProperty("link",out _),"SOURCE_NOT_MINIMAL");
                if(entry.TryGetProperty("repeatInstance",out var instances))foreach(var frame in instances.EnumerateArray()){budget.Charge(64);Need(OpaqueRepeatKey(Text(frame,"key")),"SOURCE_NOT_MINIMAL");}
                if(entry.TryGetProperty("sectionId",out var section))Need(!section.GetString()!.StartsWith("@section:",StringComparison.Ordinal)&&!section.GetString()!.StartsWith("@@section:",StringComparison.Ordinal),"SOURCE_NOT_MINIMAL");
            }
            return document;
        }
        catch { document.Dispose(); throw; }
    }
    private static void Visit(JsonElement value, HashSet<string> styles, ContainerBudget budget)
    {
        budget.Charge(32);
        if (value.ValueKind == JsonValueKind.Array) foreach (var child in value.EnumerateArray()) Visit(child, styles, budget);
        if (value.ValueKind != JsonValueKind.Object) return;
        if(value.TryGetProperty("kind",out var kind)&&kind.ValueEquals("input-control"))
            Need(!value.TryGetProperty("options",out _)&&!value.TryGetProperty("required",out _)&&!(value.TryGetProperty("defaultValue",out _)&&value.TryGetProperty("placeholder",out _)),"SOURCE_NOT_MINIMAL");
        foreach (var property in value.EnumerateObject())
        {
            if (property.Name == "styleId") styles.Add(property.Value.GetString()!);
            if (property.Name == "valueState") Need(property.Value.GetString() == "value", "SOURCE_NOT_MINIMAL");
            if (property.Name == "instancePath")
                foreach(var frame in property.Value.EnumerateArray())
                {
                    budget.Charge(64);
                    string key=Text(frame,"key");
                    Need(OpaqueRepeatKey(key)&&Text(frame,"keyKind")=="ordinal","SOURCE_NOT_MINIMAL");
                }
            if (property.Name == "expression") Need(property.Value.GetString() == "", "SOURCE_NOT_MINIMAL");
            Need(property.Name is not "dataPath" and not "link", "SOURCE_NOT_MINIMAL");
            Need(property.Name != "path", "RESOURCE_FORBIDDEN");
            Visit(property.Value, styles, budget);
        }
    }
    private static bool OpaqueRepeatKey(string key)=>key.StartsWith("instance-",StringComparison.Ordinal)&&uint.TryParse(key.AsSpan(9),System.Globalization.NumberStyles.None,System.Globalization.CultureInfo.InvariantCulture,out uint ordinal)&&key=="instance-"+ordinal.ToString(System.Globalization.CultureInfo.InvariantCulture);
    internal static byte[] Bytes(JsonElement value, ContainerBudget budget)
    {
        budget.Charge(value.GetRawText().Length * 6L);
        return Encoding.UTF8.GetBytes(value.GetRawText());
    }
    internal static void Keys(JsonElement value, params string[] keys)
    {
        Need(value.ValueKind == JsonValueKind.Object, "SCHEMA_INVALID");
        var actual = value.EnumerateObject().Select(p => p.Name).ToArray();
        Need(actual.Length == keys.Length && actual.All(keys.Contains), "SCHEMA_INVALID");
    }
    internal static string Text(JsonElement value, string key) => value.GetProperty(key).GetString() ?? throw new ContainerFailure("SCHEMA_INVALID");
    internal static bool IsDigest(string value) => value.Length == 64 && value.All(c => c is >= '0' and <= '9' or >= 'a' and <= 'f');
}
