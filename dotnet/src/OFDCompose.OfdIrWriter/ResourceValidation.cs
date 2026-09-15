using System.Buffers.Binary;
using System.Text.Json;
using StbImageSharp;
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
            int at = 8; bool end = false;
            while (at < bytes.Length)
            {
                Require(bytes.Length - at >= 12, "IR_RESOURCE", "image", "Truncated PNG chunk");
                uint size = BinaryPrimitives.ReadUInt32BigEndian(bytes.AsSpan(at));
                Require(size <= bytes.Length - at - 12, "IR_RESOURCE", "image", "Invalid PNG chunk length");
                int length = (int)size;
                uint crc = 0xffffffff;
                foreach (byte b in bytes.AsSpan(at + 4, length + 4))
                {
                    crc ^= b;
                    for (int bit = 0; bit < 8; bit++) crc = (crc >> 1) ^ ((crc & 1) != 0 ? 0xedb88320u : 0);
                }
                Require(~crc == BinaryPrimitives.ReadUInt32BigEndian(bytes.AsSpan(at + 8 + length)), "IR_RESOURCE", "image", "PNG CRC mismatch");
                end = bytes.AsSpan(at + 4, 4).SequenceEqual("IEND"u8); at += length + 12;
                if (end) break;
            }
            Require(end && at == bytes.Length, "IR_RESOURCE", "image", "Invalid PNG termination");
        }
        using var stream = new MemoryStream(bytes, false);
        var info = ImageInfo.FromStream(stream);
        Require(info.HasValue && info.Value.Width == descriptor.I("pixelWidth") && info.Value.Height == descriptor.I("pixelHeight"), "IR_RESOURCE", "image", "Decoded image dimensions mismatch");
        // Dimensions and cumulative pixels were bounded before full decoding.
        var decoded = ImageResult.FromMemory(bytes, ColorComponents.RedGreenBlueAlpha);
        Require(decoded.Width == descriptor.I("pixelWidth") && decoded.Height == descriptor.I("pixelHeight"), "IR_RESOURCE", "image", "Image decode mismatch");
    }
}
