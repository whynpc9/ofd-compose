using System.IO.Compression;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using DocumentFormat.OpenXml;
using DocumentFormat.OpenXml.Packaging;
using DocumentFormat.OpenXml.Wordprocessing;

namespace OFDCompose.DocxScanner;

/// <summary>
/// Input bounds for DOCX archives (spec: ZIP/XML inputs get size and structure limits
/// so hostile input cannot exhaust memory or CPU). Enforced before OpenXML parsing:
/// compressed size, entry count, and both declared and actually inflated entry sizes.
/// </summary>
public sealed record DocxArchiveLimits(
    long MaxCompressedBytes,
    int MaxEntries,
    long MaxExpandedBytesPerEntry,
    long MaxExpandedBytesTotal)
{
    public static DocxArchiveLimits Default { get; } = new(
        MaxCompressedBytes: 256L * 1024 * 1024,
        MaxEntries: 10_000,
        MaxExpandedBytesPerEntry: 512L * 1024 * 1024,
        MaxExpandedBytesTotal: 2L * 1024 * 1024 * 1024);
}

public static class DocxScan
{
    public const string ReportFormat = "ofd-compose/scan-report@1";
    public const string MigrationReportFormat = "ofd-compose/migration-report@0";
    public const string ScannerName = "OFDCompose.DocxScanner";
    public const string ScannerVersion = "0.1.0";
    public const string HeaderFooterNote = "静态页眉页脚内容：旧引擎不处理页眉页脚（仅范围发现，非旧引擎动态渲染证据）";

    public static ScanReport ScanFile(string docxPath, string? dataJsonPath = null, DocxArchiveLimits? limits = null)
    {
        var effectiveLimits = limits ?? DocxArchiveLimits.Default;
        var fileLength = new FileInfo(docxPath).Length;
        if (fileLength > effectiveLimits.MaxCompressedBytes)
        {
            throw new InvalidDataException(
                $"DOCX archive exceeds the compressed size limit ({fileLength} > {effectiveLimits.MaxCompressedBytes} bytes).");
        }

        var bytes = File.ReadAllBytes(docxPath);
        JsonNode? data = null;
        if (dataJsonPath != null)
        {
            data = JsonNode.Parse(File.ReadAllText(dataJsonPath));
        }

        return Scan(Path.GetFileName(docxPath), bytes, data, effectiveLimits);
    }

    public static ScanReport Scan(string fileName, byte[] docxBytes, JsonNode? data, DocxArchiveLimits? limits = null)
    {
        ValidateArchive(docxBytes, limits ?? DocxArchiveLimits.Default);
        var sha256 = Convert.ToHexString(SHA256.HashData(docxBytes)).ToLowerInvariant();
        using var stream = new MemoryStream(docxBytes, writable: false);
        using var document = WordprocessingDocument.Open(stream, isEditable: false);
        return new ScanEngine(fileName, sha256, data).Run(document);
    }

    private static void ValidateArchive(byte[] bytes, DocxArchiveLimits limits)
    {
        if (bytes.LongLength > limits.MaxCompressedBytes)
        {
            throw new InvalidDataException(
                $"DOCX archive exceeds the compressed size limit ({bytes.LongLength} > {limits.MaxCompressedBytes} bytes).");
        }

        using var stream = new MemoryStream(bytes, writable: false);
        using var archive = new ZipArchive(stream, ZipArchiveMode.Read);
        if (archive.Entries.Count > limits.MaxEntries)
        {
            throw new InvalidDataException(
                $"DOCX archive exceeds the entry count limit ({archive.Entries.Count} > {limits.MaxEntries}).");
        }

        // Declared sizes come from the central directory and can lie, so every entry
        // is additionally inflated under a hard cap to catch understated lengths.
        var buffer = new byte[81920];
        long expandedTotal = 0;
        foreach (var entry in archive.Entries)
        {
            if (entry.Length > limits.MaxExpandedBytesPerEntry)
            {
                throw new InvalidDataException(
                    $"DOCX entry '{entry.FullName}' exceeds the expanded size limit ({entry.Length} > {limits.MaxExpandedBytesPerEntry} bytes).");
            }

            long inflated = 0;
            using (var entryStream = entry.Open())
            {
                int read;
                while ((read = entryStream.Read(buffer, 0, buffer.Length)) > 0)
                {
                    inflated += read;
                    expandedTotal += read;
                    if (inflated > limits.MaxExpandedBytesPerEntry)
                    {
                        throw new InvalidDataException(
                            $"DOCX entry '{entry.FullName}' inflates beyond the expanded size limit ({limits.MaxExpandedBytesPerEntry} bytes).");
                    }

                    if (expandedTotal > limits.MaxExpandedBytesTotal)
                    {
                        throw new InvalidDataException(
                            $"DOCX archive inflates beyond the total expanded size limit ({limits.MaxExpandedBytesTotal} bytes).");
                    }
                }
            }
        }
    }

    public static string ToJson(ScanReport report)
    {
        return DeterministicJson.Serialize(report, ScanReportJsonContext.Default.ScanReport);
    }

    public static string ToJson(MigrationReport report)
    {
        return DeterministicJson.Serialize(report, ScanReportJsonContext.Default.MigrationReport);
    }

    public static ScanReport? ReportFromJson(string json)
    {
        return JsonSerializer.Deserialize(json, ScanReportJsonContext.Default.ScanReport);
    }

    public static MigrationReport? MigrationReportFromJson(string json)
    {
        return JsonSerializer.Deserialize(json, ScanReportJsonContext.Default.MigrationReport);
    }
}

internal enum ControlKind
{
    LoopStart,
    LoopEnd,
    IfStart,
    IfEnd,
}

internal sealed class PairingScope
{
    /// <summary>Report-facing scope name: body | table-row | table-cell.</summary>
    public required string Display { get; init; }

    public List<MarkerInstance> Markers { get; } = [];
}

internal sealed class MarkerInstance
{
    public required ControlKind Kind { get; init; }

    public required string Expression { get; init; }

    public required string RawText { get; init; }

    public required TagLocation Location { get; init; }

    public required PairingScope Scope { get; init; }

    public int Sequence { get; set; }

    public bool IsStart => Kind is ControlKind.LoopStart or ControlKind.IfStart;

    public bool IsEnd => Kind is ControlKind.LoopEnd or ControlKind.IfEnd;

    public bool Paired { get; set; }

    public MarkerInstance? MatchedEnd { get; set; }

    public int Depth { get; set; }

    public static bool IsStartOfSameType(ControlKind startKind, ControlKind candidateKind)
    {
        return (startKind == ControlKind.LoopStart && candidateKind == ControlKind.LoopStart)
            || (startKind == ControlKind.IfStart && candidateKind == ControlKind.IfStart);
    }

    public static bool IsEndOfSameType(ControlKind startKind, ControlKind candidateKind)
    {
        return (startKind == ControlKind.LoopStart && candidateKind == ControlKind.LoopEnd)
            || (startKind == ControlKind.IfStart && candidateKind == ControlKind.IfEnd);
    }
}

internal sealed class ScanEngine
{
    private static readonly Regex InlineTagRegex = new(@"\{([^{}]+)\}", RegexOptions.Compiled);
    private static readonly Regex SingleTagRegex = new(@"^\{([^{}]+)\}$", RegexOptions.Compiled);

    private readonly string _fileName;
    private readonly string _sha256;
    private readonly JsonNode? _data;

    private readonly List<TagRecord> _tags = [];
    private readonly List<PairingScope> _scopes = [];
    private readonly List<ScanDiagnostic> _diagnostics = [];
    private readonly List<(string Expression, bool Centered, TagLocation Location)> _imageReferences = [];
    private readonly SortedSet<string> _dataPaths = new(StringComparer.Ordinal);
    private readonly SortedSet<string> _functions = new(StringComparer.Ordinal);
    private readonly SortedSet<string> _symbologies = new(StringComparer.Ordinal);
    private readonly List<FormatPattern> _formatPatterns = [];
    private readonly SortedSet<string> _semanticChanges = new(StringComparer.Ordinal);

    public ScanEngine(string fileName, string sha256, JsonNode? data)
    {
        _fileName = fileName;
        _sha256 = sha256;
        _data = data;
    }

    public ScanReport Run(WordprocessingDocument document)
    {
        var body = document.MainDocumentPart?.Document?.Body
            ?? throw new InvalidOperationException("The DOCX template does not contain a valid document body.");

        var bodyScope = NewScope("body");
        WalkCompositeChildren(body, bodyScope, null);

        var headersFooters = ScanHeadersFooters(document.MainDocumentPart!);

        var controlBlocks = AnalyzeControlBlocks();
        var resourceReferences = ResolveResourceReferences();

        var summary = new ScanSummary(
            _tags.Count,
            _tags.Count(static tag => tag.Kind == "inline-expression"),
            _tags.Count(static tag => tag.Kind == "loop-start"),
            _tags.Count(static tag => tag.Kind == "if-start"),
            _tags.Count(static tag => tag.Kind == "image"),
            _tags.Count(static tag => tag.Kind == "barcode"),
            [.. _dataPaths],
            [.. _functions],
            [.. _formatPatterns.Distinct().OrderBy(static p => p.Kind, StringComparer.Ordinal)
                .ThenBy(static p => p.Pattern, StringComparer.Ordinal)
                .ThenBy(static p => p.Alias, StringComparer.Ordinal)],
            [.. _symbologies],
            [.. _tags
                .GroupBy(static tag => tag.Expression, StringComparer.Ordinal)
                .Select(static group => new OccurrenceCount(group.Key, group.Count()))
                .OrderBy(static entry => entry.Expression, StringComparer.Ordinal)]);

        var hasError = _diagnostics.Any(static d => d.Severity == "error");
        var hasWarning = _diagnostics.Any(static d => d.Severity == "warning");
        var risk = hasError ? "high" : hasWarning || _semanticChanges.Count > 0 ? "medium" : "low";
        var migrationStatus = hasError || hasWarning || _semanticChanges.Count > 0 ? "needs-review" : "auto";

        return new ScanReport(
            DocxScan.ReportFormat,
            new ScannerInfo(DocxScan.ScannerName, DocxScan.ScannerVersion),
            new ScannedFile(_fileName, _sha256),
            summary,
            [.. _tags],
            resourceReferences,
            controlBlocks,
            [.. _diagnostics],
            headersFooters,
            [.. _semanticChanges],
            risk,
            migrationStatus);
    }

    private PairingScope NewScope(string display)
    {
        var scope = new PairingScope { Display = display };
        _scopes.Add(scope);
        return scope;
    }

    private void WalkCompositeChildren(
        OpenXmlCompositeElement container,
        PairingScope paragraphScope,
        TagLocation? baseLocation)
    {
        var paragraphIndex = 0;
        var tableIndex = 0;
        foreach (var child in container.ChildElements)
        {
            if (child is Paragraph paragraph)
            {
                var location = baseLocation == null
                    ? new TagLocation("body", paragraphIndex, null, null, null)
                    : baseLocation with { ParagraphIndex = paragraphIndex };
                ProcessTextElement(paragraph, location, paragraphScope);
                paragraphIndex++;
            }
            else if (child is Table table)
            {
                var tableLocation = baseLocation == null
                    ? new TagLocation("table-row", null, tableIndex, null, null)
                    : baseLocation with { Scope = "table-row" };
                ProcessTable(table, tableLocation);
                tableIndex++;
            }
            else if (child is OpenXmlCompositeElement composite)
            {
                // Legacy recurses into every composite (e.g. SdtBlock); keep inventory honest.
                var nestedScope = NewScope(paragraphScope.Display);
                WalkCompositeChildren(composite, nestedScope, baseLocation);
            }
        }
    }

    private void ProcessTable(Table table, TagLocation tableLocation)
    {
        var rowScope = NewScope("table-row");
        var rowIndex = 0;
        foreach (var row in table.Elements<TableRow>())
        {
            var rowLocation = tableLocation with { RowIndex = rowIndex };
            var rowTextNodes = row.Descendants<Text>().ToList();
            var rowText = string.Concat(rowTextNodes.Select(static text => text.Text));
            var rowMatch = SoleControlToken(rowText);
            if (rowMatch != null)
            {
                // Row-level control marker: legacy consumes the whole row as one marker;
                // the constituent cell paragraphs are not scanned separately.
                var rowSpans = TextSpans(rowTextNodes);
                var (runCount, split) = RunStats(rowMatch.Value.Match, rowSpans);
                EmitTag(
                    rowMatch.Value.Token,
                    rowMatch.Value.Match.Value,
                    rowLocation,
                    rowScope,
                    isRowMarker: true,
                    soleContent: true,
                    runCount,
                    split,
                    BuildRunStyleMap(split, rowSpans));
                rowIndex++;
                continue;
            }

            var cellIndex = 0;
            foreach (var cell in row.Elements<TableCell>())
            {
                var cellScope = NewScope("table-cell");
                var cellLocation = new TagLocation(
                    "table-cell",
                    null,
                    tableLocation.TableIndex,
                    rowIndex,
                    cellIndex);
                WalkCellChildren(cell, cellScope, cellLocation);
                cellIndex++;
            }

            rowIndex++;
        }
    }

    private void WalkCellChildren(
        OpenXmlCompositeElement cell,
        PairingScope cellScope,
        TagLocation cellLocation)
    {
        var paragraphIndex = 0;
        foreach (var child in cell.ChildElements)
        {
            if (child is Paragraph paragraph)
            {
                ProcessTextElement(paragraph, cellLocation with { ParagraphIndex = paragraphIndex }, cellScope);
                paragraphIndex++;
            }
            else if (child is Table nestedTable)
            {
                ProcessTable(nestedTable, cellLocation with { Scope = "table-row", ParagraphIndex = null });
            }
            else if (child is OpenXmlCompositeElement composite)
            {
                var nestedScope = NewScope(cellScope.Display);
                WalkCellChildren(composite, nestedScope, cellLocation);
            }
        }
    }

    /// <summary>Returns the trimmed control token when the element's whole text is exactly one control tag.</summary>
    private (Match Match, string Token)? SoleControlToken(string combinedText)
    {
        var trimmed = combinedText.Trim();
        if (trimmed.Length == 0)
        {
            return null;
        }

        var soleMatch = SingleTagRegex.Match(trimmed);
        if (!soleMatch.Success)
        {
            return null;
        }

        var token = soleMatch.Groups[1].Value.Trim();
        var kind = ClassifyControlPrefix(token, out var expression);
        if (kind == null || expression.Length == 0)
        {
            return null;
        }

        var match = InlineTagRegex.Match(combinedText);
        return match.Success ? (match, token) : null;
    }

    private static ControlKind? ClassifyControlPrefix(string token, out string expression)
    {
        expression = string.Empty;
        if (token.StartsWith('#'))
        {
            expression = token.Substring(1).Trim();
            return ControlKind.LoopStart;
        }

        if (token.StartsWith("/?", StringComparison.Ordinal))
        {
            expression = token.Substring(2).Trim();
            return ControlKind.IfEnd;
        }

        if (token.StartsWith('?'))
        {
            expression = token.Substring(1).Trim();
            return ControlKind.IfStart;
        }

        if (token.StartsWith('/'))
        {
            expression = token.Substring(1).Trim();
            return ControlKind.LoopEnd;
        }

        return null;
    }

    private static string ControlKindName(ControlKind kind)
    {
        return kind switch
        {
            ControlKind.LoopStart => "loop-start",
            ControlKind.LoopEnd => "loop-end",
            ControlKind.IfStart => "if-start",
            ControlKind.IfEnd => "if-end",
            _ => "inline-expression",
        };
    }

    private void AddInlineControlTokenDiagnostic(string rawText, TagLocation location)
    {
        AddDiagnostic(
            "INLINE_CONTROL_TOKEN",
            "info",
            $"Control token '{rawText}' is not the element's sole content; legacy erases it inline.",
            location);
    }

    private void ProcessTextElement(
        OpenXmlCompositeElement element,
        TagLocation location,
        PairingScope scope)
    {
        var textNodes = element.Descendants<Text>().ToList();
        if (textNodes.Count == 0)
        {
            return;
        }

        var combined = string.Concat(textNodes.Select(static text => text.Text));
        var matches = InlineTagRegex.Matches(combined);
        if (matches.Count == 0)
        {
            return;
        }

        var spans = TextSpans(textNodes);
        var trimmed = combined.Trim();
        var soleMatch = SingleTagRegex.Match(trimmed);
        if (soleMatch.Success && matches.Count == 1)
        {
            var (runCount, split) = RunStats(matches[0], spans);
            EmitTag(
                soleMatch.Groups[1].Value.Trim(),
                matches[0].Value,
                location,
                scope,
                isRowMarker: false,
                soleContent: true,
                runCount,
                split,
                BuildRunStyleMap(split, spans));
            return;
        }

        foreach (var match in matches.Cast<Match>())
        {
            var (runCount, split) = RunStats(match, spans);
            EmitTag(
                match.Groups[1].Value.Trim(),
                match.Value,
                location,
                scope,
                isRowMarker: false,
                soleContent: false,
                runCount,
                split,
                BuildRunStyleMap(split, spans));
        }
    }

    /// <summary>Offset of one w:t node inside the element's combined text, plus its run's raw rPr XML.</summary>
    private sealed record TextSpan(int Start, int Length, string? RunPropertiesXml);

    private static List<TextSpan> TextSpans(IReadOnlyList<Text> textNodes)
    {
        var spans = new List<TextSpan>(textNodes.Count);
        var offset = 0;
        foreach (var node in textNodes)
        {
            var runPropertiesXml = node.Parent is Run run ? run.RunProperties?.OuterXml : null;
            spans.Add(new TextSpan(offset, node.Text.Length, runPropertiesXml));
            offset += node.Text.Length;
        }

        return spans;
    }

    private static (int RunCount, bool Split) RunStats(Match match, IReadOnlyList<TextSpan> spans)
    {
        var matchStart = match.Index;
        var matchEnd = match.Index + match.Length;
        var count = 0;
        foreach (var span in spans)
        {
            if (span.Start < matchEnd && matchStart < span.Start + span.Length)
            {
                count++;
            }
        }

        return (Math.Max(count, 1), count > 1);
    }

    /// <summary>
    /// Full text-range → style map of the element, recorded only for split tags
    /// (spec: preserve the mapping so the independent styles around a tag split
    /// across Word runs survive migration; legacy flattens to the first run).
    /// </summary>
    private static IReadOnlyList<RunStyleSpan>? BuildRunStyleMap(bool split, IReadOnlyList<TextSpan> spans)
    {
        if (!split)
        {
            return null;
        }

        var map = new List<RunStyleSpan>(spans.Count);
        for (var index = 0; index < spans.Count; index++)
        {
            if (spans[index].Length > 0)
            {
                map.Add(new RunStyleSpan(spans[index].Start, spans[index].Length, index, spans[index].RunPropertiesXml));
            }
        }

        return map;
    }

    private void EmitTag(
        string token,
        string rawText,
        TagLocation location,
        PairingScope scope,
        bool isRowMarker,
        bool soleContent,
        int runCount,
        bool splitAcrossRuns,
        IReadOnlyList<RunStyleSpan>? runSpans)
    {
        string kind;
        string expression;
        PipelineModel? pipeline = null;
        ImageInfo? image = null;
        BarcodeInfo? barcode = null;
        var blockLevel = false;
        var rowLevel = false;
        ControlKind? controlKind = null;

        if (token.StartsWith('%') && token.Length > 1)
        {
            var centered = token.StartsWith("%%", StringComparison.Ordinal);
            var remainder = token.Substring(centered ? 2 : 1).Trim();
            if (remainder.Length == 0)
            {
                // Legacy does not treat this as an image tag; it evaluates as an (empty) expression.
                kind = "inline-expression";
                expression = token;
            }
            else if (remainder.StartsWith("barcode:", StringComparison.OrdinalIgnoreCase))
            {
                kind = "barcode";
                expression = remainder;
                var parsed = BarcodeParser.Parse(remainder);
                barcode = new BarcodeInfo(
                    parsed.ValueExpression,
                    parsed.Symbology,
                    parsed.Parameters,
                    centered);
                _symbologies.Add(parsed.Symbology);
                foreach (var (code, message) in parsed.Warnings)
                {
                    AddDiagnostic(code, "warning", message, location);
                }

                if (parsed.Symbology == "upca")
                {
                    _semanticChanges.Add("upca-to-ean13");
                }
                else if (parsed.Symbology == "itf")
                {
                    _semanticChanges.Add("itf-pad-left-zero");
                }

                pipeline = RegisterPipeline(parsed.ValueExpression, location);
            }
            else
            {
                kind = "image";
                expression = remainder;
                image = new ImageInfo(centered, remainder);
                pipeline = RegisterPipeline(remainder, location);
            }

            if (kind is "image" or "barcode")
            {
                if (soleContent && !isRowMarker)
                {
                    blockLevel = true;
                }
                else if (!soleContent)
                {
                    AddDiagnostic(
                        "INLINE_IMAGE_TOKEN",
                        "info",
                        $"Image/barcode token '{rawText}' is not the element's sole content; legacy leaves it as literal text.",
                        location);
                }

                if (kind == "image")
                {
                    _imageReferences.Add((expression, image!.Centered, location));
                }
            }
        }
        else if ((controlKind = ClassifyControlPrefix(token, out var controlExpression)) != null && controlExpression.Length > 0)
        {
            kind = ControlKindName(controlKind.Value);
            expression = controlExpression;
            pipeline = RegisterPipeline(expression, location);

            if (soleContent)
            {
                blockLevel = true;
                rowLevel = isRowMarker;
                scope.Markers.Add(
                    new MarkerInstance
                    {
                        Kind = controlKind.Value,
                        Expression = expression,
                        RawText = rawText,
                        Location = location,
                        Scope = scope,
                    });
            }
            else
            {
                AddInlineControlTokenDiagnostic(rawText, location);
            }
        }
        else if (controlKind != null)
        {
            // Empty expression after a control prefix: not a marker; legacy erases the token inline.
            kind = ControlKindName(controlKind.Value);
            expression = controlExpression;
            AddInlineControlTokenDiagnostic(rawText, location);
        }
        else
        {
            kind = "inline-expression";
            expression = token;
            pipeline = RegisterPipeline(expression, location);
        }

        if (splitAcrossRuns)
        {
            AddDiagnostic(
                "SPLIT_RUN_TAG",
                "info",
                $"Tag '{rawText}' is split across {runCount} runs; import must map style ranges instead of legacy first-run flattening.",
                location);
        }

        _tags.Add(
            new TagRecord(
                location,
                rawText,
                expression,
                kind,
                blockLevel,
                rowLevel,
                splitAcrossRuns,
                runCount,
                pipeline,
                image,
                barcode,
                runSpans));
    }

    private PipelineModel? RegisterPipeline(string expression, TagLocation location)
    {
        var pipeline = ExpressionGrammar.ParsePipeline(expression);
        if (pipeline == null)
        {
            return null;
        }

        _dataPaths.Add(pipeline.Path);
        if (ExpressionGrammar.PathContainsNegativeIndex(pipeline.Path))
        {
            _semanticChanges.Add("path-negative-index");
        }

        foreach (var operation in pipeline.Operations)
        {
            _functions.Add(operation.Name);
            if (!ExpressionGrammar.KnownOperators.Contains(operation.Name))
            {
                AddDiagnostic(
                    "UNKNOWN_OPERATOR",
                    "warning",
                    $"Expression '{expression}' uses unsupported operation '{operation.Name}'; legacy throws at render time.",
                    location);
                continue;
            }

            if (ExpressionGrammar.TryParseNegativeAtArgument(operation, out _))
            {
                _semanticChanges.Add("at-negative-index");
            }

            if (operation.Name == "format")
            {
                RegisterFormatPattern(operation, location);
            }
        }

        return pipeline;
    }

    private void RegisterFormatPattern(PipelineOperation operation, TagLocation location)
    {
        var rawKind = operation.Args.Count > 0 ? operation.Args[0].Trim().ToLowerInvariant() : string.Empty;
        if (rawKind.Length == 0)
        {
            AddDiagnostic(
                "UNSUPPORTED_FORMAT_KIND",
                "warning",
                "format operation requires a format kind (number/percent/permille/date); legacy throws at render time.",
                location);
            return;
        }

        var canonical = ExpressionGrammar.CanonicalFormatKind(rawKind);
        if (!ExpressionGrammar.KnownFormatKinds.Contains(canonical))
        {
            AddDiagnostic(
                "UNSUPPORTED_FORMAT_KIND",
                "warning",
                $"Unsupported format kind '{rawKind}'. Supported: number, percent, permille, date.",
                location);
        }

        string? pattern = operation.Args.Count >= 2
            ? string.Join(':', operation.Args.Skip(1)).Trim()
            : null;
        if (string.IsNullOrEmpty(pattern))
        {
            pattern = null;
        }

        var alias = canonical != rawKind ? rawKind : null;
        if (alias != null)
        {
            _semanticChanges.Add("format-alias");
        }

        _formatPatterns.Add(new FormatPattern(canonical, pattern, alias));
    }

    private List<ControlBlock> AnalyzeControlBlocks()
    {
        var blocks = new List<ControlBlock>();
        var unpairedStarts = new List<MarkerInstance>();
        var unmatchedEnds = new List<MarkerInstance>();

        foreach (var scope in _scopes)
        {
            var sequence = 0;
            foreach (var marker in scope.Markers)
            {
                marker.Sequence = sequence++;
            }

            var consumedEnds = new HashSet<MarkerInstance>();
            foreach (var start in scope.Markers.Where(static marker => marker.IsStart))
            {
                var depth = 0;
                MarkerInstance? matched = null;
                foreach (var candidate in scope.Markers.Where(marker => marker.Sequence > start.Sequence))
                {
                    if (MarkerInstance.IsStartOfSameType(start.Kind, candidate.Kind))
                    {
                        depth++;
                        continue;
                    }

                    if (!MarkerInstance.IsEndOfSameType(start.Kind, candidate.Kind))
                    {
                        continue;
                    }

                    if (depth > 0)
                    {
                        depth--;
                        continue;
                    }

                    matched = candidate;
                    break;
                }

                if (matched == null)
                {
                    unpairedStarts.Add(start);
                    AddDiagnostic(
                        "UNPAIRED_BLOCK_START",
                        "error",
                        $"No closing tag found for '{start.RawText}' in scope '{start.Scope.Display}'.",
                        start.Location);
                    continue;
                }

                start.Paired = true;
                start.MatchedEnd = matched;
                consumedEnds.Add(matched);
                if (!string.Equals(matched.Expression, start.Expression, StringComparison.Ordinal))
                {
                    AddDiagnostic(
                        "MISMATCHED_BLOCK_END",
                        "error",
                        $"Closing tag '{matched.RawText}' does not match opening tag '{start.RawText}'.",
                        matched.Location);
                }
            }

            foreach (var end in scope.Markers.Where(marker => marker.IsEnd && !consumedEnds.Contains(marker)))
            {
                unmatchedEnds.Add(end);
            }
        }

        foreach (var end in unmatchedEnds)
        {
            var crossStart = unpairedStarts.FirstOrDefault(start =>
                !ReferenceEquals(start.Scope, end.Scope)
                && MarkerInstance.IsEndOfSameType(start.Kind, end.Kind)
                && string.Equals(start.Expression, end.Expression, StringComparison.Ordinal));
            if (crossStart != null)
            {
                AddDiagnostic(
                    "CROSS_CONTAINER_PAIRING",
                    "error",
                    $"End marker '{end.RawText}' in scope '{end.Scope.Display}' matches opening tag in scope '{crossStart.Scope.Display}'; legacy pairs only within one container.",
                    end.Location);
            }
            else
            {
                AddDiagnostic(
                    "ORPHANED_BLOCK_END",
                    "warning",
                    $"End marker '{end.RawText}' has no opening tag in scope '{end.Scope.Display}'; legacy silently drops it.",
                    end.Location);
                _semanticChanges.Add("orphaned-block-end");
            }
        }

        // Spec: a truthy non-array value under a loop marker executes the block exactly
        // once under legacy truthiness and must be flagged LEGACY_SEMANTIC_CHANGE.
        foreach (var marker in _scopes.SelectMany(static scope => scope.Markers))
        {
            if (marker.Kind == ControlKind.LoopStart && marker.Paired)
            {
                ClassifyLoopValue(marker);
            }
        }

        foreach (var scope in _scopes)
        {
            var paired = scope.Markers.Where(static marker => marker.IsStart && marker.Paired).ToList();
            foreach (var inner in paired)
            {
                foreach (var outer in paired)
                {
                    if (ReferenceEquals(inner, outer))
                    {
                        continue;
                    }

                    var strictlyInside = outer.Sequence < inner.Sequence
                        && inner.MatchedEnd!.Sequence < outer.MatchedEnd!.Sequence;
                    if (strictlyInside)
                    {
                        inner.Depth++;
                    }
                }
            }

            // Interleaving: cross-type paired intervals that cross without nesting.
            for (var left = 0; left < paired.Count; left++)
            {
                for (var right = left + 1; right < paired.Count; right++)
                {
                    var a = paired[left];
                    var b = paired[right];
                    var sameType = MarkerInstance.IsStartOfSameType(a.Kind, b.Kind);
                    if (sameType)
                    {
                        continue;
                    }

                    var crosses = (a.Sequence < b.Sequence
                            && b.Sequence < a.MatchedEnd!.Sequence
                            && a.MatchedEnd.Sequence < b.MatchedEnd!.Sequence)
                        || (b.Sequence < a.Sequence
                            && a.Sequence < b.MatchedEnd!.Sequence
                            && b.MatchedEnd.Sequence < a.MatchedEnd!.Sequence);
                    if (crosses)
                    {
                        AddDiagnostic(
                            "INTERLEAVED_BLOCKS",
                            "error",
                            $"Cross-type blocks '{a.RawText}' and '{b.RawText}' interleave without nesting; legacy misparses this structure.",
                            b.Location);
                    }
                }
            }

            foreach (var marker in scope.Markers.Where(static marker => marker.IsStart))
            {
                if (marker.Paired && marker.Depth > 0)
                {
                    AddDiagnostic(
                        "NESTED_BLOCK",
                        "info",
                        $"Block '{marker.RawText}' is nested at depth {marker.Depth} inside enclosing block(s).",
                        marker.Location);
                }

                blocks.Add(
                    new ControlBlock(
                        marker.Kind == ControlKind.LoopStart ? "loop" : "if",
                        marker.Expression,
                        marker.Paired,
                        marker.Depth,
                        marker.Scope.Display));
            }
        }

        return blocks;
    }

    private List<ResourceReference> ResolveResourceReferences()
    {
        var references = new List<ResourceReference>();
        foreach (var (expression, centered, _) in _imageReferences)
        {
            references.Add(new ResourceReference(expression, "image", centered, ResolveValue(expression)));
        }

        return references;
    }

    /// <summary>
    /// Sidecar lookup (not evaluation) for a paired loop marker: when the loop value
    /// is a truthy non-array, legacy renders the block exactly once, which the
    /// migration spec requires to be reported as a LEGACY_SEMANTIC_CHANGE.
    /// Arrays iterate normally and falsy values render nothing — no divergence.
    /// </summary>
    private void ClassifyLoopValue(MarkerInstance marker)
    {
        if (_data == null || !ExpressionGrammar.IsPlainPath(marker.Expression))
        {
            return;
        }

        if (!ExpressionGrammar.TryLookupPath(_data, marker.Expression, out var node))
        {
            return;
        }

        if (node is null or JsonArray || !IsLegacyTruthy(node))
        {
            return;
        }

        _semanticChanges.Add("non-array-loop");
        AddDiagnostic(
            "NON_ARRAY_LOOP",
            "warning",
            $"Loop '{marker.RawText}' iterates a truthy non-array value; legacy renders the block exactly once instead of requiring an array.",
            marker.Location);
    }

    /// <summary>Legacy truthiness: blank/0/false/empty array/empty object are falsy; "false" and "0" are truthy.</summary>
    internal static bool IsLegacyTruthy(JsonNode node)
    {
        return node switch
        {
            JsonArray array => array.Count > 0,
            JsonObject obj => obj.Count > 0,
            JsonValue value => value.GetValueKind() switch
            {
                JsonValueKind.False or JsonValueKind.Null => false,
                JsonValueKind.True => true,
                JsonValueKind.String => value.GetValue<string>().Trim().Length > 0,
                JsonValueKind.Number => value.GetValue<double>() != 0,
                _ => false,
            },
            _ => false,
        };
    }

    private ResourceValue ResolveValue(string expression)
    {
        if (_data == null || !ExpressionGrammar.IsPlainPath(expression))
        {
            return new ResourceValue("valueUnknown", null, null, null, null, null);
        }

        if (!ExpressionGrammar.TryLookupPath(_data, expression, out var node))
        {
            return new ResourceValue("missing", "missing", null, null, null, null);
        }

        switch (node)
        {
            case null:
                return new ResourceValue("null", "null", null, null, null, null);
            case JsonArray array:
                return new ResourceValue("resolved", "array", null, null, null, array.Count);
            case JsonObject obj:
                return ResolveObjectValue(obj);
            case JsonValue:
                return node.GetValueKind() == JsonValueKind.String
                    ? ResolveStringValue(node.GetValue<string>())
                    : new ResourceValue(
                        "resolved",
                        node.GetValueKind() is JsonValueKind.True or JsonValueKind.False ? "boolean" : "number",
                        null,
                        null,
                        null,
                        null);
            default:
                return new ResourceValue("valueUnknown", null, null, null, null, null);
        }
    }

    private static readonly string[] SourceKeyPriority = ["src", "data", "base64", "path", "value"];

    private static readonly string[] SizeKeyOrder =
    [
        "width",
        "widthPx",
        "height",
        "heightPx",
        "maxWidth",
        "maxWidthPx",
        "maxHeight",
        "maxHeightPx",
        "scale",
        "scaleRatio",
        "preserveAspectRatio",
        "keepAspectRatio",
        "lockAspectRatio",
    ];

    private ResourceValue ResolveObjectValue(JsonObject obj)
    {
        string? sourceKey = null;
        string? sourceText = null;
        foreach (var candidate in SourceKeyPriority)
        {
            var actual = FindKey(obj, candidate);
            if (actual != null)
            {
                sourceKey = actual;
                if (obj[actual] is JsonValue sourceValue && sourceValue.GetValueKind() == JsonValueKind.String)
                {
                    sourceText = sourceValue.GetValue<string>();
                }

                break;
            }
        }

        var sizeKeys = new List<string>();
        foreach (var candidate in SizeKeyOrder)
        {
            var actual = FindKey(obj, candidate);
            if (actual != null)
            {
                sizeKeys.Add(actual);
            }
        }

        var sourceForm = sourceText == null ? null : ClassifySourceForm(sourceText);
        if (sourceForm is "absolute-path" or "relative-path")
        {
            _semanticChanges.Add("file-path-image-source");
        }

        return new ResourceValue("resolved", "object", sourceKey, sizeKeys, sourceForm, null);
    }

    private ResourceValue ResolveStringValue(string value)
    {
        var sourceForm = ClassifySourceForm(value);
        if (sourceForm is "absolute-path" or "relative-path")
        {
            _semanticChanges.Add("file-path-image-source");
        }

        return new ResourceValue("resolved", "string", null, null, sourceForm, null);
    }

    private static string? FindKey(JsonObject obj, string name)
    {
        foreach (var property in obj)
        {
            if (string.Equals(property.Key, name, StringComparison.OrdinalIgnoreCase))
            {
                return property.Key;
            }
        }

        return null;
    }

    /// <summary>
    /// FORM classification only — never opens or reads the referenced path.
    /// </summary>
    internal static string ClassifySourceForm(string source)
    {
        if (source.StartsWith("data:", StringComparison.OrdinalIgnoreCase))
        {
            var end = source.IndexOfAny([',', ';']);
            var mime = (end < 0 ? source.Substring(5) : source.Substring(5, end - 5)).Trim().ToLowerInvariant();
            return $"data-uri:{mime}";
        }

        if (source.StartsWith('/') || source.StartsWith("\\\\", StringComparison.Ordinal)
            || (source.Length >= 3 && char.IsAsciiLetter(source[0]) && source[1] == ':' && (source[2] == '/' || source[2] == '\\')))
        {
            return "absolute-path";
        }

        if (source.Contains('\\') || HasImageExtension(source) || (source.Contains('/') && !LooksLikeBase64(source)))
        {
            return "relative-path";
        }

        return "base64-like";
    }

    private static bool HasImageExtension(string source)
    {
        return source.EndsWith(".png", StringComparison.OrdinalIgnoreCase)
            || source.EndsWith(".jpg", StringComparison.OrdinalIgnoreCase)
            || source.EndsWith(".jpeg", StringComparison.OrdinalIgnoreCase)
            || source.EndsWith(".gif", StringComparison.OrdinalIgnoreCase)
            || source.EndsWith(".bmp", StringComparison.OrdinalIgnoreCase)
            || source.EndsWith(".tif", StringComparison.OrdinalIgnoreCase)
            || source.EndsWith(".tiff", StringComparison.OrdinalIgnoreCase);
    }

    private static bool LooksLikeBase64(string value)
    {
        if (value.Length == 0 || value.Length % 4 != 0)
        {
            return false;
        }

        foreach (var character in value)
        {
            var isBase64Char = char.IsAsciiLetterOrDigit(character) || character is '+' or '/' or '=';
            if (!isBase64Char)
            {
                return false;
            }
        }

        return true;
    }

    private HeadersFooters ScanHeadersFooters(MainDocumentPart mainPart)
    {
        var parts = new List<HeaderFooterPart>();
        var containers = mainPart.HeaderParts
            .Select(static part => (Part: (OpenXmlPart)part, Kind: "header", Root: (OpenXmlPartRootElement?)part.Header))
            .Concat(
                mainPart.FooterParts.Select(static part =>
                    (Part: (OpenXmlPart)part, Kind: "footer", Root: (OpenXmlPartRootElement?)part.Footer)))
            .OrderBy(static entry => entry.Part.Uri.ToString().TrimStart('/'), StringComparer.Ordinal);

        foreach (var (part, kind, root) in containers)
        {
            var tags = new List<string>();
            if (root != null)
            {
                foreach (var paragraph in root.Descendants<Paragraph>())
                {
                    var text = string.Concat(paragraph.Descendants<Text>().Select(static node => node.Text));
                    foreach (var match in InlineTagRegex.Matches(text).Cast<Match>())
                    {
                        tags.Add(match.Value);
                    }
                }
            }

            parts.Add(
                new HeaderFooterPart(
                    part.Uri.ToString().TrimStart('/'),
                    kind,
                    tags.Count,
                    tags,
                    DocxScan.HeaderFooterNote));
        }

        return new HeadersFooters(parts);
    }

    private void AddDiagnostic(string code, string severity, string message, TagLocation? location)
    {
        _diagnostics.Add(new ScanDiagnostic(code, severity, message, location));
    }
}
