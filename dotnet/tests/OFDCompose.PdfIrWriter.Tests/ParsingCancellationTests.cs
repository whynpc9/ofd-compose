using System.Buffers;
using System.Text;
using System.Text.Json;
using OFDCompose.FixedWriting;
using Xunit;
namespace OFDCompose.PdfIrWriter.Tests;
public sealed class ParsingCancellationTests
{
    [Theory][InlineData(false)][InlineData(true)]
    public async Task Cancellation_after_input_copy_starts_wins_over_validation(bool malformed)
    {
        var fixture=await WriterTests.Fixture("truetype");byte[] data=malformed?"not json"u8.ToArray():fixture.Ir;
        using var cancellation=new CancellationTokenSource();using var owner=new CancelOnRead(data,cancellation);ReadOnlyMemory<byte> memory=owner.Memory;owner.Armed=true;
        Assert.False(cancellation.IsCancellationRequested);
        await Assert.ThrowsAnyAsync<OperationCanceledException>(()=>new PdfIrWriter().WriteAsync(memory,WriterTests.Digest(data),fixture.Resources,cancellationToken:cancellation.Token));
        Assert.True(owner.CancelledDuringRead);
    }
    [Fact]
    public void Canonicalization_observes_its_supplied_token()
    {
        using var document=JsonDocument.Parse("{\"text\":\"owned text\",\"items\":[1,2,3]}");using var cancellation=new CancellationTokenSource();cancellation.Cancel();
        Assert.ThrowsAny<OperationCanceledException>(()=>IrValidation.Canonical(document.RootElement,false,cancellation.Token));
    }
    private sealed class CancelOnRead(byte[] bytes,CancellationTokenSource cancellation):MemoryManager<byte>
    {
        internal bool Armed;internal bool CancelledDuringRead;
        public override Span<byte> GetSpan(){if(Armed){CancelledDuringRead=true;cancellation.Cancel();}return bytes;}
        public override MemoryHandle Pin(int elementIndex=0)=>throw new NotSupportedException();
        public override void Unpin() { }
        protected override void Dispose(bool disposing) { }
    }
}
