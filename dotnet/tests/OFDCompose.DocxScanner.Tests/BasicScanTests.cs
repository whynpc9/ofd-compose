using DocumentFormat.OpenXml;
using DocumentFormat.OpenXml.Wordprocessing;
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

        var spans = tag.RunSpans;
        Assert.NotNull(spans);
        Assert.Equal(3, spans.Count);
        Assert.Equal(new RunStyleSpan(0, 14, 0, null), spans[0]);
        Assert.Equal(new RunStyleSpan(14, 17, 1, null), spans[1]);
        Assert.Equal(new RunStyleSpan(31, 3, 2, null), spans[2]);
    }

    [Fact]
    public void Split_tag_style_map_captures_run_properties_on_both_sides()
    {
        var path = DocxFixture.CreateDocx(body =>
        {
            var paragraph = new Paragraph();
            paragraph.Append(new Run(
                new RunProperties(new Bold()),
                new Text("Dear ") { Space = SpaceProcessingModeValues.Preserve }));
            paragraph.Append(new Run(new Text("{patient.na") { Space = SpaceProcessingModeValues.Preserve }));
            paragraph.Append(new Run(
                new RunProperties(new Italic()),
                new Text("me}") { Space = SpaceProcessingModeValues.Preserve }));
            body.Append(paragraph);
        });

        var report = DocxScan.ScanFile(path);

        var tag = Assert.Single(report.Tags);
        Assert.True(tag.SplitAcrossRuns);
        var spans = tag.RunSpans;
        Assert.NotNull(spans);
        Assert.Equal(3, spans.Count);
        Assert.Equal(0, spans[0].Start);
        Assert.Equal(5, spans[0].Length);
        Assert.Contains("<w:b", spans[0].RunPropertiesXml, StringComparison.Ordinal);
        Assert.Equal(5, spans[1].Start);
        Assert.Equal(11, spans[1].Length);
        Assert.Null(spans[1].RunPropertiesXml);
        Assert.Equal(16, spans[2].Start);
        Assert.Equal(3, spans[2].Length);
        Assert.Contains("<w:i", spans[2].RunPropertiesXml, StringComparison.Ordinal);
    }

    [Fact]
    public void Non_split_tag_has_no_style_map()
    {
        var path = DocxFixture.CreateDocx(body => body.Append(DocxFixture.Para("{patient.name}")));

        var report = DocxScan.ScanFile(path);

        var tag = Assert.Single(report.Tags);
        Assert.False(tag.SplitAcrossRuns);
        Assert.Null(tag.RunSpans);
    }

    [Fact]
    public void Summary_counts_occurrences_per_distinct_expression()
    {
        var path = DocxFixture.CreateDocx(body =>
        {
            body.Append(DocxFixture.Para("A {patient.name}"));
            body.Append(DocxFixture.Para("B {patient.name}"));
            body.Append(DocxFixture.Para("C {patient.name}"));
            body.Append(DocxFixture.Para("once {report.items[0].code}"));
            body.Append(DocxFixture.Para("{#orders|sort:amount:desc}"));
            body.Append(DocxFixture.Para("{/orders|sort:amount:desc}"));
        });

        var report = DocxScan.ScanFile(path);

        Assert.Equal(
            [
                new OccurrenceCount("orders|sort:amount:desc", 2),
                new OccurrenceCount("patient.name", 3),
                new OccurrenceCount("report.items[0].code", 1),
            ],
            report.Summary.Occurrences);
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
