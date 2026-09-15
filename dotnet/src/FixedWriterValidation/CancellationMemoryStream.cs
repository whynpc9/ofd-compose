namespace OFDCompose.FixedWriting;

/// <summary>Cooperative cancellation at decoder stream IO boundaries, retaining owned bytes.</summary>
internal sealed class CancellationMemoryStream : MemoryStream
{
    private readonly CancellationToken token;
    internal CancellationMemoryStream(CancellationToken token) { this.token=token; }
    internal CancellationMemoryStream(byte[] bytes,CancellationToken token):base(bytes,false) { this.token=token; }
    public override int Read(byte[] buffer,int offset,int count) { token.ThrowIfCancellationRequested();return base.Read(buffer,offset,count); }
    public override int Read(Span<byte> buffer) { token.ThrowIfCancellationRequested();return base.Read(buffer); }
    public override int ReadByte() { token.ThrowIfCancellationRequested();return base.ReadByte(); }
    public override void Write(byte[] buffer,int offset,int count) { token.ThrowIfCancellationRequested();base.Write(buffer,offset,count); }
    public override void Write(ReadOnlySpan<byte> buffer) { token.ThrowIfCancellationRequested();base.Write(buffer); }
    public override void CopyTo(Stream destination,int bufferSize)
    {
        ArgumentOutOfRangeException.ThrowIfNegativeOrZero(bufferSize);token.ThrowIfCancellationRequested();
        var buffer=new byte[Math.Min(bufferSize,65536)];int count;
        while((count=Read(buffer,0,buffer.Length))!=0)destination.Write(buffer,0,count);
        token.ThrowIfCancellationRequested();
    }
}
