using System.Buffers.Binary;
#if PDF_WRITER
using OFDCompose.PdfIrWriter;
using static OFDCompose.PdfIrWriter.J;
#else
using OFDCompose.OfdIrWriter;
using static OFDCompose.OfdIrWriter.J;
#endif

namespace OFDCompose.FixedWriting;

/// <summary>ADR-0003 JPEG process and EXIF policy, checked before decoder allocation.</summary>
internal static class JpegProfile
{
    internal static void Validate(ReadOnlySpan<byte> bytes)
    {
        int at = 2, segments = 0, headerBytes = 0;
        bool entropy = false, frame = false, scan = false;
        while (at < bytes.Length)
        {
            if (entropy && bytes[at] != 255) { at++; continue; }
            int markerStart = at;
            Require(bytes[at++] == 255, "IR_RESOURCE", "image", "Malformed JPEG marker");
            while (at < bytes.Length && bytes[at] == 255) at++;
            Require(at < bytes.Length, "IR_RESOURCE", "image", "Truncated JPEG marker");
            int marker = bytes[at++];
            if (marker == 0 || marker is >= 208 and <= 215)
            {
                Require(entropy, "IR_RESOURCE", "image", "JPEG entropy marker outside scan");
                continue;
            }
            if (marker == 217)
            {
                Require(at == bytes.Length && scan, "IR_RESOURCE", "image", "Invalid JPEG termination");
                return;
            }
            headerBytes += at-markerStart;
            Require(headerBytes<=65536,"RESOURCE_LIMIT","image","JPEG header budget exceeded");
            if (marker == 1) continue;
            Require(++segments <= 256, "RESOURCE_LIMIT", "image", "JPEG segment budget exceeded");
            Require(at + 2 <= bytes.Length, "IR_RESOURCE", "image", "Truncated JPEG segment");
            int length = BinaryPrimitives.ReadUInt16BigEndian(bytes[at..]);
            Require(length >= 2 && at + length <= bytes.Length, "IR_RESOURCE", "image", "JPEG segment bounds");
            headerBytes += length;
            Require(headerBytes <= 65536, "RESOURCE_LIMIT", "image", "JPEG header budget exceeded");
            if (marker is >= 192 and <= 207 && marker is not (192 or 193 or 194 or 196 or 200 or 204))
                throw new WriterFailure("UNSUPPORTED_FEATURE", "image", "JPEG profile supports SOF0/SOF1/SOF2 Huffman processes");
            if (marker is 192 or 193 or 194)
            {
                Require(!frame, "IR_RESOURCE", "image", "Duplicate JPEG frame");
                frame = true;
            }
            if (marker == 225)
            {
                Exif(bytes.Slice(at + 2, length - 2));
                Require(!frame, "UNSUPPORTED_FEATURE", "image", "JPEG metadata after SOF requires normalization");
            }
            entropy = marker == 218;
            if (entropy) { Require(frame, "IR_RESOURCE", "image", "JPEG scan before frame"); scan = true; }
            at += length;
        }
        throw new WriterFailure("IR_RESOURCE", "image", "JPEG is missing EOI");
    }
    private static void Exif(ReadOnlySpan<byte> payload)
    {
        if (!payload.StartsWith("Exif\0\0"u8)) return;
        Require(payload.Length >= 14, "IR_RESOURCE", "image", "Truncated EXIF header");
        var tiff = payload[6..];
        ushort endian = BinaryPrimitives.ReadUInt16BigEndian(tiff);
        Require(endian is 0x4949 or 0x4d4d, "IR_RESOURCE", "image", "Invalid EXIF byte order");
        bool little = endian == 0x4949;
        Require(Read16(tiff, 2, little) == 42, "IR_RESOURCE", "image", "Invalid TIFF marker");
        uint offset = Read32(tiff, 4, little);
        Require(offset >= 8 && (long)offset + 2 <= tiff.Length, "IR_RESOURCE", "image", "Invalid EXIF IFD offset");
        int count = Read16(tiff, (int)offset, little);
        Require(count <= 1024, "RESOURCE_LIMIT", "image", "EXIF entry budget exceeded");
        Require((long)offset + 2 + count * 12 + 4 <= tiff.Length, "IR_RESOURCE", "image", "Truncated EXIF IFD");
        for (int i = 0; i < count; i++)
        {
            int at = (int)offset + 2 + i * 12;
            if (Read16(tiff, at, little) != 274) continue;
            Require(Read16(tiff, at + 2, little) == 3 && Read32(tiff, at + 4, little) == 1,
                "IR_RESOURCE", "image", "Invalid EXIF orientation field");
            int orientation = Read16(tiff, at + 8, little);
            Require(orientation is >= 1 and <= 8, "IR_RESOURCE", "image", "Invalid EXIF orientation");
            Require(orientation == 1, "UNSUPPORTED_FEATURE", "image", "JPEG EXIF orientation requires normalization");
        }
    }
    private static ushort Read16(ReadOnlySpan<byte> bytes, int at, bool little) => little ? BinaryPrimitives.ReadUInt16LittleEndian(bytes[at..]) : BinaryPrimitives.ReadUInt16BigEndian(bytes[at..]);
    private static uint Read32(ReadOnlySpan<byte> bytes, int at, bool little) => little ? BinaryPrimitives.ReadUInt32LittleEndian(bytes[at..]) : BinaryPrimitives.ReadUInt32BigEndian(bytes[at..]);
}
