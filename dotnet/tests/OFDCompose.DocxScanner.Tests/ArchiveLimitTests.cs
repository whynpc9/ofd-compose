using System.IO.Compression;
using Xunit;

namespace OFDCompose.DocxScanner.Tests;

public class ArchiveLimitTests
{
    [Fact]
    public void Compressed_size_limit_is_enforced()
    {
        var path = DocxFixture.CreateDocx(body => body.Append(DocxFixture.Para("{patient.name}")));
        var limits = DocxArchiveLimits.Default with { MaxCompressedBytes = 16 };

        var exception = Assert.Throws<InvalidDataException>(() => DocxScan.ScanFile(path, null, limits));
        Assert.Contains("compressed size limit", exception.Message, StringComparison.Ordinal);
    }

    [Fact]
    public void Entry_count_limit_is_enforced()
    {
        var path = DocxFixture.CreateDocx(body => body.Append(DocxFixture.Para("{patient.name}")));
        var limits = DocxArchiveLimits.Default with { MaxEntries = 1 };

        var exception = Assert.Throws<InvalidDataException>(() => DocxScan.ScanFile(path, null, limits));
        Assert.Contains("entry count limit", exception.Message, StringComparison.Ordinal);
    }

    [Fact]
    public void Expanded_size_limit_is_enforced_per_entry()
    {
        byte[] bytes;
        using (var stream = new MemoryStream())
        {
            using (var archive = new ZipArchive(stream, ZipArchiveMode.Create))
            {
                var entry = archive.CreateEntry("big.xml");
                using var writer = new BinaryWriter(entry.Open());
                writer.Write(new byte[64 * 1024]);
            }

            bytes = stream.ToArray();
        }

        var limits = DocxArchiveLimits.Default with { MaxExpandedBytesPerEntry = 1024 };

        var exception = Assert.Throws<InvalidDataException>(() => DocxScan.Scan("big.docx", bytes, null, limits));
        Assert.Contains("expanded size limit", exception.Message, StringComparison.Ordinal);
    }

    [Fact]
    public void Default_limits_accept_normal_documents()
    {
        var path = DocxFixture.CreateDocx(body => body.Append(DocxFixture.Para("{patient.name}")));

        var report = DocxScan.ScanFile(path, null, DocxArchiveLimits.Default);

        Assert.Single(report.Tags);
    }
}
