using System.Text.Json.Nodes;

namespace OFDCompose.DocxScanner;

/// <summary>
/// Corpus mode: scans every template.docx / template.generated.docx under
/// &lt;corpusRoot&gt;/library/**, writes one scan report per template plus an aggregate
/// migration-report.json.
/// </summary>
public static class CorpusScan
{
    public const string MigrationReportNote = "MigrationReport 骨架：逐节点政策随受限导入器（后续票）落地";
    public const string FallbackLegacyCommit = "9c02f26d0f81b554019441e348f981b67e11a4e7";

    private static readonly string[] TemplateNames = ["template.docx", "template.generated.docx"];

    public static MigrationReport Run(string corpusRoot, string outDir)
    {
        var root = Path.GetFullPath(corpusRoot);
        var libraryRoot = Path.Combine(root, "library");
        if (!Directory.Exists(libraryRoot))
        {
            throw new DirectoryNotFoundException($"Corpus library not found: {libraryRoot}");
        }

        var caseDirs = Directory
            .EnumerateDirectories(libraryRoot, "*", SearchOption.AllDirectories)
            .Where(dir => TemplateNames.Any(name => File.Exists(Path.Combine(dir, name))))
            .OrderBy(static dir => dir, StringComparer.Ordinal)
            .ToList();

        var entries = new List<MigrationReportEntry>();
        var legacyCommits = new SortedSet<string>(StringComparer.Ordinal);
        var diagnosticCount = 0;

        foreach (var caseDir in caseDirs)
        {
            var relativeCaseDir = Path.GetRelativePath(root, caseDir).Replace(Path.DirectorySeparatorChar, '/');
            var dataPath = Path.Combine(caseDir, "data.json");

            var manifestPath = Path.Combine(caseDir, "case.json");
            if (File.Exists(manifestPath))
            {
                var commit = JsonNode.Parse(File.ReadAllText(manifestPath))?["legacyCommit"]?.GetValue<string>();
                if (!string.IsNullOrEmpty(commit))
                {
                    legacyCommits.Add(commit);
                }
            }

            foreach (var templateName in TemplateNames)
            {
                var templatePath = Path.Combine(caseDir, templateName);
                if (!File.Exists(templatePath))
                {
                    continue;
                }

                // ScanFile (not File.ReadAllBytes + Scan) so archive limits are
                // enforced before the file is read into memory.
                var report = DocxScan.ScanFile(templatePath, File.Exists(dataPath) ? dataPath : null);
                var baseName = Path.GetFileNameWithoutExtension(templateName);
                var reportRelative = $"{relativeCaseDir}/{baseName}.scan.json";
                DeterministicJson.WriteFile(
                    Path.Combine(outDir, reportRelative),
                    report,
                    ScanReportJsonContext.Default.ScanReport);

                entries.Add(
                    new MigrationReportEntry(
                        $"{relativeCaseDir}/{templateName}",
                        reportRelative,
                        report.MigrationStatus,
                        report.Risk,
                        report.Summary.TagCount,
                        report.LegacySemanticChanges));
                diagnosticCount += report.Diagnostics.Count;
            }
        }

        var totals = new MigrationTotals(
            entries.Count,
            entries.Count(static entry => entry.MigrationStatus == "auto"),
            entries.Count(static entry => entry.MigrationStatus == "needs-review"),
            entries.Count(static entry => entry.MigrationStatus == "unsupported"),
            entries.Sum(static entry => entry.TagCount),
            diagnosticCount,
            entries.Sum(static entry => entry.LegacySemanticChanges.Count));

        var migrationReport = new MigrationReport(
            DocxScan.MigrationReportFormat,
            MigrationReportNote,
            legacyCommits.Count > 0 ? legacyCommits.Min! : FallbackLegacyCommit,
            entries,
            totals);

        DeterministicJson.WriteFile(
            Path.Combine(outDir, "migration-report.json"),
            migrationReport,
            ScanReportJsonContext.Default.MigrationReport);

        return migrationReport;
    }
}
