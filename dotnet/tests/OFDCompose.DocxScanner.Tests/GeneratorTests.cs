using Xunit;

namespace OFDCompose.DocxScanner.Tests;

public class GeneratorTests
{
    private static readonly string[] TemplateLines =
    [
        "Name | Created header row stays a normal table row:",
        "@table-begin",
        "| Name | Created |",
        "| {#rows} |  |",
        "| {name} | <run>{createdAt|for</run><run>mat:date:yyyy-MM-</run><run>dd}</run> |",
        "| {/rows} |  |",
        "@table-end",
    ];

    [Fact]
    public void Generated_docx_scans_like_equivalent_hand_built_fixture()
    {
        var generatedPath = Path.Combine(
            Path.GetTempPath(),
            "ofd-docx-scanner-tests",
            Guid.NewGuid().ToString("N") + ".docx");
        Directory.CreateDirectory(Path.GetDirectoryName(generatedPath)!);
        CorpusDocxGenerator.TemplateDocxBuilder.GenerateFileFromLines(TemplateLines, generatedPath);

        var handBuiltPath = DocxFixture.CreateDocx(body =>
        {
            body.Append(DocxFixture.Para("Name | Created header row stays a normal table row:"));
            body.Append(
                DocxFixture.Table(
                    DocxFixture.Row("Name", "Created"),
                    DocxFixture.Row("{#rows}", ""),
                    new DocumentFormat.OpenXml.Wordprocessing.TableRow(
                        new DocumentFormat.OpenXml.Wordprocessing.TableCell(DocxFixture.Para("{name}")),
                        new DocumentFormat.OpenXml.Wordprocessing.TableCell(
                            DocxFixture.Para("{createdAt|for", "mat:date:yyyy-MM-", "dd}"))),
                    DocxFixture.Row("{/rows}", "")));
        });

        var generated = DocxScan.ScanFile(generatedPath);
        var handBuilt = DocxScan.ScanFile(handBuiltPath);

        static object Projection(ScanReport report)
        {
            return report.Tags.Select(tag => new
            {
                tag.RawText,
                tag.Kind,
                tag.BlockLevel,
                tag.RowLevel,
                tag.SplitAcrossRuns,
                tag.RunCount,
                tag.Expression,
                Scope = tag.Location.Scope,
            }).ToList();
        }

        var generatedTags = Projection(generated);
        var handBuiltTags = Projection(handBuilt);
        Assert.Equal(handBuiltTags, generatedTags);

        var splitTag = generated.Tags.Single(tag => tag.RawText == "{createdAt|format:date:yyyy-MM-dd}");
        Assert.True(splitTag.SplitAcrossRuns);
        Assert.Equal(3, splitTag.RunCount);
        Assert.Contains(generated.Diagnostics, d => d.Code == "SPLIT_RUN_TAG");

        var block = Assert.Single(generated.ControlBlocks);
        Assert.True(block.Paired);
        Assert.Equal("table-row", block.Scope);
    }

    [Fact]
    public void Generated_docx_bytes_are_deterministic()
    {
        var dir = Path.Combine(Path.GetTempPath(), "ofd-docx-scanner-tests", Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(dir);
        var first = Path.Combine(dir, "a.docx");
        var second = Path.Combine(dir, "b.docx");

        CorpusDocxGenerator.TemplateDocxBuilder.GenerateFileFromLines(TemplateLines, first);
        CorpusDocxGenerator.TemplateDocxBuilder.GenerateFileFromLines(TemplateLines, second);

        Assert.Equal(File.ReadAllBytes(first), File.ReadAllBytes(second));
    }
}
