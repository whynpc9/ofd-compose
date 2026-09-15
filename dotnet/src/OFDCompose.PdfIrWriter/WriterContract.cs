using OFDCompose.FixedWriting;
using System.Text.Json;

namespace OFDCompose.PdfIrWriter;

/// <summary>Owned subset or image bytes supplied by Render Worker, keyed by canonical resource ID.</summary>
public sealed record WriterResource(string ResourceId, ReadOnlyMemory<byte> Bytes);
public sealed record WriterDiagnostic(string Code, string Path, string Message);
public sealed record PdfWriteResult(byte[]? Bytes, IReadOnlyDictionary<string, string[]>? ObjectMap,
    IReadOnlyList<WriterDiagnostic> Diagnostics)
{
    public bool Ok => Bytes is not null;
    public string? Sha256 => Bytes is null ? null : IrValidation.Digest(Bytes);
}

/// <summary>Budgets are checked before parse, resource copy and object expansion.</summary>
public sealed record WriterLimits
{
    public int JsonBytes { get; init; } = 32 * 1024 * 1024;
    public int JsonTokens { get; init; } = 2_000_000;
    public int StringBytes { get; init; } = 8 * 1024 * 1024;
    public int Pages { get; init; } = 1000;
    public int Objects { get; init; } = 200_000;
    public int Glyphs { get; init; } = 1_000_000;
    public int Commands { get; init; } = 1_000_000;
    public int Resources { get; init; } = 128;
    public long ResourceBytes { get; init; } = 160L * 1024 * 1024;
    public int ResourceEntryBytes { get; init; } = 32 * 1024 * 1024;
    public int OutputBytes { get; init; } = 256 * 1024 * 1024;
    internal void Validate()
    {
        foreach(var pair in new (long Value,long Ceiling)[] {
            (JsonBytes,32*1024*1024),(JsonTokens,2_000_000),(StringBytes,8*1024*1024),
            (Pages,1000),(Objects,200_000),(Glyphs,1_000_000),(Commands,1_000_000),
            (Resources,128),(ResourceBytes,160L*1024*1024),(ResourceEntryBytes,32*1024*1024),
            (OutputBytes,256*1024*1024) })
            J.Require(pair.Value>=0 && pair.Value<=pair.Ceiling,"RESOURCE_LIMIT","limits","Limits may only lower the supported ceilings");
    }
}
internal sealed class WriterFailure(string code, string path, string message) : Exception(message)
{
    internal WriterDiagnostic Diagnostic { get; } = new(code, path, message);
}
internal static class J
{
    internal static string S(this JsonElement j, string p) => j.GetProperty(p).GetString()!;
    internal static double N(this JsonElement j, string p) => j.GetProperty(p).GetDouble();
    internal static int I(this JsonElement j, string p) => j.GetProperty(p).GetInt32();
    internal static JsonElement P(this JsonElement j, string p) => j.GetProperty(p);
    internal static JsonElement.ArrayEnumerator A(this JsonElement j, string p) => j.GetProperty(p).EnumerateArray();
    internal static bool Has(this JsonElement j, string p) => j.TryGetProperty(p, out _);
    internal static void Require(bool condition, string code, string path, string message)
    {
        if (!condition) throw new WriterFailure(code, path, message);
    }
}
