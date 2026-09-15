using System.Buffers.Binary;
using System.Buffers;
using System.Text.Json;
using System.IO.Compression;
using BigGustave;
using JpegLibrary;
using static OFDCompose.OfdIrWriter.J;

namespace OFDCompose.OfdIrWriter;
internal static class ResourceValidation
{
    internal static Dictionary<string, byte[]> Validate(JsonElement ir, IReadOnlyList<WriterResource> supplied, WriterLimits limits)
    {
        Require(supplied.Count <= limits.Resources, "RESOURCE_LIMIT", "resources", "Resource count exceeded");
        long total = 0;
        foreach (var resource in supplied)
        {
            total += resource.Bytes.Length;
            Require(total <= limits.ResourceBytes && resource.Bytes.Length <= limits.ResourceEntryBytes, "RESOURCE_LIMIT", "resources", "Resource bytes exceeded");
            Require(resource.ResourceId.Length <= 64, "RESOURCE_LIMIT", "resources", "Resource ID too long");
        }
        Require(supplied.Count == ir.P("resources").GetArrayLength(), "IR_RESOURCE", "resources", "Resource closure mismatch");
        var result = new Dictionary<string, byte[]>();
        foreach (var resource in supplied)
        {
            Require(!result.ContainsKey(resource.ResourceId), "IR_RESOURCE", "resources", "Duplicate resource");
            result.Add(resource.ResourceId, resource.Bytes.ToArray());
        }
        long pixels = 0;
        foreach (var descriptor in ir.A("resources"))
        {
            string id = descriptor.S("id");
            Require(result.TryGetValue(id, out var bytes), "IR_RESOURCE", id, "Missing resource");
            bool font = descriptor.S("kind") == "font";
            Require(!font || descriptor.Has("subsetDigest"), "IR_RESOURCE", id, "Worker subset required");
            Require(IrValidation.Digest(bytes) == descriptor.S(font ? "subsetDigest" : "digest"), "IR_RESOURCE", id, "Resource digest mismatch");
            if (font) Font(descriptor, bytes!, ir);
            else
            {
                pixels += (long)descriptor.I("pixelWidth") * descriptor.I("pixelHeight");
                Require(pixels <= 16_000_000, "RESOURCE_LIMIT", id, "Decoded pixel budget exceeded");
                Image(descriptor, bytes!);
            }
        }
        return result;
    }
    private static void Font(JsonElement descriptor, byte[] bytes, JsonElement ir)
    {
        var span = bytes.AsSpan();
        Require(span.Length >= 12 && (span[..4].SequenceEqual("OTTO"u8) || BinaryPrimitives.ReadUInt32BigEndian(span) == 0x00010000), "IR_RESOURCE", descriptor.S("id"), "Static SFNT subset required");
        int count = BinaryPrimitives.ReadUInt16BigEndian(span[4..]);
        Require(count is > 0 and <= 128 && 12 + count * 16 <= span.Length, "IR_RESOURCE", "font", "Invalid SFNT table directory");
        var tables = new Dictionary<string, (int Offset, int Length)>();
        for (int i = 0; i < count; i++)
        {
            var entry = span.Slice(12 + i * 16, 16);
            string name = System.Text.Encoding.ASCII.GetString(entry[..4]);
            uint offset = BinaryPrimitives.ReadUInt32BigEndian(entry[8..]), length = BinaryPrimitives.ReadUInt32BigEndian(entry[12..]);
            Require((ulong)offset + length <= (ulong)span.Length && !tables.ContainsKey(name), "IR_RESOURCE", "font", "Invalid SFNT table bounds");
            tables.Add(name, ((int)offset, (int)length));
        }
        Require(!tables.ContainsKey("fvar") && tables.TryGetValue("maxp", out var maxp) && maxp.Length >= 6 && (tables.ContainsKey("CFF ") || tables.ContainsKey("glyf") && tables.ContainsKey("loca")), "IR_RESOURCE", "font", "Unsupported or invalid subset outline");
        int glyphCount = BinaryPrimitives.ReadUInt16BigEndian(span[(tables["maxp"].Offset + 4)..]);
        int tableEnd = 12 + count * 16;
        foreach(var table in tables.Values.OrderBy(t => t.Offset))
        {
            Require(table.Offset >= tableEnd && table.Offset % 4 == 0, "IR_RESOURCE", "font", "Overlapping/unaligned SFNT tables");
            tableEnd = table.Offset + table.Length;
        }
        Require(descriptor.N("faceIndex")==0,"UNSUPPORTED_FEATURE",descriptor.S("id"),"Static single-face subset requires faceIndex zero");
        Require(tables.TryGetValue("OS/2",out var os2)&&os2.Length>=64,"IR_RESOURCE","font","Missing font style metadata");
        Require(BinaryPrimitives.ReadUInt16BigEndian(span[(os2.Offset+4)..])==descriptor.N("weight"),"IR_RESOURCE","font","Subset weight mismatch");
        ushort selection=BinaryPrimitives.ReadUInt16BigEndian(span[(os2.Offset+62)..]);
        Require(descriptor.S("style") switch { "normal" => (selection&0x201)==0, "italic" => (selection&1)!=0, "oblique" => (selection&0x200)!=0, _=>false },"IR_RESOURCE","font","Subset style mismatch");
        FontStructure.Validate(bytes, tables, glyphCount);
        var map = descriptor.Has("glyphIdMap") ? descriptor.A("glyphIdMap").ToDictionary(g => g.N("original"), g => g.N("subset")) : null;
        if (map is not null) foreach (var glyph in map.Values) Require(glyph < glyphCount, "IR_RESOURCE", "font", "Subset glyph out of bounds");
        foreach (var page in ir.A("pages")) foreach (var obj in page.A("objects"))
            if (obj.S("kind") == "text" && obj.S("fontId") == descriptor.S("id")) foreach (var glyph in obj.A("glyphs"))
                Require((map is null ? glyph.N("glyphId") : map[glyph.N("glyphId")]) < glyphCount, "IR_RESOURCE", obj.S("id"), "Glyph absent from subset");
    }
    private static void Image(JsonElement descriptor, byte[] bytes)
    {
        bool png = descriptor.S("mimeType") == "image/png";
        Require(png ? bytes.AsSpan().StartsWith(new byte[] { 137, 80, 78, 71, 13, 10, 26, 10 }) : bytes.Length >= 4 && bytes[0] == 255 && bytes[1] == 216 && bytes[^2] == 255 && bytes[^1] == 217, "IR_RESOURCE", "image", "Image MIME/signature mismatch");
        if (png)
        {
            int at = 8, chunks = 0; bool end = false, hasData = false;
            using var compressed = new MemoryStream();
            while (at < bytes.Length)
            {
                Require(bytes.Length - at >= 12, "IR_RESOURCE", "image", "Truncated PNG chunk");
                uint size = BinaryPrimitives.ReadUInt32BigEndian(bytes.AsSpan(at));
                Require(size <= bytes.Length - at - 12, "IR_RESOURCE", "image", "Invalid PNG chunk length");
                int length = (int)size;
                Require(++chunks<=4096,"RESOURCE_LIMIT","image","PNG chunk budget exceeded");
                var type=bytes.AsSpan(at+4,4);
                Require(chunks!=1 || type.SequenceEqual("IHDR"u8) && length==13,"IR_RESOURCE","image","Invalid PNG IHDR");
                Require(chunks==1 || !type.SequenceEqual("IHDR"u8),"IR_RESOURCE","image","Duplicate PNG IHDR");
                Require(!type.SequenceEqual("acTL"u8) && !type.SequenceEqual("fcTL"u8) && !type.SequenceEqual("fdAT"u8),"UNSUPPORTED_FEATURE","image","Animated PNG requires normalization");
                if(type.SequenceEqual("IDAT"u8) && length>0)hasData=true;
                if(type.SequenceEqual("IEND"u8))Require(length==0 && hasData,"IR_RESOURCE","image","Invalid PNG IEND");
                uint crc = 0xffffffff;
                foreach (byte b in bytes.AsSpan(at + 4, length + 4))
                {
                    crc ^= b;
                    for (int bit = 0; bit < 8; bit++) crc = (crc >> 1) ^ ((crc & 1) != 0 ? 0xedb88320u : 0);
                }
                Require(~crc == BinaryPrimitives.ReadUInt32BigEndian(bytes.AsSpan(at + 8 + length)), "IR_RESOURCE", "image", "PNG CRC mismatch");
                if(bytes.AsSpan(at + 4, 4).SequenceEqual("IDAT"u8)) compressed.Write(bytes.AsSpan(at + 8, length));
                end = bytes.AsSpan(at + 4, 4).SequenceEqual("IEND"u8); at += length + 12;
                if (end) break;
            }
            Require(end && at == bytes.Length, "IR_RESOURCE", "image", "Invalid PNG termination");
            // Bound PNG zlib expansion independently of the downstream decoder.
            compressed.Position=0;
            using var inflate = new ZLibStream(compressed, CompressionMode.Decompress);
            var block = new byte[8192]; long expanded=0;
            long expandedLimit=(long)descriptor.I("pixelWidth")*descriptor.I("pixelHeight")*8 + descriptor.I("pixelHeight")*16L + 1024;
            int read;while((read=inflate.Read(block))!=0)
            {
                expanded+=read;Require(expanded<=expandedLimit,"RESOURCE_LIMIT","image","PNG inflated byte budget exceeded");
            }
        }
        if(png)
        {
            Require(bytes.Length>=33 && BinaryPrimitives.ReadUInt32BigEndian(bytes.AsSpan(16))==descriptor.I("pixelWidth") && BinaryPrimitives.ReadUInt32BigEndian(bytes.AsSpan(20))==descriptor.I("pixelHeight"),"IR_RESOURCE","image","PNG dimension mismatch");
            Require(bytes[24]==8 && bytes[28]==0,"UNSUPPORTED_FEATURE","image","PNG writer profile requires 8-bit noninterlaced pixels");
            using var stream=new MemoryStream(bytes,false);
            var decoded=Png.Open(stream);
            Require(decoded.Width==descriptor.I("pixelWidth") && decoded.Height==descriptor.I("pixelHeight"),"IR_RESOURCE","image","PNG decode mismatch");
            // Force pixel access, including palette indices, for the full bounded image.
            for(int y=0;y<decoded.Height;y++)for(int x=0;x<decoded.Width;x++)_ = decoded.GetPixel(x,y);
        }
        else
        {
            JpegProfile.Validate(bytes);
            using var pool=new BoundedDecodePool();
            var decoder=new JpegDecoder { MemoryPool=pool };decoder.SetInput(bytes);decoder.Identify();
            Require(decoder.Width==descriptor.I("pixelWidth") && decoder.Height==descriptor.I("pixelHeight"),"IR_RESOURCE","image","JPEG dimension mismatch");
            Require(decoder.Precision==8 && decoder.NumberOfComponents is 1 or 3,"UNSUPPORTED_FEATURE","image","JPEG writer profile requires 8-bit grayscale or RGB components");
            decoder.SetOutputWriter(new CheckedJpegOutput(decoder.Width,decoder.Height,decoder.NumberOfComponents));decoder.Decode();
        }
    }
    private sealed class BoundedDecodePool:MemoryPool<byte>
    {
        private int reserved;
        public override int MaxBufferSize => 128*1024*1024;
        public override IMemoryOwner<byte> Rent(int minBufferSize=-1)
        {
            int size=minBufferSize<0?4096:minBufferSize;
            Require(size<=MaxBufferSize-reserved,"RESOURCE_LIMIT","image","JPEG decoded memory budget exceeded");
            reserved+=size;return new Owner(new byte[size],()=>reserved-=size);
        }
        protected override void Dispose(bool disposing) { }
        private sealed class Owner(byte[] bytes,Action release):IMemoryOwner<byte>
        {
            private byte[]? data=bytes;
            public Memory<byte> Memory => data ?? throw new ObjectDisposedException(nameof(Owner));
            public void Dispose(){if(data is not null){data=null;release();}}
        }
    }
    private sealed class CheckedJpegOutput(int width,int height,int components):JpegBlockOutputWriter
    {
        private int count;
        public override void WriteBlock(ref short block,int componentIndex,int x,int y)
        {
            Require(componentIndex>=0&&componentIndex<components&&x>=0&&y>=0&&x<width+8&&y<height+8,"IR_RESOURCE","image","JPEG decoded block out of bounds");
            Require(++count<=((width+7L)/8)*((height+7L)/8)*components*4,"RESOURCE_LIMIT","image","JPEG block budget exceeded");
        }
    }
}
