namespace OFDCompose.Containers;

/// <summary>Explicit trusted host service backed by the pinned media-core encoder. No implementation is selected by attachment data.</summary>
public sealed record BarcodeGeometryRequest(string GeneratorVersion,string Value,ReadOnlyMemory<byte> OptionsJson);
/// <summary>Returns UTF-8 JSON for the generated local millimetre command array, or empty memory to deny verification.</summary>
public delegate ReadOnlyMemory<byte> BarcodeGeometryResolver(BarcodeGeometryRequest request,CancellationToken cancellationToken);
/// <summary>Owned minimal paragraph numbering descriptors; no paragraph text or business Data.</summary>
public sealed record NumberingLabelsRequest(string AlgorithmVersion,ReadOnlyMemory<byte> ParagraphsJson);
/// <summary>Trusted host executes Layout Core numbering rules and returns a JSON string array in request order.</summary>
public delegate ReadOnlyMemory<byte> NumberingLabelsResolver(NumberingLabelsRequest request,CancellationToken cancellationToken);
/// <summary>Owned filled source and source-image bytes for an explicitly trusted real Worker/fixed-writer verification host.</summary>
public sealed record SourceRenderRequest(string AlgorithmVersion,ReadOnlyMemory<byte> SourceJson,IReadOnlyList<SourceAsset> Assets);
public sealed record GeneratedPathPayload(string ObjectId,int PageIndex,int ObjectIndex,ReadOnlyMemory<byte> Xml);
/// <summary>Table relationships recomputed by the authoritative renderer.</summary>
public sealed record RenderedTableRelation(string ObjectId,ReadOnlyMemory<byte> TableJson,ReadOnlyMemory<byte> RepeatedHeaderJson);
public sealed record RenderedPageBand(int PageIndex,string Pointer,string Text);
/// <summary>Complete fixed-writer page with dimensions, ordered objects, geometry, text, paint and clips.</summary>
public sealed record RenderedPagePayload(int PageIndex,ReadOnlyMemory<byte> Xml);
public sealed record SourceRenderEvidence(IReadOnlyList<GeneratedPathPayload> Paths,IReadOnlyList<RenderedTableRelation> Tables,IReadOnlyList<RenderedPageBand> Bands,IReadOnlyList<RenderedPagePayload> Pages,IReadOnlyDictionary<string,string> ResourceDigests,ReadOnlyMemory<byte> LayoutResourcesJson,string ReplayIrDigest);
/// <summary>One explicit trusted replay of the pinned renderer with authorized resources per native operation; null denies verification.</summary>
public delegate SourceRenderEvidence? SourceRenderResolver(SourceRenderRequest request,CancellationToken cancellationToken);
public enum ContainerProfile { NativeEditable, Distribution }
/// <summary>Identity of the actual controlled replay of owned minimal source/profile/authorized resources; distinct from the original artifact IR identity.</summary>
public sealed record SourceReplayIdentity(string Version,string IrDigest);
public sealed record SourceAsset(string Sha256, ReadOnlyMemory<byte> Bytes);
public sealed record ContainerResult(byte[]? Bytes, string? Error)
{
    public bool Ok => Bytes is not null;
}
public sealed record ExtractionResult(string? Error, string? Profile = null, byte[]? SourceJson = null,
    IReadOnlyList<SourceAsset>? Assets = null, string? Integrity = null, string? Signature = null, SourceReplayIdentity? ReplayIdentity = null)
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
