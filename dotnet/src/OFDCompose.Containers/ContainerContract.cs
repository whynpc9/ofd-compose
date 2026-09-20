namespace OFDCompose.Containers;

/// <summary>Explicit trusted host service backed by the pinned media-core encoder. No implementation is selected by attachment data.</summary>
public sealed record BarcodeGeometryRequest(string GeneratorVersion,string Value,ReadOnlyMemory<byte> OptionsJson);
/// <summary>Returns UTF-8 JSON for the generated local millimetre command array, or empty memory to deny verification.</summary>
public delegate ReadOnlyMemory<byte> BarcodeGeometryResolver(BarcodeGeometryRequest request,CancellationToken cancellationToken);
/// <summary>Owned minimal paragraph numbering descriptors; no paragraph text or business Data.</summary>
public sealed record NumberingLabelsRequest(string AlgorithmVersion,ReadOnlyMemory<byte> ParagraphsJson);
/// <summary>Trusted host executes Layout Core numbering rules and returns a JSON string array in request order.</summary>
public delegate ReadOnlyMemory<byte> NumberingLabelsResolver(NumberingLabelsRequest request,CancellationToken cancellationToken);
public enum ContainerProfile { NativeEditable, Distribution }
public sealed record SourceAsset(string Sha256, ReadOnlyMemory<byte> Bytes);
public sealed record ContainerResult(byte[]? Bytes, string? Error)
{
    public bool Ok => Bytes is not null;
}
public sealed record ExtractionResult(string? Error, string? Profile = null, byte[]? SourceJson = null,
    IReadOnlyList<SourceAsset>? Assets = null, string? Integrity = null, string? Signature = null)
{
    public bool Ok => Error is null;
}
public sealed record ContainerLimits
{
    public int PackageBytes { get; init; } = 256 * 1024 * 1024;
    public int ExpandedBytes { get; init; } = 256 * 1024 * 1024;
    public int EntryBytes { get; init; } = 32 * 1024 * 1024;
    public int Entries { get; init; } = 4096;
    public int JsonBytes { get; init; } = 32 * 1024 * 1024;
    public int JsonTokens { get; init; } = 2_000_000;
    public int StringBytes { get; init; } = 16 * 1024 * 1024;
    public long WorkBytes { get; init; } = 2L * 1024 * 1024 * 1024;
}
internal sealed class ContainerFailure(string code) : Exception(code);
internal sealed class ContainerBudget(ContainerLimits limits, CancellationToken token)
{
    private long work;
    internal CancellationToken Token => token;
    internal readonly ContainerLimits Limits = Validate(limits);
    private static ContainerLimits Validate(ContainerLimits limits)
    {
        var ceiling = new ContainerLimits();
        foreach (var property in typeof(ContainerLimits).GetProperties())
        {
            long value = Convert.ToInt64(property.GetValue(limits));
            Need(value > 0 && value <= Convert.ToInt64(property.GetValue(ceiling)), "SIZE_LIMIT");
        }
        return limits;
    }
    internal void Charge(long count)
    {
        token.ThrowIfCancellationRequested();
        Need(count >= 0 && count <= Limits.WorkBytes - work, "SIZE_LIMIT");
        work += count;
    }
    internal static void Need([System.Diagnostics.CodeAnalysis.DoesNotReturnIf(false)] bool valid, string code) { if (!valid) throw new ContainerFailure(code); }
}
