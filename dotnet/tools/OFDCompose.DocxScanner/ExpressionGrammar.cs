using System.Globalization;

namespace OFDCompose.DocxScanner;

/// <summary>
/// Inventory-only parsing of the legacy NDocxTemplater expression grammar.
/// Never evaluates anything: pipelines are split and classified, paths are
/// broken into segments, and that is all.
/// </summary>
internal static class ExpressionGrammar
{
    public static readonly IReadOnlySet<string> KnownOperators = new HashSet<string>(StringComparer.Ordinal)
    {
        "sort",
        "take",
        "first",
        "last",
        "nth",
        "at",
        "get",
        "pick",
        "maxby",
        "minby",
        "count",
        "if",
        "format",
    };

    public static readonly IReadOnlySet<string> KnownFormatKinds = new HashSet<string>(StringComparer.Ordinal)
    {
        "number",
        "percent",
        "permille",
        "date",
    };

    public static readonly IReadOnlySet<string> KnownSymbologies = new HashSet<string>(StringComparer.Ordinal)
    {
        "code128",
        "code39",
        "code93",
        "codabar",
        "ean13",
        "ean8",
        "upca",
        "itf",
    };

    /// <summary>Splits an expression into path + pipeline operations. Mirrors legacy step splitting.</summary>
    public static PipelineModel? ParsePipeline(string expression)
    {
        var steps = expression
            .Split('|', StringSplitOptions.RemoveEmptyEntries)
            .Select(static step => step.Trim())
            .Where(static step => step.Length > 0)
            .ToList();
        if (steps.Count == 0)
        {
            return null;
        }

        var operations = new List<PipelineOperation>();
        foreach (var step in steps.Skip(1))
        {
            var colonIndex = step.IndexOf(':');
            if (colonIndex < 0)
            {
                operations.Add(new PipelineOperation(step.ToLowerInvariant(), []));
                continue;
            }

            var name = step.Substring(0, colonIndex).Trim().ToLowerInvariant();
            // Args are recorded verbatim (not trimmed, not re-joined): for get/pick/maxby/minby/format
            // the argument may itself contain ':' and the raw split is the honest inventory.
            var args = step.Substring(colonIndex + 1).Split(':').ToList();
            operations.Add(new PipelineOperation(name, args));
        }

        return new PipelineModel(steps[0], operations);
    }

    public static string CanonicalFormatKind(string rawKind)
    {
        return rawKind switch
        {
            "numeric" => "number",
            "percentage" => "percent",
            "per-mille" or "per_mille" => "permille",
            "datetime" or "time" => "date",
            _ => rawKind,
        };
    }

    /// <summary>Normalizes a barcode symbology name like legacy ParseBarcodeType.</summary>
    public static string NormalizeSymbology(string raw)
    {
        var normalized = raw.Trim().ToLowerInvariant().Replace("-", "").Replace("_", "").Replace(" ", "");
        return normalized == "interleaved2of5" ? "itf" : normalized;
    }

    public static bool PathContainsNegativeIndex(string path)
    {
        return path.Contains("[-", StringComparison.Ordinal);
    }

    /// <summary>
    /// Whether an expression is a plain path (no pipeline steps) and can therefore
    /// be looked up literally in a data sidecar. This is lookup, not evaluation.
    /// </summary>
    public static bool IsPlainPath(string expression)
    {
        return !expression.Contains('|');
    }

    public static bool TryParseNegativeAtArgument(PipelineOperation operation, out int index)
    {
        index = 0;
        if (!string.Equals(operation.Name, "at", StringComparison.Ordinal) || operation.Args.Count == 0)
        {
            return false;
        }

        return int.TryParse(
                   operation.Args[0].Trim(),
                   NumberStyles.Integer,
                   CultureInfo.InvariantCulture,
                   out index)
            && index < 0;
    }

    /// <summary>
    /// Plain property/index lookup into a JSON sidecar following legacy path rules
    /// (dot segments + [n] indices, ordinal case-sensitive property names).
    /// Returns false when the path is malformed or does not resolve.
    /// </summary>
    public static bool TryLookupPath(System.Text.Json.Nodes.JsonNode? root, string pathExpression, out System.Text.Json.Nodes.JsonNode? value)
    {
        value = null;
        if (root == null || string.IsNullOrWhiteSpace(pathExpression))
        {
            return false;
        }

        var path = pathExpression.Trim();
        if (path == "." || path == "$")
        {
            value = root;
            return true;
        }

        if (path.StartsWith("$.", StringComparison.Ordinal))
        {
            path = path.Substring(2);
        }

        var cursor = root;
        var index = 0;
        while (index < path.Length)
        {
            if (path[index] == '.')
            {
                index++;
                continue;
            }

            if (path[index] == '[')
            {
                var closing = path.IndexOf(']', index + 1);
                if (closing <= index + 1)
                {
                    return false;
                }

                var indexText = path.Substring(index + 1, closing - index - 1);
                if (!int.TryParse(indexText, NumberStyles.Integer, CultureInfo.InvariantCulture, out var itemIndex))
                {
                    return false;
                }

                if (itemIndex < 0 || cursor is not System.Text.Json.Nodes.JsonArray array || itemIndex >= array.Count)
                {
                    return false;
                }

                cursor = array[itemIndex]!;
                index = closing + 1;
                continue;
            }

            var start = index;
            while (index < path.Length && path[index] != '.' && path[index] != '[')
            {
                index++;
            }

            var name = path.Substring(start, index - start).Trim();
            if (name.Length == 0)
            {
                continue;
            }

            if (cursor is not System.Text.Json.Nodes.JsonObject obj || !obj.TryGetPropertyValue(name, out var next))
            {
                return false;
            }

            cursor = next!;
        }

        value = cursor;
        return true;
    }
}
