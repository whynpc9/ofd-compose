namespace OFDCompose.CorpusDocxGenerator;

public static class Program
{
    public static int Main(string[] args)
    {
        if (args.Length != 1)
        {
            Console.Error.WriteLine("OFDCompose.CorpusDocxGenerator <corpusRoot>");
            Console.Error.WriteLine(
                "Generates template.generated.docx next to every library/docx-tests/<case>/template.txt.");
            return 2;
        }

        var corpusRoot = Path.GetFullPath(args[0]);
        var docxTestsRoot = Path.Combine(corpusRoot, "library", "docx-tests");
        if (!Directory.Exists(docxTestsRoot))
        {
            Console.Error.WriteLine($"error: corpus docx-tests directory not found: {docxTestsRoot}");
            return 1;
        }

        var templates = Directory
            .EnumerateFiles(docxTestsRoot, "template.txt", SearchOption.AllDirectories)
            .OrderBy(static file => file, StringComparer.Ordinal)
            .ToList();

        foreach (var template in templates)
        {
            var output = Path.Combine(Path.GetDirectoryName(template)!, "template.generated.docx");
            TemplateDocxBuilder.GenerateFile(template, output);
            Console.WriteLine(output);
        }

        Console.Error.WriteLine($"generated {templates.Count} DOCX file(s)");
        return 0;
    }
}
