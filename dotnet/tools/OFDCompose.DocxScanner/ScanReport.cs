using System.Text.Json.Serialization;

namespace OFDCompose.DocxScanner;

public sealed record ScannerInfo(string Name, string Version);

public sealed record ScannedFile(string Name, string Sha256);

public sealed record FormatPattern(string Kind, string? Pattern, string? Alias);

public sealed record ScanSummary(
    int TagCount,
    int InlineExpressions,
    int Loops,
    int Conditionals,
    int Images,
    int Barcodes,
    IReadOnlyList<string> DataPaths,
    IReadOnlyList<string> Functions,
    IReadOnlyList<FormatPattern> FormatPatterns,
    IReadOnlyList<string> Symbologies);

public sealed record TagLocation(
    string Scope,
    int? ParagraphIndex,
    int? TableIndex,
    int? RowIndex,
    int? CellIndex);

public sealed record PipelineOperation(string Name, IReadOnlyList<string> Args);

public sealed record PipelineModel(string Path, IReadOnlyList<PipelineOperation> Operations);

public sealed record ImageInfo(bool Centered, string ValueExpression);

public sealed record BarcodeParameters(int Width, int Height, int Margin, bool Pure);

public sealed record BarcodeInfo(
    string ValueExpression,
    string Symbology,
    BarcodeParameters Parameters,
    bool Centered);

public sealed record TagRecord(
    TagLocation Location,
    string RawText,
    string Expression,
    string Kind,
    bool BlockLevel,
    bool RowLevel,
    bool SplitAcrossRuns,
    int RunCount,
    PipelineModel? Pipeline,
    ImageInfo? Image,
    BarcodeInfo? Barcode);

public sealed record ResourceValue(
    string State,
    string? ValueKind,
    string? SourceKey,
    IReadOnlyList<string>? SizeKeys,
    string? SourceForm,
    int? ItemCount);

public sealed record ResourceReference(string Expression, string Kind, bool Centered, ResourceValue Value);

public sealed record ControlBlock(string Kind, string Expression, bool Paired, int Depth, string Scope);

public sealed record ScanDiagnostic(string Code, string Severity, string Message, TagLocation? Location);

public sealed record HeaderFooterPart(
    string Name,
    string PartKind,
    int TagCount,
    IReadOnlyList<string> Tags,
    string Note);

public sealed record HeadersFooters(IReadOnlyList<HeaderFooterPart> Parts);

public sealed record ScanReport(
    string Format,
    ScannerInfo Scanner,
    ScannedFile File,
    ScanSummary Summary,
    IReadOnlyList<TagRecord> Tags,
    IReadOnlyList<ResourceReference> ResourceReferences,
    IReadOnlyList<ControlBlock> ControlBlocks,
    IReadOnlyList<ScanDiagnostic> Diagnostics,
    HeadersFooters HeadersFooters,
    IReadOnlyList<string> LegacySemanticChanges,
    string Risk,
    string MigrationStatus);

public sealed record MigrationReportEntry(
    string File,
    string Report,
    string MigrationStatus,
    string Risk,
    int TagCount,
    IReadOnlyList<string> LegacySemanticChanges);

public sealed record MigrationTotals(
    int Templates,
    int Auto,
    int NeedsReview,
    int Unsupported,
    int Tags,
    int Diagnostics,
    int LegacySemanticChanges);

public sealed record MigrationReport(
    string Format,
    string Note,
    string LegacyCommit,
    IReadOnlyList<MigrationReportEntry> Templates,
    MigrationTotals Totals);

[JsonSourceGenerationOptions(PropertyNamingPolicy = JsonKnownNamingPolicy.CamelCase)]
[JsonSerializable(typeof(ScanReport))]
[JsonSerializable(typeof(MigrationReport))]
public sealed partial class ScanReportJsonContext : JsonSerializerContext;
