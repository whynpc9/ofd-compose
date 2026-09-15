using System.Text.Json;
using Xunit;
namespace OFDCompose.PdfIrWriter.Tests;
public sealed class WhitespaceMappingTests
{
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
