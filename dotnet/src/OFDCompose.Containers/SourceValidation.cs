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
    internal static JsonDocument Parse(ReadOnlyMemory<byte> bytes, ContainerBudget budget)
    {
        var document = SafePackage.Json(bytes, budget);
        try
        {
            budget.Charge(bytes.Length * 8L);
            Need(Schema.Value.Evaluate(JsonNode.Parse(bytes.Span), new EvaluationOptions { OutputFormat = OutputFormat.Flag }).IsValid, "SCHEMA_INVALID");
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
            return document;
        }
        catch { document.Dispose(); throw; }
    }
    private static void Visit(JsonElement value, HashSet<string> styles, ContainerBudget budget)
    {
        budget.Charge(32);
        if (value.ValueKind == JsonValueKind.Array) foreach (var child in value.EnumerateArray()) Visit(child, styles, budget);
        if (value.ValueKind != JsonValueKind.Object) return;
        foreach (var property in value.EnumerateObject())
        {
            if (property.Name == "styleId") styles.Add(property.Value.GetString()!);
            if (property.Name == "expression") Need(property.Value.GetString() == "", "SOURCE_NOT_MINIMAL");
            Need(property.Name != "path", "RESOURCE_FORBIDDEN");
            Visit(property.Value, styles, budget);
        }
    }
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
