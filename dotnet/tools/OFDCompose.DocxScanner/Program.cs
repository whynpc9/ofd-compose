namespace OFDCompose.DocxScanner;

public static class Program
{
    public static int Main(string[] args)
    {
        if (args.Length == 0)
        {
            return Usage();
        }

        var command = args[0];
        var positional = new List<string>();
        string? dataPath = null;
        string? outDir = null;
        for (var index = 1; index < args.Length; index++)
        {
            switch (args[index])
            {
                case "--data" when index + 1 < args.Length:
                    dataPath = args[++index];
                    break;
                case "--out" when index + 1 < args.Length:
                    outDir = args[++index];
                    break;
                case { } argument when !argument.StartsWith("--", StringComparison.Ordinal):
                    positional.Add(argument);
                    break;
                default:
                    Console.Error.WriteLine($"Unknown or incomplete option: {args[index]}");
                    return Usage();
            }
        }

        try
        {
            return command switch
            {
                "scan" => Scan(positional, dataPath, outDir),
                "corpus" => Corpus(positional, outDir),
                _ => Usage(),
            };
        }
        catch (Exception exception) when (exception is IOException or InvalidOperationException or UnauthorizedAccessException)
        {
            Console.Error.WriteLine($"error: {exception.Message}");
            return 1;
        }
    }

    private static int Scan(IReadOnlyList<string> positional, string? dataPath, string? outDir)
    {
        if (positional.Count != 1)
        {
            return Usage();
        }

        var input = positional[0];
        if (File.Exists(input))
        {
            var report = DocxScan.ScanFile(input, dataPath);
            var outputDirectory = outDir ?? Path.GetDirectoryName(Path.GetFullPath(input))!;
            var outputPath = Path.Combine(
                outputDirectory,
                Path.GetFileNameWithoutExtension(input) + ".scan.json");
            DeterministicJson.WriteFile(outputPath, report, ScanReportJsonContext.Default.ScanReport);
            Console.WriteLine(outputPath);
            return 0;
        }

        if (Directory.Exists(input))
        {
            var outputRoot = outDir ?? Path.Combine(input, "scan-reports");
            var files = Directory
                .EnumerateFiles(input, "*.docx", SearchOption.AllDirectories)
                .OrderBy(static file => file, StringComparer.Ordinal);
            var count = 0;
            foreach (var file in files)
            {
                var sidecar = dataPath
                    ?? (File.Exists(Path.Combine(Path.GetDirectoryName(file)!, "data.json"))
                        ? Path.Combine(Path.GetDirectoryName(file)!, "data.json")
                        : null);
                var report = DocxScan.ScanFile(file, sidecar);
                var relative = Path.GetRelativePath(input, Path.GetDirectoryName(file)!);
                var outputPath = Path.Combine(
                    outputRoot,
                    relative,
                    Path.GetFileNameWithoutExtension(file) + ".scan.json");
                DeterministicJson.WriteFile(outputPath, report, ScanReportJsonContext.Default.ScanReport);
                Console.WriteLine(outputPath);
                count++;
            }

            Console.Error.WriteLine($"scanned {count} DOCX file(s)");
            return 0;
        }

        Console.Error.WriteLine($"error: input not found: {input}");
        return 1;
    }

    private static int Corpus(IReadOnlyList<string> positional, string? outDir)
    {
        if (positional.Count != 1)
        {
            return Usage();
        }

        var corpusRoot = positional[0];
        var outputRoot = outDir ?? Path.Combine(corpusRoot, "scan-reports");
        var report = CorpusScan.Run(corpusRoot, outputRoot);
        Console.WriteLine(Path.Combine(outputRoot, "migration-report.json"));
        Console.Error.WriteLine(
            $"templates: {report.Totals.Templates} (auto {report.Totals.Auto}, needs-review {report.Totals.NeedsReview}, unsupported {report.Totals.Unsupported}), tags: {report.Totals.Tags}");
        return 0;
    }

    private static int Usage()
    {
        Console.Error.WriteLine(
            """
            OFDCompose.DocxScanner — legacy NDocxTemplater DOCX scanner (inventory only).

              OFDCompose.DocxScanner scan <input.docx|dir> [--data data.json] [--out <dir>]
              OFDCompose.DocxScanner corpus <corpusRoot> [--out <dir>]   # default out: <corpusRoot>/scan-reports

            The scanner never executes expression semantics and never opens image file paths.
            """);
        return 2;
    }
}
