using OFDCompose.FixedWriting;
using System.IO.Compression;
using System.Text;
using static OFDCompose.PdfIrWriter.J;
namespace OFDCompose.PdfIrWriter;

internal sealed class PdfObjects(int limit)
{
    private readonly List<byte[]?> objects = [];
    private long reserved;
    internal static byte[] Ascii(string text) => Encoding.ASCII.GetBytes(text);
    internal int Reserve() { Require(objects.Count < 100_000, "RESOURCE_LIMIT", "pdf", "PDF object budget exceeded"); objects.Add(null); return objects.Count; }
    internal int Add(string text) { int id = Reserve(); Set(id, Ascii(text)); return id; }
    internal void Set(int id, byte[] bytes)
    {
        Require(objects[id-1] is null, "IR_RESOURCE", "pdf", "Duplicate object assignment");
        reserved += bytes.Length + 64L;
        Require(reserved <= limit, "RESOURCE_LIMIT", "pdf", "PDF byte budget exceeded"); objects[id-1] = bytes;
    }
    internal int Stream(byte[] bytes, string entries = "", bool compress = true)
    {
        Require(bytes.Length <= limit - reserved, "RESOURCE_LIMIT", "pdf", "Stream budget exceeded");
        byte[] encoded = bytes;
        if(compress)
        {
            using var buffer = new MemoryStream();
            using(var z = new ZLibStream(buffer, CompressionLevel.SmallestSize, true)) z.Write(bytes);
            encoded = buffer.ToArray(); entries += " /Filter /FlateDecode";
        }
        var prefix = Ascii($"<< /Length {encoded.Length}{entries} >>\nstream\n");
        var suffix = Ascii("\nendstream");
        int id = Reserve(); var output = new byte[prefix.Length + encoded.Length + suffix.Length];
        prefix.CopyTo(output,0); encoded.CopyTo(output,prefix.Length); suffix.CopyTo(output,prefix.Length+encoded.Length); Set(id,output); return id;
    }
    internal byte[] Finish(int root, string digest)
    {
        Require(reserved + objects.Count * 32L + 1024 <= limit, "RESOURCE_LIMIT", "pdf", "Final PDF budget exceeded");
        using var stream = new MemoryStream();
        void Write(string s) => stream.Write(Ascii(s));
        Write("%PDF-1.7\n%\xE2\xE3\xCF\xD3\n");
        var offsets = new long[objects.Count];
        for(int i=0;i<objects.Count;i++) { offsets[i]=stream.Position; Write($"{i+1} 0 obj\n"); stream.Write(objects[i] ?? throw new InvalidDataException()); Write("\nendobj\n"); }
        long xref=stream.Position; Write($"xref\n0 {objects.Count+1}\n0000000000 65535 f \n");
        foreach(long offset in offsets) Write(offset.ToString("D10",System.Globalization.CultureInfo.InvariantCulture)+" 00000 n \n");
        Write($"trailer\n<< /Size {objects.Count+1} /Root {root} 0 R /ID [<{digest[..32]}> <{digest[..32]}>] >>\nstartxref\n{xref}\n%%EOF\n");
        return stream.ToArray();
    }
}
