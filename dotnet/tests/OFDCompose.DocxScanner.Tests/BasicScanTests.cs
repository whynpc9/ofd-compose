using Xunit;

namespace OFDCompose.DocxScanner.Tests;

public class BasicScanTests
{
    [Fact]
    public void Inline_tags_with_array_index_paths_are_inventoried()
    {
        var path = DocxFixture.CreateDocx(body =>
        {
            body.Append(DocxFixture.Para("Patient: {patient.name}"));
            body.Append(DocxFixture.Para("First code: {report.items[0].code}"));
            body.Append(DocxFixture.Para("Last value: {report.items[1].value}"));
        });

        var report = DocxScan.ScanFile(path);

        Assert.Equal("ofd-compose/scan-report@1", report.Format);
        Assert.Equal(new ScannerInfo("OFDCompose.DocxScanner", "0.1.0"), report.Scanner);
        Assert.Equal(3, report.Summary.TagCount);
        Assert.Equal(3, report.Summary.InlineExpressions);
        Assert.Equal(0, report.Summary.Loops);
        Assert.Equal(0, report.Summary.Images);
        Assert.Equal(
            ["patient.name", "report.items[0].code", "report.items[1].value"],
            report.Summary.DataPaths);
        Assert.All(report.Tags, tag => Assert.Equal("inline-expression", tag.Kind));
        Assert.All(report.Tags, tag => Assert.False(tag.BlockLevel));
        Assert.Equal(1, report.Tags[1].Location.ParagraphIndex);
        Assert.Equal("report.items[0].code", report.Tags[1].Pipeline?.Path);
        Assert.Empty(report.Diagnostics);
        Assert.Equal("low", report.Risk);
        Assert.Equal("auto", report.MigrationStatus);
    }

    [Fact]
    public void Split_run_tag_is_merged_and_flagged()
    {
        var path = DocxFixture.CreateDocx(body =>
            body.Append(DocxFixture.Para("{createdAt|for", "mat:date:yyyy-MM-", "dd}")));

        var report = DocxScan.ScanFile(path);

        var tag = Assert.Single(report.Tags);
        Assert.Equal("{createdAt|format:date:yyyy-MM-dd}", tag.RawText);
        Assert.True(tag.SplitAcrossRuns);
        Assert.Equal(3, tag.RunCount);
        Assert.Equal("createdAt", tag.Pipeline?.Path);
        Assert.Equal("format", tag.Pipeline?.Operations[0].Name);
        Assert.Equal(["date", "yyyy-MM-dd"], tag.Pipeline?.Operations[0].Args);
        Assert.Contains(report.Diagnostics, d => d.Code == "SPLIT_RUN_TAG" && d.Severity == "info");
        Assert.Contains(
            report.Summary.FormatPatterns,
            pattern => pattern.Kind == "date" && pattern.Pattern == "yyyy-MM-dd" && pattern.Alias == null);
    }

    [Fact]
    public void Report_serializes_deterministically_and_round_trips()
    {
        var path = DocxFixture.CreateDocx(body =>
        {
            body.Append(DocxFixture.Para("{#orders|sort:amount:desc|take:2}"));
            body.Append(DocxFixture.Para("{id} -> {amount|format:number:0.00}"));
            body.Append(DocxFixture.Para("{/orders|sort:amount:desc|take:2}"));
        });

        var report = DocxScan.ScanFile(path);
        var json = DocxScan.ToJson(report);
        var roundTripped = DocxScan.ReportFromJson(json);

        Assert.NotNull(roundTripped);
        Assert.Equal(json, DocxScan.ToJson(roundTripped!));
        Assert.True(json.EndsWith('\n'));
        Assert.Contains("\"format\": \"ofd-compose/scan-report@1\"", json);
    }
}
