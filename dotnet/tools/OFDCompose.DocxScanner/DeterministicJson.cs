using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.Json.Serialization.Metadata;

namespace OFDCompose.DocxScanner;

/// <summary>
/// Deterministic JSON writer. Layout mirrors the repo's Biome JSON formatter
/// (2-space indent, 100-column fit-or-expand) so generated reports stay
/// <c>biome check</c>-clean and byte-reproducible. No timestamps, stable ordering.
/// </summary>
internal static class DeterministicJson
{
    private const int MaxLineWidth = 100;
    private const int IndentSize = 2;

    private static readonly JsonSerializerOptions ValueOptions = new()
    {
        Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
    };

    public static string Serialize<T>(T value, JsonTypeInfo<T> typeInfo)
    {
        var node = JsonSerializer.SerializeToNode(value, typeInfo);
        var builder = new System.Text.StringBuilder();
        WriteNode(node, builder, 0);
        builder.Append('\n');
        return builder.ToString();
    }

    public static void WriteFile<T>(string path, T value, JsonTypeInfo<T> typeInfo)
    {
        var directory = Path.GetDirectoryName(Path.GetFullPath(path));
        if (!string.IsNullOrEmpty(directory))
        {
            Directory.CreateDirectory(directory);
        }

        File.WriteAllText(path, Serialize(value, typeInfo));
    }

    private static void WriteNode(JsonNode? node, System.Text.StringBuilder builder, int indent, int firstLinePrefix = 0, int firstLineSuffix = 0)
    {
        switch (node)
        {
            case null:
                builder.Append("null");
                break;
            case JsonValue value:
                builder.Append(value.ToJsonString(ValueOptions));
                break;
            case JsonObject obj:
                if (obj.Count == 0)
                {
                    builder.Append("{}");
                    break;
                }

                var inlineObject = RenderInline(obj);
                if (indent * IndentSize + firstLinePrefix + inlineObject.Length + firstLineSuffix <= MaxLineWidth)
                {
                    builder.Append(inlineObject);
                    break;
                }

                builder.Append("{\n");
                var propertyIndex = 0;
                foreach (var property in obj)
                {
                    if (propertyIndex > 0)
                    {
                        builder.Append(",\n");
                    }

                    AppendIndent(builder, indent + 1);
                    var key = JsonSerializer.Serialize(property.Key, ValueOptions);
                    builder.Append(key);
                    builder.Append(": ");
                    var isLast = propertyIndex == obj.Count - 1;
                    WriteNode(property.Value, builder, indent + 1, key.Length + 2, isLast ? 0 : 1);
                    propertyIndex++;
                }

                builder.Append('\n');
                AppendIndent(builder, indent);
                builder.Append('}');
                break;
            case JsonArray array:
                if (array.Count == 0)
                {
                    builder.Append("[]");
                    break;
                }

                var inlineArray = RenderInline(array);
                if (indent * IndentSize + firstLinePrefix + inlineArray.Length + firstLineSuffix <= MaxLineWidth)
                {
                    builder.Append(inlineArray);
                    break;
                }

                builder.Append("[\n");
                for (var index = 0; index < array.Count; index++)
                {
                    if (index > 0)
                    {
                        builder.Append(",\n");
                    }

                    AppendIndent(builder, indent + 1);
                    WriteNode(array[index], builder, indent + 1, 0, index == array.Count - 1 ? 0 : 1);
                }

                builder.Append('\n');
                AppendIndent(builder, indent);
                builder.Append(']');
                break;
            default:
                throw new InvalidOperationException($"Unsupported JSON node kind: {node.GetType().Name}.");
        }
    }

    private static string RenderInline(JsonNode? node)
    {
        switch (node)
        {
            case null:
                return "null";
            case JsonValue value:
                return value.ToJsonString(ValueOptions);
            case JsonObject obj:
                if (obj.Count == 0)
                {
                    return "{}";
                }

                // Biome pads inline object braces: { "a": 1 } (arrays stay unpadded).
                return "{ "
                    + string.Join(
                        ", ",
                        obj.Select(property =>
                            JsonSerializer.Serialize(property.Key, ValueOptions)
                            + ": "
                            + RenderInline(property.Value)))
                    + " }";
            case JsonArray array:
                if (array.Count == 0)
                {
                    return "[]";
                }

                return "[" + string.Join(", ", array.Select(RenderInline)) + "]";
            default:
                throw new InvalidOperationException($"Unsupported JSON node kind: {node.GetType().Name}.");
        }
    }

    private static void AppendIndent(System.Text.StringBuilder builder, int indent)
    {
        builder.Append(' ', indent * IndentSize);
    }
}
