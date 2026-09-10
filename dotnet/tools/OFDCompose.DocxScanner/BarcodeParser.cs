using System.Globalization;

namespace OFDCompose.DocxScanner;

internal sealed record BarcodeParseResult(
    string ValueExpression,
    string Symbology,
    BarcodeParameters Parameters,
    IReadOnlyList<(string Code, string Message)> Warnings);

/// <summary>
/// Inventory-only parse of legacy barcode parameter syntax
/// (<c>barcode:&lt;valueExpr&gt;;&lt;key&gt;=&lt;value&gt;;...</c>). Never throws; every legacy
/// render-time failure becomes a warning diagnostic.
/// </summary>
internal static class BarcodeParser
{
    public const int DefaultWidth = 320;
    public const int DefaultHeight = 96;
    public const int DefaultMargin = 2;
    public const bool DefaultPure = true;
    public const string DefaultSymbology = "code128";

    public static BarcodeParseResult Parse(string remainder)
    {
        // remainder is the token after %-stripping and starts with "barcode:" (case-insensitive).
        var body = remainder.Substring("barcode:".Length);
        var segments = body
            .Split(';', StringSplitOptions.RemoveEmptyEntries)
            .Select(static segment => segment.Trim())
            .Where(static segment => segment.Length > 0)
            .ToList();

        var valueExpression = segments.Count > 0 ? segments[0] : string.Empty;
        var warnings = new List<(string, string)>();

        var width = DefaultWidth;
        var height = DefaultHeight;
        var margin = DefaultMargin;
        var pure = DefaultPure;
        var symbology = DefaultSymbology;

        foreach (var segment in segments.Skip(1))
        {
            var equalsIndex = segment.IndexOf('=');
            if (equalsIndex < 0)
            {
                warnings.Add(
                    ("UNSUPPORTED_BARCODE_PARAMETER", $"Barcode parameter '{segment}' is not key=value; legacy throws at render time."));
                continue;
            }

            var key = segment.Substring(0, equalsIndex).Trim().ToLowerInvariant();
            var rawValue = segment.Substring(equalsIndex + 1).Trim();
            switch (key)
            {
                case "type" or "format" or "barcodetype":
                    symbology = ExpressionGrammar.NormalizeSymbology(rawValue);
                    if (!ExpressionGrammar.KnownSymbologies.Contains(symbology))
                    {
                        warnings.Add(
                            ("UNSUPPORTED_BARCODE_TYPE", $"Unsupported barcode type '{rawValue}'. Supported: code128, code39, code93, codabar, ean13, ean8, upca, itf."));
                    }

                    break;
                case "width" or "widthpx":
                    if (!TryParsePositive(rawValue, out width))
                    {
                        width = DefaultWidth;
                        warnings.Add(InvalidValue(segment));
                    }

                    break;
                case "height" or "heightpx":
                    if (!TryParsePositive(rawValue, out height))
                    {
                        height = DefaultHeight;
                        warnings.Add(InvalidValue(segment));
                    }

                    break;
                case "margin":
                    if (!int.TryParse(rawValue, NumberStyles.Integer, CultureInfo.InvariantCulture, out margin) || margin < 0)
                    {
                        margin = DefaultMargin;
                        warnings.Add(InvalidValue(segment));
                    }

                    break;
                case "pure" or "purebarcode":
                    if (!bool.TryParse(rawValue, out pure))
                    {
                        pure = DefaultPure;
                        warnings.Add(InvalidValue(segment));
                    }

                    break;
                default:
                    warnings.Add(
                        ("UNSUPPORTED_BARCODE_PARAMETER", $"Unsupported barcode parameter '{key}'. Supported: type, width, height, margin, pure."));
                    break;
            }
        }

        return new BarcodeParseResult(
            valueExpression,
            symbology,
            new BarcodeParameters(width, height, margin, pure),
            warnings);
    }

    private static bool TryParsePositive(string raw, out int value)
    {
        return int.TryParse(raw, NumberStyles.Integer, CultureInfo.InvariantCulture, out value) && value > 0;
    }

    private static (string, string) InvalidValue(string segment)
    {
        return ("UNSUPPORTED_BARCODE_PARAMETER", $"Barcode parameter '{segment}' has an invalid value; legacy throws at render time.");
    }
}
