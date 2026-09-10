using Xunit;

namespace OFDCompose.DocxScanner.Tests;

public class HeaderFooterTests
{
    [Fact]
    public void Header_and_footer_tags_are_scope_discoverable_only()
    {
        var path = DocxFixture.CreateDocx(
            body => body.Append(DocxFixture.Para("{patient.name}")),
            headerText: "Patient {patient.name} confidential",
            footerText: "Page {page.number}");

        var report = DocxScan.ScanFile(path);

        // Body inventory is unaffected by header/footer content.
        Assert.Equal(1, report.Summary.TagCount);
        Assert.Equal(["patient.name"], report.Summary.DataPaths);
        Assert.Empty(report.Diagnostics);

        Assert.Equal(2, report.HeadersFooters.Parts.Count);
        var footer = report.HeadersFooters.Parts[0];
        var header = report.HeadersFooters.Parts[1];
        Assert.Equal("footer", footer.PartKind);
        Assert.Equal("word/footer1.xml", footer.Name);
        Assert.Equal("header", header.PartKind);
        Assert.Equal("word/header1.xml", header.Name);
        Assert.Equal(1, header.TagCount);
        Assert.Equal(["{patient.name}"], header.Tags);
        Assert.Equal(DocxScan.HeaderFooterNote, header.Note);
        Assert.Equal(DocxScan.HeaderFooterNote, footer.Note);
        Assert.Equal(
            "静态页眉页脚内容：旧引擎不处理页眉页脚（仅范围发现，非旧引擎动态渲染证据）",
            header.Note);
    }
}
