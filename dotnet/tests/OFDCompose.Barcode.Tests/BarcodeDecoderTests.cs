using System.Text.Json;
using Xunit;
using ZXing;
using ZXing.Common;

namespace OFDCompose.Barcode.Tests;

public sealed class BarcodeDecoderTests
{
    public static IEnumerable<object[]> Cases()
    {
        using var doc = JsonDocument.Parse(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "fixtures.json")));
        foreach (var item in doc.RootElement.EnumerateArray())
            yield return [item.GetProperty("name").GetString()!, item.GetRawText()];
    }
    [Theory]
    [MemberData(nameof(Cases))]
    public void Worker_IR_decodes_exact_value_and_format(string name, string json)
    {
        using var doc = JsonDocument.Parse(json);
        var f = doc.RootElement;
        var format = Format(f.GetProperty("expectedFormat").GetString()!);
        var expected = f.GetProperty("encodedValue").GetString()!;
        var (pixels, width, height) = Raster(f);
        var result = Reader(format, expected.Length).Decode(pixels, width, height, RGBLuminanceSource.BitmapFormat.RGB24);
        Assert.True(result is not null, $"No decode: {name}");
        Assert.Equal(expected, result.Text);
        Assert.Equal(format, result.BarcodeFormat);
        // Verify UPC-A's forced EAN-13 alias separately from its declared format.
        if (format == BarcodeFormat.UPC_A)
        {
            var alias = Reader(BarcodeFormat.EAN_13, 13).Decode(pixels, width, height, RGBLuminanceSource.BitmapFormat.RGB24);
            Assert.NotNull(alias);
            Assert.Equal("0" + expected, alias.Text);
            Assert.Equal(BarcodeFormat.EAN_13, alias.BarcodeFormat);
        }
    }

    [Fact]
    public void White_image_is_not_a_barcode()
    {
        var pixels = Enumerable.Repeat((byte)255, 1200 * 240 * 3).ToArray();
        foreach (var format in new[] { "Code39", "Code93", "Codabar", "EAN8", "UPCA", "ITF", "EAN13", "Code128" })
            Assert.Null(Reader(Format(format), 8).Decode(pixels, 1200, 240, RGBLuminanceSource.BitmapFormat.RGB24));
    }

    private static BarcodeReaderGeneric Reader(BarcodeFormat format, int length) => new()
    {
        Options = new DecodingOptions
        {
            PossibleFormats = [format],
            TryHarder = true,
            ReturnCodabarStartEnd = true,
            AllowedLengths = format == BarcodeFormat.ITF ? [length] : null,
            UseCode39ExtendedMode = false,
            AssumeCode39CheckDigit = false
        }
    };

    private static BarcodeFormat Format(string s) => s switch
    {
        "Code39" => BarcodeFormat.CODE_39, "Code93" => BarcodeFormat.CODE_93,
        "Codabar" => BarcodeFormat.CODABAR, "EAN8" => BarcodeFormat.EAN_8,
        "UPCA" => BarcodeFormat.UPC_A, "ITF" => BarcodeFormat.ITF,
        "EAN13" => BarcodeFormat.EAN_13, "Code128" => BarcodeFormat.CODE_128,
        _ => throw new InvalidDataException(s)
    };

    // Independent rasterization consumes every rectangle corner from actual IR.
    private static (byte[], int, int) Raster(JsonElement f)
    {
        const int margin = 30;
        var commands = f.GetProperty("path").GetProperty("commands").EnumerateArray().ToArray();
        Assert.NotEmpty(commands);
        Assert.Equal(0, commands.Length % 5);
        var barWidths = Enumerable.Range(0, commands.Length / 5)
            .Select(i => commands[i * 5 + 1].GetProperty("x").GetDouble() - commands[i * 5].GetProperty("x").GetDouble()).ToArray();
        var minimumWidth = barWidths.Min();
        Assert.True(double.IsFinite(minimumWidth) && minimumWidth > 0);
        // Choose eight pixels per observed narrow bar from IR geometry alone.
        // Round physical coordinates at this pitch so 0.001-mm serialization
        // jitter does not turn equal Codabar spaces into different pixel widths.
        // ZXing.Net thresholds spaces within each character, including characters
        // whose spaces are all narrow; arbitrary DPI rounding can confuse it.
        var moduleWidth = barWidths.Where(width => width < minimumWidth * 1.2).Average();
        var scale = 8 / moduleWidth;
        var pw = f.GetProperty("width").GetDouble();
        var ph = f.GetProperty("height").GetDouble();
        Assert.InRange(pw, 1, 1000);
        Assert.InRange(ph, 1, 1000);
        int width = checked((int)Math.Ceiling(pw * scale)), height = checked((int)Math.Ceiling(ph * scale) + margin * 2);
        var pixels = Enumerable.Repeat((byte)255, checked(width * height * 3)).ToArray();
        for (var i = 0; i < commands.Length; i += 5)
        {
            Assert.Equal("move", commands[i].GetProperty("op").GetString());
            for (var j = 1; j < 4; j++) Assert.Equal("line", commands[i + j].GetProperty("op").GetString());
            Assert.Equal("close", commands[i + 4].GetProperty("op").GetString());
            var c = commands.Skip(i).Take(4).Select(p => (X: p.GetProperty("x").GetDouble(), Y: p.GetProperty("y").GetDouble())).ToArray();
            Assert.Equal(c[0].Y, c[1].Y);
            Assert.Equal(c[1].X, c[2].X);
            Assert.Equal(c[2].Y, c[3].Y);
            Assert.Equal(c[3].X, c[0].X);
            Assert.True(c[1].X > c[0].X && c[2].Y > c[0].Y);
            foreach (var p in c)
            {
                Assert.InRange(p.X, 0, pw);
                Assert.InRange(p.Y, 0, ph);
            }
            for (var y = (int)Math.Round(c[0].Y * scale) + margin; y < Math.Round(c[2].Y * scale) + margin; y++)
                for (var x = (int)Math.Round(c[0].X * scale); x < Math.Round(c[1].X * scale); x++)
                {
                    var offset = (y * width + x) * 3;
                    pixels[offset] = pixels[offset + 1] = pixels[offset + 2] = 0;
                }
        }
        return (pixels, width, height);
    }
}
