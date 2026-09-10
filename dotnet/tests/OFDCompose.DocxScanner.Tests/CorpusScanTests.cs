using Xunit;

namespace OFDCompose.DocxScanner.Tests;

public class CorpusScanTests
{
    [Fact]
    public void Corpus_mode_scans_templates_and_aggregates_migration_report()
    {
        var root = Path.Combine(Path.GetTempPath(), "ofd-corpus-scan-tests", Guid.NewGuid().ToString("N"));
        var caseDir = Path.Combine(root, "library", "examples", "01-case");
        Directory.CreateDirectory(caseDir);

        var fixturePath = DocxFixture.CreateDocx(body =>
        {
            body.Append(DocxFixture.Para("Hello {name}"));
            body.Append(DocxFixture.Para("{#items}"));
            body.Append(DocxFixture.Para("{/items}"));
        });
        File.Copy(fixturePath, Path.Combine(caseDir, "template.docx"));
        File.WriteAllText(Path.Combine(caseDir, "data.json"), """{"name": "Alice", "items": [1, 2]}""");
        File.WriteAllText(
            Path.Combine(caseDir, "case.json"),
            """{"caseId": "x", "legacyCommit": "9c02f26d0f81b554019441e348f981b67e11a4e7"}""");

        var outDir = Path.Combine(root, "scan-reports");
        var report = CorpusScan.Run(root, outDir);

        Assert.Equal("ofd-compose/migration-report@0", report.Format);
        Assert.Equal(CorpusScan.MigrationReportNote, report.Note);
        Assert.Equal("9c02f26d0f81b554019441e348f981b67e11a4e7", report.LegacyCommit);

        var entry = Assert.Single(report.Templates);
        Assert.Equal("library/examples/01-case/template.docx", entry.File);
        Assert.Equal("library/examples/01-case/template.scan.json", entry.Report);
        Assert.Equal("auto", entry.MigrationStatus);
        Assert.Equal(3, entry.TagCount);
        Assert.Equal(new MigrationTotals(1, 1, 0, 0, 3, 0, 0), report.Totals);

        var reportPath = Path.Combine(outDir, "library", "examples", "01-case", "template.scan.json");
        Assert.True(File.Exists(reportPath));
        Assert.True(File.Exists(Path.Combine(outDir, "migration-report.json")));

        var scanReport = DocxScan.ReportFromJson(File.ReadAllText(reportPath));
        Assert.NotNull(scanReport);
        Assert.Equal(1, scanReport!.Summary.Loops);
        Assert.Equal("template.docx", scanReport.File.Name);
        Assert.Equal(64, scanReport.File.Sha256.Length);

        // Round-trip of the aggregate report.
        var migrationJson = File.ReadAllText(Path.Combine(outDir, "migration-report.json"));
        var roundTripped = DocxScan.MigrationReportFromJson(migrationJson);
        Assert.Equal(migrationJson, DocxScan.ToJson(roundTripped!));
    }
}
