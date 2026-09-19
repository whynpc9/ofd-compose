using System.Text.Json;
using Xunit;
using UglyToad.PdfPig;
using OFDCompose.FixedWriting;
namespace OFDCompose.PdfIrWriter.Tests;
public sealed class WhitespaceMappingTests
{
    [Fact]
    public async Task Accepted_worker_double_space_preserves_source_mapping_and_geometry()
    {
        string root=Path.Combine(WriterTests.Root,"tests/pdf-writer/fixtures/whitespace-reader/worker-double");
        byte[] ir=await File.ReadAllBytesAsync(Path.Combine(root,"ir.json"),TestContext.Current.CancellationToken);byte[] font=await File.ReadAllBytesAsync(Path.Combine(root,"r0.bin"),TestContext.Current.CancellationToken);
        using var expected=JsonDocument.Parse(await File.ReadAllBytesAsync(Path.Combine(WriterTests.Root,"tests/pdf-writer/accepted-whitespace.json"),TestContext.Current.CancellationToken));Assert.Equal(expected.RootElement.GetProperty("irSha256").GetString(),WriterTests.Digest(ir));
        var result=await new PdfIrWriter().WriteAsync(ir,WriterTests.Digest(ir),[new WriterResource("r0",font)],cancellationToken:TestContext.Current.CancellationToken);Assert.True(result.Ok,JsonSerializer.Serialize(result.Diagnostics));
        using var pdf=PdfDocument.Open(result.Bytes!);using var baseline=PdfDocument.Open(await File.ReadAllBytesAsync(Path.Combine(root,"worker.pdf"),TestContext.Current.CancellationToken));
        Assert.Equal("o  f",pdf.GetPage(1).Text);var letters=pdf.GetPage(1).Letters;var original=baseline.GetPage(1).Letters;Assert.Equal(4,letters.Count);Assert.Equal(original.Count,letters.Count);
        for(int i=0;i<letters.Count;i++){Assert.Equal(original[i].Value,letters[i].Value);Assert.Equal(original[i].StartBaseLine,letters[i].StartBaseLine);Assert.Equal(original[i].EndBaseLine,letters[i].EndBaseLine);Assert.Equal(original[i].GlyphRectangle,letters[i].GlyphRectangle);}
        Assert.Contains(WriterTests.DecodedStreams(result.Bytes!).Values,b=>b.AsSpan().SequenceEqual(font));
        string output=Directory.CreateDirectory(Path.Combine(WriterTests.Output,"accepted-whitespace")).FullName;await File.WriteAllBytesAsync(Path.Combine(output,"worker-double.pdf"),result.Bytes!,TestContext.Current.CancellationToken);
    }
    [Theory][InlineData("nbsp")][InlineData("newline")]
    public async Task Unicode_whitespace_normalized_by_stock_reader_is_diagnosed_per_object(string name)
    {
        byte[] ir=await File.ReadAllBytesAsync(Path.Combine(WriterTests.Root,"tests/pdf-writer/fixtures/whitespace-reader",name+".ir.json"),TestContext.Current.CancellationToken);
        var source=await WriterTests.Fixture("truetype");var result=await new PdfIrWriter().WriteAsync(ir,WriterTests.Digest(ir),source.Resources,cancellationToken:TestContext.Current.CancellationToken);
        Assert.False(result.Ok);Assert.Null(result.ObjectMap);Assert.Contains(result.Diagnostics,d=>d.Code=="UNSUPPORTED_FEATURE"&&d.Path=="p0o0");
    }
    [Fact]
    public async Task Ordinary_ascii_space_mapping_remains_supported()
    {
        byte[] ir=await File.ReadAllBytesAsync(Path.Combine(WriterTests.Root,"tests/pdf-writer/fixtures/whitespace-reader/ascii.ir.json"),TestContext.Current.CancellationToken);
        var source=await WriterTests.Fixture("truetype");var result=await new PdfIrWriter().WriteAsync(ir,WriterTests.Digest(ir),source.Resources,cancellationToken:TestContext.Current.CancellationToken);Assert.True(result.Ok,JsonSerializer.Serialize(result.Diagnostics));
    }
}
