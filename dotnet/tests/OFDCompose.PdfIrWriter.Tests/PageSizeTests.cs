using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using OFDCompose.FixedWriting;
using UglyToad.PdfPig;
using Xunit;
namespace OFDCompose.PdfIrWriter.Tests;
public sealed class PageSizeTests
{
    [Theory][InlineData("width",5080000,true)][InlineData("height",5080000,true)][InlineData("width",5080001,false)][InlineData("height",5080001,false)]
    public async Task Default_user_space_page_dimensions_are_bounded(string axis,int size,bool supported)
    {
        var f=await WriterTests.Fixture("truetype");var n=JsonNode.Parse(f.Ir)!;n["pages"]![0]![axis]=size;
        using var parsed=JsonDocument.Parse(n.ToJsonString());byte[] ir=Encoding.UTF8.GetBytes(IrValidation.Canonical(parsed.RootElement,false,TestContext.Current.CancellationToken));
        var result=await new PdfIrWriter().WriteAsync(ir,WriterTests.Digest(ir),f.Resources,cancellationToken:TestContext.Current.CancellationToken);Assert.Equal(supported,result.Ok);
        if(supported){using var pdf=PdfDocument.Open(result.Bytes!);Assert.Equal(14400,axis=="width"?pdf.GetPage(1).Width:pdf.GetPage(1).Height,6);}
        else{Assert.Null(result.Bytes);Assert.Contains(result.Diagnostics,d=>d.Code=="UNSUPPORTED_FEATURE"&&d.Path=="p0");}
    }
}
