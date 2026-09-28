using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text.Json;
using OFDCompose.OfdIrWriter;
using OFDCompose.PdfIrWriter;

// Test-only NDJSON harness: inputs are generated in the trusted matrix spool.
// One process accepts many jobs so hot samples retain normal CLR/JIT state.
string? line;
while ((line = Console.ReadLine()) is not null)
{
    var started = Stopwatch.GetTimestamp();
    var directory = JsonSerializer.Deserialize<string>(line)!;
    var ir = await File.ReadAllBytesAsync(Path.Combine(directory, "ir.json"));
    using var manifest = JsonDocument.Parse(await File.ReadAllTextAsync(Path.Combine(directory, "manifest.json")));
    var resources = new List<OFDCompose.OfdIrWriter.WriterResource>();
    foreach (var item in manifest.RootElement.GetProperty("resources").EnumerateArray())
    {
        var bytes = await File.ReadAllBytesAsync(Path.Combine(directory, item.GetProperty("file").GetString()!));
        if (Digest(bytes) != item.GetProperty("sha256").GetString()) throw new InvalidDataException("Resource digest mismatch");
        resources.Add(new(item.GetProperty("resourceId").GetString()!, bytes));
    }
    var digest = Digest(ir);
    if (digest != manifest.RootElement.GetProperty("identity").GetProperty("irDigest").GetString())
        throw new InvalidDataException("IR digest mismatch");
    var loadMs = Stopwatch.GetElapsedTime(started).TotalMilliseconds;
    started = Stopwatch.GetTimestamp();
    var ofd = await new OfdIrWriter().WriteAsync(ir, digest, resources);
    var ofdMs = Stopwatch.GetElapsedTime(started).TotalMilliseconds;
    var pdfResources = resources.Select(r => new OFDCompose.PdfIrWriter.WriterResource(r.ResourceId, r.Bytes)).ToArray();
    started = Stopwatch.GetTimestamp();
    var pdf = await new PdfIrWriter().WriteAsync(ir, digest, pdfResources);
    var pdfMs = Stopwatch.GetElapsedTime(started).TotalMilliseconds;
    if (!ofd.Ok || !pdf.Ok) throw new InvalidDataException(JsonSerializer.Serialize(new { ofd.Diagnostics, pdfDiagnostics = pdf.Diagnostics }));
    await File.WriteAllBytesAsync(Path.Combine(directory, "output.ofd"), ofd.Bytes!);
    await File.WriteAllBytesAsync(Path.Combine(directory, "output.pdf"), pdf.Bytes!);
    using var process = Process.GetCurrentProcess();
    Console.WriteLine(JsonSerializer.Serialize(new {
        runtime = RuntimeInformation.FrameworkDescription, architecture = RuntimeInformation.ProcessArchitecture.ToString(),
        loadMs, ofdMs, pdfMs, peakWorkingSetBytes = process.PeakWorkingSet64,
        ofdSha256 = Digest(ofd.Bytes!), pdfSha256 = Digest(pdf.Bytes!),
        ofdBytes = ofd.Bytes!.Length, pdfBytes = pdf.Bytes!.Length
    }));
}
static string Digest(byte[] bytes) => Convert.ToHexStringLower(SHA256.HashData(bytes));
