using System.Collections;
using System.Text.Json;
using OFDCompose.FixedWriting;
using Xunit;
namespace OFDCompose.PdfIrWriter.Tests;
public sealed class ValidationCancellationTests
{
    [Fact]
    public async Task Resource_validation_observes_cancellation_after_enumeration_starts()
    {
        var f=await WriterTests.Fixture("geometry");using var ir=JsonDocument.Parse(f.Ir);using var cancellation=new CancellationTokenSource();
        var list=new CancellingList(f.Resources,cancellation);
        Assert.ThrowsAny<OperationCanceledException>(()=>ResourceValidation.Validate(ir.RootElement,list,new WriterLimits(),cancellation.Token));
        Assert.Equal(2,list.Visited);
    }
    [Fact]
    public void Decoder_stream_checks_cancellation_after_a_successful_read()
    {
        using var cancellation=new CancellationTokenSource();using var stream=new CancellationMemoryStream(new byte[64],cancellation.Token);Assert.Equal(0,stream.ReadByte());cancellation.Cancel();
        Assert.ThrowsAny<OperationCanceledException>(()=>stream.ReadByte());using var destination=new MemoryStream();Assert.ThrowsAny<OperationCanceledException>(()=>stream.CopyTo(destination));
    }
    [Fact]
    public void Font_and_jpeg_helpers_receive_the_token()
    {
        using var cancellation=new CancellationTokenSource();cancellation.Cancel();
        Assert.ThrowsAny<OperationCanceledException>(()=>FontStructure.Dict([],cancellation.Token));
        Assert.ThrowsAny<OperationCanceledException>(()=>JpegProfile.Validate([],cancellation.Token));
    }
    private sealed class CancellingList(IReadOnlyList<WriterResource> source,CancellationTokenSource cancellation):IReadOnlyList<WriterResource>
    {
        public int Visited {get;private set;} public int Count=>source.Count;public WriterResource this[int i]=>source[i];
        public IEnumerator<WriterResource> GetEnumerator(){for(int i=0;i<source.Count;i++){if(i==1)cancellation.Cancel();Visited++;yield return source[i];}}
        IEnumerator IEnumerable.GetEnumerator()=>GetEnumerator();
    }
}
