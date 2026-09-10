using DocumentFormat.OpenXml;
using DocumentFormat.OpenXml.Packaging;
using DocumentFormat.OpenXml.Wordprocessing;

namespace OFDCompose.DocxScanner.Tests;

/// <summary>Builds DOCX fixtures in-memory via OpenXML and writes them to temp files.</summary>
internal static class DocxFixture
{
    public static string CreateDocx(Action<Body> build, string? headerText = null, string? footerText = null)
    {
        var path = Path.Combine(
            Path.GetTempPath(),
            "ofd-docx-scanner-tests",
            Guid.NewGuid().ToString("N") + ".docx");
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);

        using (var document = WordprocessingDocument.Create(path, WordprocessingDocumentType.Document))
        {
            var mainPart = document.AddMainDocumentPart();
            var body = new Body();
            mainPart.Document = new Document(body);
            build(body);

            if (headerText != null)
            {
                var headerPart = mainPart.AddNewPart<HeaderPart>();
                headerPart.Header = new Header(Para(headerText));
            }

            if (footerText != null)
            {
                var footerPart = mainPart.AddNewPart<FooterPart>();
                footerPart.Footer = new Footer(Para(footerText));
            }

            mainPart.Document.Save();
        }

        return path;
    }

    public static string CreateDataJson(string json)
    {
        var path = Path.Combine(
            Path.GetTempPath(),
            "ofd-docx-scanner-tests",
            Guid.NewGuid().ToString("N") + ".json");
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        File.WriteAllText(path, json);
        return path;
    }

    /// <summary>One paragraph; each argument becomes one run (split-run fixtures pass several).</summary>
    public static Paragraph Para(params string[] runs)
    {
        var paragraph = new Paragraph();
        foreach (var run in runs)
        {
            paragraph.Append(new Run(new Text(run) { Space = SpaceProcessingModeValues.Preserve }));
        }

        return paragraph;
    }

    public static TableRow Row(params string[] cells)
    {
        var row = new TableRow();
        foreach (var cell in cells)
        {
            row.Append(new TableCell(Para(cell)));
        }

        return row;
    }

    public static Table Table(params TableRow[] rows)
    {
        return new Table(rows);
    }
}
