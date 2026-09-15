using System.Text;
using System.Text.Json;
using Xunit;
namespace OFDCompose.PdfIrWriter.Tests;
public sealed class CancellationTests
{
    [Fact]
    public void Path_emission_observes_cancellation_after_iteration_has_started()
    {
        using var source=JsonDocument.Parse("{\"op\":\"move\",\"x\":1000,\"y\":2000}");
        using var cancellation=new CancellationTokenSource();var content=new StringBuilder();int enumerated=0;
        IEnumerable<JsonElement> Commands()
        {
            for(int i=0;i<10000;i++)
            {
                if(i==500)cancellation.Cancel();
                enumerated++;yield return source.RootElement;
            }
        }
        Assert.ThrowsAny<OperationCanceledException>(()=>PdfIrWriter.Commands(content,Commands(),cancellation.Token));
        Assert.True(content.Length>0);Assert.True(enumerated<10000,"Cancellation must interrupt the loop, not only its epilogue");
    }
    [Fact]
    public void Finalization_and_compression_do_not_return_bytes_after_cancellation()
    {
        using var cancellation=new CancellationTokenSource();var pdf=new PdfObjects(100000,cancellation.Token);
        int root=pdf.Add("<< /Type /Catalog >>");cancellation.Cancel();
        Assert.ThrowsAny<OperationCanceledException>(()=>pdf.Stream(new byte[10000]));
        Assert.ThrowsAny<OperationCanceledException>(()=>pdf.Finish(root,new string('0',64)));
    }
    [Fact]
    public async Task Cancelled_write_has_no_result_and_writer_can_be_reused()
    {
        var f=await WriterTests.Fixture("truetype");var writer=new PdfIrWriter();using var cancellation=new CancellationTokenSource();cancellation.Cancel();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(()=>writer.WriteAsync(f.Ir,WriterTests.Digest(f.Ir),f.Resources,cancellationToken:cancellation.Token));
        var result=await writer.WriteAsync(f.Ir,WriterTests.Digest(f.Ir),f.Resources,cancellationToken:TestContext.Current.CancellationToken);Assert.True(result.Ok);
    }
}
