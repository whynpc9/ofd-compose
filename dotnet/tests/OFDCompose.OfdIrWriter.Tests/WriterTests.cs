using System.Globalization;
using System.IO.Compression;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Xml.Linq;
using OFDCompose.OfdIrWriter;
using Ofdrw.Net.Core.Models;
using Ofdrw.Net.Reader.Readers;
using Ofdrw.Net.Reader.Extraction;
using Xunit;

namespace OFDCompose.OfdIrWriter.Tests;
public sealed class WriterTests
{
    private static string Root
    {
        get
        {
            var dir = new DirectoryInfo(AppContext.BaseDirectory);
            while (dir is not null && !File.Exists(Path.Combine(dir.FullName, "pnpm-workspace.yaml"))) dir = dir.Parent;
            return dir!.FullName;
        }
    }
    private static string Digest(byte[] bytes) => Convert.ToHexStringLower(SHA256.HashData(bytes));
    private static async Task<(byte[] Ir, List<WriterResource> Resources)> Fixture(string name)
    {
        string path = Path.Combine(Root, "tests/ofd-writer/fixtures", name);
        var ir = await File.ReadAllBytesAsync(Path.Combine(path, "ir.json"));
        using var manifest = JsonDocument.Parse(await File.ReadAllTextAsync(Path.Combine(path, "manifest.json")));
        var resources = new List<WriterResource>();
        foreach (var resource in manifest.RootElement.GetProperty("resources").EnumerateArray())
            resources.Add(new(resource.GetProperty("resourceId").GetString()!, await File.ReadAllBytesAsync(Path.Combine(path, resource.GetProperty("file").GetString()!))));
        return (ir, resources);
    }
    [Theory]
    [InlineData("combined")]
    [InlineData("cff")]
    [InlineData("truetype")]
    [InlineData("glyphless")]
    [InlineData("geometry")]
    [InlineData("jpeg")]
    [InlineData("logical-display")]
    [InlineData("glyphless-logical")]
    public async Task Real_worker_output_roundtrips_through_net_reader(string name)
    {
        var fixture = await Fixture(name);
        var result = await new OfdIrWriter().WriteAsync(fixture.Ir, Digest(fixture.Ir), fixture.Resources, cancellationToken: TestContext.Current.CancellationToken);
        Assert.True(result.Ok, JsonSerializer.Serialize(result.Diagnostics));
        using var ir = JsonDocument.Parse(fixture.Ir);
        using var stream = new MemoryStream(result.Bytes!);
        var document = await new OfdReader().ReadAsync(stream, TestContext.Current.CancellationToken);
        var expectedPages = ir.RootElement.GetProperty("pages").EnumerateArray().ToArray();
        Assert.Equal(expectedPages.Length, document.Pages.Count);
        var expectedText = new List<string>();
        for (int p = 0; p < expectedPages.Length; p++)
        {
            var objects = expectedPages[p].GetProperty("objects").EnumerateArray().ToArray();
            Assert.Equal(objects.Length, document.Pages[p].Elements.Count);
            expectedText.Add(string.Concat(objects.Where(o => o.GetProperty("kind").GetString() == "text").Select(o => o.GetProperty("logicalText").GetString())));
            for (int i = 0; i < objects.Length; i++)
            {
                var obj = objects[i]; var read = document.Pages[p].Elements[i];
                Assert.Equal(result.ObjectMap![obj.GetProperty("id").GetString()!][0], read.ObjectId);
                if (read is OfdTextElement text)
                {
                    Assert.Equal(obj.GetProperty("logicalText").GetString(), text.Text);
                    var glyphs = obj.GetProperty("glyphs").EnumerateArray().ToArray();
                    Assert.Single(text.Runs);
                    var run = text.Runs[0];
                    var dx = Deltas(run.DeltaX); var dy = Deltas(run.DeltaY);
                    double x = run.XMillimeters, y = run.YMillimeters;
                    for (int g = 0; g < glyphs.Length; g++)
                    {
                        if (g > 0) { x += dx[g - 1]; y += dy[g - 1]; }
                        double Expected(string axis) => (glyphs[g].GetProperty("position").GetProperty(axis).GetDouble() + glyphs[g].GetProperty("offset").GetProperty(axis).GetDouble()) / 1000;
                        Assert.InRange(Math.Abs(x - Expected("x")), 0, 1e-9); Assert.InRange(Math.Abs(y - Expected("y")), 0, 1e-9);
                    }
                }
            }
        }
        Assert.Equal(string.Join("\f", expectedText), new OfdTextExtractor().Extract(document));
        using var zip = new ZipArchive(new MemoryStream(result.Bytes!), ZipArchiveMode.Read);
        var payloads = zip.Entries.Select(e => { using var input = e.Open(); using var output = new MemoryStream(); input.CopyTo(output); return output.ToArray(); }).ToArray();
        foreach (var resource in fixture.Resources) Assert.Contains(payloads, bytes => bytes.AsSpan().SequenceEqual(resource.Bytes.Span));
        foreach(var xmlBytes in payloads.Where(b => b.Length > 0 && b[0] == '<'))
            Assert.All(XDocument.Parse(Encoding.UTF8.GetString(xmlBytes)).Descendants(), e => Assert.Equal("http://www.ofdspec.org/2016", e.Name.NamespaceName));
        Assert.Equal(Digest(result.Bytes!), result.Sha256);
        var ids = payloads.Where(b => b.Length > 0 && b[0] == '<').SelectMany(b => XDocument.Parse(Encoding.UTF8.GetString(b)).Descendants().Attributes("ID")).Select(a => a.Value).ToArray();
        Assert.Equal(ids.Length, ids.Distinct().Count());
        var again = await new OfdIrWriter().WriteAsync(fixture.Ir, Digest(fixture.Ir), fixture.Resources, cancellationToken: TestContext.Current.CancellationToken);
        Assert.True(again.Ok); Assert.Equal(Normalized(result.Bytes!), Normalized(again.Bytes!));
        string? outputPath = Environment.GetEnvironmentVariable("OFD_WRITER_OUTPUT");
        if (outputPath is not null) { Directory.CreateDirectory(outputPath); await File.WriteAllBytesAsync(Path.Combine(outputPath, name + ".ofd"), result.Bytes!, TestContext.Current.CancellationToken); }
    }
    [Theory]
    [InlineData("fontId", "r999", "IR_REFERENCE")]
    [InlineData("stateId", "s999", "IR_REFERENCE")]
    public async Task Missing_references_fail_before_output(string field, string value, string code)
    {
        var fixture = await Fixture("cff");
        string text = Encoding.UTF8.GetString(fixture.Ir);
        using var parsed = JsonDocument.Parse(fixture.Ir);
        string old = parsed.RootElement.GetProperty("pages")[0].GetProperty("objects")[0].GetProperty(field).GetString()!;
        var ir = Encoding.UTF8.GetBytes(text.Replace("\"" + field + "\":\"" + old + "\"", "\"" + field + "\":\"" + value + "\""));
        var result = await new OfdIrWriter().WriteAsync(ir, Digest(ir), fixture.Resources, cancellationToken: TestContext.Current.CancellationToken);
        Assert.False(result.Ok); Assert.Equal(code, Assert.Single(result.Diagnostics).Code);
    }
    [Fact]
    public async Task Shared_clip_expansion_is_charged_before_object_construction()
    {
        var fixture = await Fixture("geometry");
        // 4 state clip + 4 image clip + 8 path commands fit 16; shared state copies do not.
        var result = await new OfdIrWriter().WriteAsync(fixture.Ir, Digest(fixture.Ir), fixture.Resources,
            new WriterLimits { Commands = 16 }, TestContext.Current.CancellationToken);
        Assert.False(result.Ok); Assert.Equal("RESOURCE_LIMIT", Assert.Single(result.Diagnostics).Code);
    }
    [Theory]
    [InlineData("cff", "CFF ")]
    [InlineData("truetype", "loca")]
    public async Task Invalid_font_structure_is_rejected_even_with_consistent_digests(string name, string tag)
    {
        var fixture = await Fixture(name);
        var resource = fixture.Resources[0]; var corrupt = resource.Bytes.ToArray();
        int count = System.Buffers.Binary.BinaryPrimitives.ReadUInt16BigEndian(corrupt.AsSpan(4));
        bool found=false;
        for(int i=0;i<count;i++) if(Encoding.ASCII.GetString(corrupt,12+i*16,4)==tag)
        {
            System.Buffers.Binary.BinaryPrimitives.WriteUInt32BigEndian(corrupt.AsSpan(12+i*16+12),0);
            found=true; break;
        }
        Assert.True(found);
        var oldDigest = Digest(resource.Bytes.ToArray()); var newDigest = Digest(corrupt);
        var changedIr = Encoding.UTF8.GetBytes(Encoding.UTF8.GetString(fixture.Ir).Replace(oldDigest,newDigest));
        var resources = fixture.Resources.Select(r=>r.ResourceId==resource.ResourceId ? new WriterResource(r.ResourceId,corrupt):r).ToList();
        var result=await new OfdIrWriter().WriteAsync(changedIr,Digest(changedIr),resources,cancellationToken:TestContext.Current.CancellationToken);
        Assert.False(result.Ok);Assert.Equal("IR_RESOURCE",Assert.Single(result.Diagnostics).Code);
    }
    [Fact]
    public async Task Cid_font_out_of_bounds_fdselect_is_rejected_after_rehash()
    {
        var fixture=await Fixture("cff");var resource=fixture.Resources[0];var corrupt=resource.Bytes.ToArray();
        int directory=28;Assert.Equal("CFF ",Encoding.ASCII.GetString(corrupt,directory,4));
        int start=(int)System.Buffers.Binary.BinaryPrimitives.ReadUInt32BigEndian(corrupt.AsSpan(directory+8));
        int length=(int)System.Buffers.Binary.BinaryPrimitives.ReadUInt32BigEndian(corrupt.AsSpan(directory+12));
        byte[] needle=[29,0,0,2,226,12,37];int found=corrupt.AsSpan(start,200).IndexOf(needle);Assert.True(found>=0);
        System.Buffers.Binary.BinaryPrimitives.WriteUInt32BigEndian(corrupt.AsSpan(start+found+1),(uint)(length+100));
        uint checksum=0;for(int i=0;i<length;i+=4){uint word=0;for(int b=0;b<4;b++)word=(word<<8)|(i+b<length?corrupt[start+i+b]:0u);checksum=unchecked(checksum+word);}
        System.Buffers.Binary.BinaryPrimitives.WriteUInt32BigEndian(corrupt.AsSpan(directory+4),checksum);
        var ir=Encoding.UTF8.GetBytes(Encoding.UTF8.GetString(fixture.Ir).Replace(Digest(resource.Bytes.ToArray()),Digest(corrupt)));
        var result=await new OfdIrWriter().WriteAsync(ir,Digest(ir),[new(resource.ResourceId,corrupt)],cancellationToken:TestContext.Current.CancellationToken);
        Assert.False(result.Ok);Assert.Equal("IR_RESOURCE",Assert.Single(result.Diagnostics).Code);
    }
    [Fact]
    public async Task Bad_png_crc_with_consistent_transport_digests_is_rejected()
    {
        var fixture=await Fixture("combined");var image=fixture.Resources.Single(r=>r.Bytes.Span.StartsWith(new byte[]{137,80,78,71}));
        var bad=image.Bytes.ToArray();bad[^1]^=1;
        var ir=Encoding.UTF8.GetBytes(Encoding.UTF8.GetString(fixture.Ir).Replace(Digest(image.Bytes.ToArray()),Digest(bad)));
        var resources=fixture.Resources.Select(r=>r.ResourceId==image.ResourceId?new WriterResource(r.ResourceId,bad):r).ToList();
        var result=await new OfdIrWriter().WriteAsync(ir,Digest(ir),resources,cancellationToken:TestContext.Current.CancellationToken);
        Assert.False(result.Ok);Assert.Equal("IR_RESOURCE",Assert.Single(result.Diagnostics).Code);
    }
    private static double[] Deltas(string? values) => (values ?? "").Split(' ', StringSplitOptions.RemoveEmptyEntries).Select(v => double.Parse(v, CultureInfo.InvariantCulture)).ToArray();
    private static string Normalized(byte[] bytes)
    {
        using var zip = new ZipArchive(new MemoryStream(bytes), ZipArchiveMode.Read);
        return string.Join("\n", zip.Entries.OrderBy(e => e.FullName).Select(e => { using var s = e.Open(); using var m = new MemoryStream(); s.CopyTo(m); return e.FullName + ":" + Digest(m.ToArray()); }));
    }
    [Fact]
    public async Task Digest_and_resource_failure_return_no_partial_artifact()
    {
        var fixture = await Fixture("cff");
        var writer = new OfdIrWriter();
        var badHash = await writer.WriteAsync(fixture.Ir, new string('0', 64), fixture.Resources, cancellationToken: TestContext.Current.CancellationToken);
        Assert.False(badHash.Ok); Assert.Null(badHash.ObjectMap); Assert.Equal("IR_DIGEST_MISMATCH", Assert.Single(badHash.Diagnostics).Code);
        var badResources = fixture.Resources.Select(r => new WriterResource(r.ResourceId, new byte[] { 1, 2 })).ToList();
        var bad = await writer.WriteAsync(fixture.Ir, Digest(fixture.Ir), badResources, cancellationToken: TestContext.Current.CancellationToken);
        Assert.False(bad.Ok); Assert.Null(bad.Bytes); Assert.Null(bad.ObjectMap); Assert.Equal("IR_RESOURCE", Assert.Single(bad.Diagnostics).Code);
    }
    [Fact]
    public async Task Budgets_are_applied_before_parse_and_resource_copy()
    {
        var fixture = await Fixture("cff");
        foreach (var limits in new[] { new WriterLimits { JsonBytes = 1 }, new WriterLimits { JsonTokens = 2 }, new WriterLimits { StringBytes = 1 }, new WriterLimits { ResourceBytes = 1 }, new WriterLimits { Glyphs = 0 }, new WriterLimits { Objects = 0 } })
        {
            var result = await new OfdIrWriter().WriteAsync(fixture.Ir, Digest(fixture.Ir), fixture.Resources, limits, TestContext.Current.CancellationToken);
            Assert.False(result.Ok); Assert.Equal("RESOURCE_LIMIT", Assert.Single(result.Diagnostics).Code);
        }
    }
}
