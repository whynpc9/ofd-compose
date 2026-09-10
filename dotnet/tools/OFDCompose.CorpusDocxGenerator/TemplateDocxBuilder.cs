using System.Text.RegularExpressions;
using DocumentFormat.OpenXml;
using DocumentFormat.OpenXml.Packaging;
using DocumentFormat.OpenXml.Wordprocessing;

namespace OFDCompose.CorpusDocxGenerator;

/// <summary>
/// Builds a deterministic minimal DOCX from a corpus template.txt:
/// one line = one paragraph (single run), @table-begin/@table-end bracket tables whose
/// "| cell | cell |" lines are rows, and consecutive &lt;run&gt;…&lt;/run&gt; fragments in a
/// line become consecutive runs of one paragraph (split-run fixtures).
/// </summary>
public static class TemplateDocxBuilder
{
    private static readonly Regex RunFragmentRegex = new(@"<run>(.*?)</run>", RegexOptions.Compiled);

    public static void GenerateFile(string templateTxtPath, string outputDocxPath)
    {
        GenerateFileFromLines(File.ReadAllLines(templateTxtPath), outputDocxPath);
    }

    public static void GenerateFileFromLines(IReadOnlyList<string> lines, string outputDocxPath)
    {
        using var stream = new MemoryStream();
        Build(lines, stream);
        File.WriteAllBytes(outputDocxPath, stream.ToArray());
        ZipTimestampNormalizer.Normalize(outputDocxPath);
    }

    public static void Build(IReadOnlyList<string> lines, Stream output)
    {
        using (var document = WordprocessingDocument.Create(output, WordprocessingDocumentType.Document))
        {
            var mainPart = document.AddMainDocumentPart();
            var body = new Body();
            mainPart.Document = new Document(body);

            Table? currentTable = null;
            foreach (var line in lines)
            {
                var trimmed = line.Trim();
                if (trimmed == "@table-begin")
                {
                    if (currentTable != null)
                    {
                        throw new InvalidOperationException("Nested @table-begin in template.txt.");
                    }

                    currentTable = new Table();
                    continue;
                }

                if (trimmed == "@table-end")
                {
                    if (currentTable == null)
                    {
                        throw new InvalidOperationException("@table-end without @table-begin in template.txt.");
                    }

                    body.Append(currentTable);
                    currentTable = null;
                    continue;
                }

                if (currentTable != null)
                {
                    currentTable.Append(BuildRow(line));
                }
                else
                {
                    body.Append(BuildParagraph(line));
                }
            }

            if (currentTable != null)
            {
                throw new InvalidOperationException("template.txt ends inside @table-begin/@table-end block.");
            }

            mainPart.Document.Save();

            // Fixed core properties: generated DOCX bytes must be byte-reproducible.
            var properties = document.PackageProperties;
            properties.Creator = "OFDCompose.CorpusDocxGenerator";
            properties.Title = "";
            properties.Created = new DateTime(2026, 1, 1, 0, 0, 0, DateTimeKind.Utc);
            properties.Modified = new DateTime(2026, 1, 1, 0, 0, 0, DateTimeKind.Utc);
            properties.LastModifiedBy = "OFDCompose.CorpusDocxGenerator";
        }
    }

    private static TableRow BuildRow(string line)
    {
        var row = new TableRow();
        foreach (var cell in SplitCells(line))
        {
            row.Append(new TableCell(BuildParagraph(cell)));
        }

        return row;
    }

    /// <summary>
    /// Splits a "| a | b |" row into trimmed cell texts. A pipe inside a {...} tag
    /// (e.g. a pipeline expression) is not a cell separator.
    /// </summary>
    internal static List<string> SplitCells(string line)
    {
        var trimmed = line.Trim();
        if (trimmed.Length < 2 || trimmed[0] != '|' || trimmed[^1] != '|')
        {
            throw new InvalidOperationException($"Table row must start and end with '|': '{line}'.");
        }

        var inner = trimmed.Substring(1, trimmed.Length - 2);
        var cells = new List<string>();
        var depth = 0;
        var start = 0;
        for (var index = 0; index < inner.Length; index++)
        {
            switch (inner[index])
            {
                case '{':
                    depth++;
                    break;
                case '}':
                    depth = Math.Max(0, depth - 1);
                    break;
                case '|' when depth == 0:
                    cells.Add(inner.Substring(start, index - start).Trim());
                    start = index + 1;
                    break;
            }
        }

        cells.Add(inner.Substring(start).Trim());
        return cells;
    }

    private static Paragraph BuildParagraph(string content)
    {
        var paragraph = new Paragraph();
        foreach (var run in SplitRuns(content))
        {
            if (run.Length == 0)
            {
                continue;
            }

            paragraph.Append(new Run(new Text(run) { Space = SpaceProcessingModeValues.Preserve }));
        }

        return paragraph;
    }

    /// <summary>Consecutive &lt;run&gt;…&lt;/run&gt; fragments become consecutive runs.</summary>
    internal static List<string> SplitRuns(string content)
    {
        var runs = new List<string>();
        var position = 0;
        foreach (var match in RunFragmentRegex.Matches(content).Cast<Match>())
        {
            if (match.Index > position)
            {
                var literal = content.Substring(position, match.Index - position).Trim();
                if (literal.Length > 0)
                {
                    runs.Add(literal);
                }
            }

            runs.Add(match.Groups[1].Value);
            position = match.Index + match.Length;
        }

        if (position < content.Length)
        {
            var literal = content.Substring(position).Trim();
            if (literal.Length > 0)
            {
                runs.Add(literal);
            }
        }

        return runs;
    }
}
