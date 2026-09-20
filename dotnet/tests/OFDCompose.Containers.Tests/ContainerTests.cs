using System.Diagnostics;
using System.IO.Compression;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Xml.Linq;
using OFDCompose.Containers;
using OFDCompose.OfdIrWriter;
using Ofdrw.Net.Reader.Readers;
using Xunit;

namespace OFDCompose.Containers.Tests;
public sealed class ContainerTests
{
    private static string Root
    {
        get { var dir = new DirectoryInfo(AppContext.BaseDirectory); while (dir is not null && !File.Exists(Path.Combine(dir.FullName, "pnpm-workspace.yaml"))) dir = dir.Parent; return dir!.FullName; }
    }
    private static ReadOnlyMemory<byte> ResolveBarcode(BarcodeGeometryRequest request,CancellationToken token)=>RunVerifier(JsonSerializer.Serialize(new { generatorVersion=request.GeneratorVersion,value=request.Value,options=JsonNode.Parse(request.OptionsJson.Span) }),token).GetAwaiter().GetResult();
    private static ReadOnlyMemory<byte> ResolveNumbering(NumberingLabelsRequest request,CancellationToken token)=>RunVerifier(JsonSerializer.Serialize(new { algorithmVersion=request.AlgorithmVersion,paragraphs=JsonNode.Parse(request.ParagraphsJson.Span) }),token).GetAwaiter().GetResult();
    private static async Task<byte[]> RunVerifier(string request,CancellationToken token)
    {
        using var timeout=CancellationTokenSource.CreateLinkedTokenSource(token);timeout.CancelAfter(TimeSpan.FromSeconds(15));
        var start=new ProcessStartInfo("node") { WorkingDirectory=Root,RedirectStandardInput=true,RedirectStandardOutput=true,RedirectStandardError=true };
        start.ArgumentList.Add(Path.Combine(Root,"tests/source-container/verify-barcode.mjs"));
        using var child=Process.Start(start)!;
        async Task<byte[]> ReadBounded(Stream stream,int maximum)
        {
            using var output=new MemoryStream();var buffer=new byte[8192];int length;
            while((length=await stream.ReadAsync(buffer,timeout.Token))>0)
            {if(output.Length+length>maximum)throw new InvalidDataException("Barcode verifier output limit");output.Write(buffer,0,length);}
            return output.ToArray();
        }
        try
        {
            var stdout=ReadBounded(child.StandardOutput.BaseStream,16*1024*1024);var stderr=ReadBounded(child.StandardError.BaseStream,16384);
            await child.StandardInput.WriteAsync(request.AsMemory(),timeout.Token);child.StandardInput.Close();
            await child.WaitForExitAsync(timeout.Token);await stderr;
            if(child.ExitCode!=0)throw new InvalidDataException("Barcode verifier rejected request");
            return await stdout;
        }
        finally {if(!child.HasExited)child.Kill(entireProcessTree:true);}
    }
    private static readonly System.Collections.Concurrent.ConcurrentDictionary<string,SourceRenderEvidence> GeneratedCache=new();
    private static SourceRenderEvidence? ResolveSourceRender(SourceRenderRequest request,CancellationToken token)
    {
        token.ThrowIfCancellationRequested();Assert.Equal("ofd-compose/source-render@0",request.AlgorithmVersion);
        string key=Hash(request.SourceJson.ToArray());
        if(GeneratedCache.TryGetValue(key,out var cached))return cached;
        var result=ResolveSourceRenderAsync(request,token).GetAwaiter().GetResult();GeneratedCache.TryAdd(key,result);return result;
    }
    private static async Task<SourceRenderEvidence> ResolveSourceRenderAsync(SourceRenderRequest request,CancellationToken token)
    {
        using var timeout=CancellationTokenSource.CreateLinkedTokenSource(token);timeout.CancelAfter(TimeSpan.FromSeconds(45));
        string directory=Path.Combine(Path.GetTempPath(),"ofd17-generated-"+Guid.NewGuid().ToString("N"));Directory.CreateDirectory(directory);
        string sourcePath=Path.Combine(directory,"input.json"),assetsPath=Path.Combine(directory,"assets.json");
        await File.WriteAllBytesAsync(sourcePath,request.SourceJson.ToArray(),timeout.Token);
        var assetFiles=new List<object>();
        foreach(var asset in request.Assets)
        {string file=Path.Combine(directory,asset.Sha256+".bin");await File.WriteAllBytesAsync(file,asset.Bytes.ToArray(),timeout.Token);assetFiles.Add(new {sha256=asset.Sha256,file});}
        await File.WriteAllTextAsync(assetsPath,JsonSerializer.Serialize(assetFiles),timeout.Token);
        var start=new ProcessStartInfo("node") {WorkingDirectory=Root,RedirectStandardOutput=true,RedirectStandardError=true};
        foreach(string argument in new[]{Path.Combine(Root,"tests/source-container/worker.mjs"),"verify-generated",directory,sourcePath,assetsPath})start.ArgumentList.Add(argument);
        using var child=Process.Start(start)!;
        async Task<byte[]> ReadBounded(Stream stream,int maximum)
        {
            using var output=new MemoryStream();var buffer=new byte[8192];int length;
            while((length=await stream.ReadAsync(buffer,timeout.Token))>0){if(output.Length+length>maximum)throw new InvalidDataException("Generated-path host output limit");output.Write(buffer,0,length);}
            return output.ToArray();
        }
        try
        {
            var stdout=ReadBounded(child.StandardOutput.BaseStream,8*1024*1024);var stderr=ReadBounded(child.StandardError.BaseStream,32768);
            await child.WaitForExitAsync(timeout.Token);await stdout;byte[] errors=await stderr;
            if(child.ExitCode!=0)throw new InvalidDataException(Encoding.UTF8.GetString(errors));
        }
        finally {if(!child.HasExited)child.Kill(entireProcessTree:true);}
        byte[] ir=await File.ReadAllBytesAsync(Path.Combine(directory,"ir.json"),timeout.Token);
        var manifest=JsonNode.Parse(await File.ReadAllTextAsync(Path.Combine(directory,"manifest.json"),timeout.Token))!;
        var resources=new List<WriterResource>();
        foreach(var resource in manifest["resources"]!.AsArray())resources.Add(new(resource!["resourceId"]!.GetValue<string>(),await File.ReadAllBytesAsync(Path.Combine(directory,resource["file"]!.GetValue<string>()),timeout.Token)));
        var written=await new OfdIrWriter.OfdIrWriter().WriteAsync(ir,Hash(ir),resources,cancellationToken:timeout.Token);Assert.True(written.Ok,JsonSerializer.Serialize(written.Diagnostics));
        var package=Zip(written.Bytes!);using var parsed=JsonDocument.Parse(ir);var root=parsed.RootElement;
        var semantics=root.GetProperty("semantics").EnumerateArray().Select(e=>e.GetProperty("objectId").GetString()!).ToHashSet();
        var result=new List<GeneratedPathPayload>();
        foreach(var page in root.GetProperty("pages").EnumerateArray())
        {
            int index=page.GetProperty("pageIndex").GetInt32();var xml=XDocument.Parse(Encoding.UTF8.GetString(package[$"Doc_0/Pages/Page_{index}/Content.xml"]));
            var elements=xml.Descendants().Where(e=>e.Attribute("ID") is not null).ToDictionary(e=>(string)e.Attribute("ID")!);int order=0;
            foreach(var item in page.GetProperty("objects").EnumerateArray())
            {
                string id=item.GetProperty("id").GetString()!;
                if(item.GetProperty("kind").GetString()=="path"&&!semantics.Contains(id))result.Add(new(id,index,order,Encoding.UTF8.GetBytes(elements[written.ObjectMap![id][0]].ToString(SaveOptions.DisableFormatting))));
                order++;
            }
        }
        var tables=root.GetProperty("semantics").EnumerateArray().Where(entry=>entry.TryGetProperty("table",out _)).Select(entry=>new RenderedTableRelation(entry.GetProperty("objectId").GetString()!,Encoding.UTF8.GetBytes(entry.GetProperty("table").GetRawText()),entry.TryGetProperty("repeatedHeader",out var repeated)?Encoding.UTF8.GetBytes(repeated.GetRawText()):ReadOnlyMemory<byte>.Empty)).ToArray();
        using var captured=JsonDocument.Parse(await File.ReadAllBytesAsync(Path.Combine(directory,"source.json"),timeout.Token));
        var irObjects=root.GetProperty("pages").EnumerateArray().SelectMany(page=>page.GetProperty("objects").EnumerateArray().Select((item,index)=>(Page:page.GetProperty("pageIndex").GetInt32(),Index:index,Item:item))).ToDictionary(item=>item.Item.GetProperty("id").GetString()!);
        var bands=captured.RootElement.GetProperty("semanticMap").GetProperty("pageDecorations").EnumerateArray().Where(entry=>entry.GetProperty("pointer").GetString()!.EndsWith("/header",StringComparison.Ordinal)||entry.GetProperty("pointer").GetString()!.EndsWith("/footer",StringComparison.Ordinal)).GroupBy(entry=>(irObjects[entry.GetProperty("objectId").GetString()!].Page,Pointer:entry.GetProperty("pointer").GetString()!)).Select(group=>new RenderedPageBand(group.Key.Page,group.Key.Pointer,string.Concat(group.Select(entry=>irObjects[entry.GetProperty("objectId").GetString()!]).OrderBy(item=>item.Index).Where(item=>item.Item.GetProperty("kind").GetString()=="text").Select(item=>item.Item.GetProperty("logicalText").GetString())))).ToArray();
        return new(result.ToArray(),tables,bands);
    }
    private static string Hash(byte[] value) => Convert.ToHexStringLower(SHA256.HashData(value));
    private sealed record Fixture(string Directory, byte[] Source, OfdWriteResult Ofd, byte[] Sealed, JsonNode Identity);
    private static readonly Lazy<Task<Fixture>> Initial = new(() => Build("initial"));
    private static async Task<Fixture> Build(string mode, string? source = null)
    {
        string directory = Path.Combine(Path.GetTempPath(), "ofd17-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(directory);
        var start = new ProcessStartInfo("node") { WorkingDirectory = Root, RedirectStandardOutput = true, RedirectStandardError = true };
        start.ArgumentList.Add(Path.Combine(Root, "tests/source-container/worker.mjs"));
        start.ArgumentList.Add(mode); start.ArgumentList.Add(directory);
        if (source is not null) start.ArgumentList.Add(source);
        using var child = Process.Start(start)!;
        var stdout = child.StandardOutput.ReadToEndAsync(); var stderr = child.StandardError.ReadToEndAsync();
        await child.WaitForExitAsync(TestContext.Current.CancellationToken);
        Assert.True(child.ExitCode == 0, await stderr); await stdout;
        var ir = await File.ReadAllBytesAsync(Path.Combine(directory, "ir.json"));
        var manifest = JsonNode.Parse(await File.ReadAllTextAsync(Path.Combine(directory, "manifest.json")))!;
        var resources = new List<WriterResource>();
        foreach (var resource in manifest["resources"]!.AsArray())
            resources.Add(new(resource!["resourceId"]!.GetValue<string>(), await File.ReadAllBytesAsync(Path.Combine(directory, resource["file"]!.GetValue<string>()))));
        var ofd = await new OfdIrWriter.OfdIrWriter().WriteAsync(ir, Hash(ir), resources, cancellationToken: TestContext.Current.CancellationToken);
        Assert.True(ofd.Ok, JsonSerializer.Serialize(ofd.Diagnostics));
        var sourceBytes = await File.ReadAllBytesAsync(Path.Combine(directory, "source.json"));
        var assets = new List<SourceAsset>();
        foreach (var asset in manifest["sourceAssets"]!.AsArray()) assets.Add(new(asset!["sha256"]!.GetValue<string>(), await File.ReadAllBytesAsync(Path.Combine(directory, asset["file"]!.GetValue<string>()))));
        var sealedResult = SourceContainer.Create(ofd.Bytes!, Hash(ir), ofd.ObjectMap!, ContainerProfile.NativeEditable, sourceBytes, assets, barcodeGeometryResolver:ResolveBarcode,numberingLabelsResolver:ResolveNumbering,sourceRenderResolver:ResolveSourceRender,cancellationToken:TestContext.Current.CancellationToken, resourceMap:ofd.ResourceMap);
        Assert.True(sealedResult.Ok, sealedResult.Error + ": " + string.Join(",", Zip(ofd.Bytes!).Keys));
        await File.WriteAllBytesAsync(Path.Combine(directory, "native.ofd"), sealedResult.Bytes!, TestContext.Current.CancellationToken);
        return new(directory, sourceBytes, ofd, sealedResult.Bytes!, manifest["identity"]!);
    }
    private static Dictionary<string, byte[]> Zip(byte[] bytes)
    {
        using var archive = new ZipArchive(new MemoryStream(bytes), ZipArchiveMode.Read);
        return archive.Entries.ToDictionary(e => e.FullName, e => { using var source=e.Open(); using var target=new MemoryStream(); source.CopyTo(target); return target.ToArray(); });
    }
    private static byte[] Pack(Dictionary<string, byte[]> entries, string? duplicate = null, CompressionLevel level = CompressionLevel.Optimal)
    {
        using var memory = new MemoryStream();
        using (var archive = new ZipArchive(memory, ZipArchiveMode.Create, true))
        {
            foreach (var (name, bytes) in entries) { using var entry = archive.CreateEntry(name,level).Open(); entry.Write(bytes); }
            if (duplicate is not null) { using var entry=archive.CreateEntry(duplicate).Open(); entry.Write([1]); }
        }
        return memory.ToArray();
    }
    private static byte[] Mutate(byte[] input, Action<JsonNode, Dictionary<string, byte[]>> action)
    {
        var entries = Zip(input); const string path="Doc_0/Attachs/ofd-compose.json";
        var manifest=JsonNode.Parse(entries[path])!; action(manifest,entries);
        entries[path]=Encoding.UTF8.GetBytes(manifest.ToJsonString()); return Pack(entries);
    }
    [Fact]
    public async Task Extract_edit_new_glyph_finalize_real_worker_and_reader_preserve_old_bytes()
    {
        var first = await Initial.Value;
        string originalHash = Hash(first.Sealed);
        var extracted = SourceContainer.Extract(first.Sealed, barcodeGeometryResolver:ResolveBarcode,numberingLabelsResolver:ResolveNumbering,sourceRenderResolver:ResolveSourceRender,cancellationToken:TestContext.Current.CancellationToken);
        Assert.True(extracted.Ok, extracted.Error);
        Assert.Equal("internal-consistency-only", extracted.Integrity); Assert.Equal("unsigned", extracted.Signature);
        var firstRead = await new OfdReader().ReadAsync(new MemoryStream(first.Sealed), TestContext.Current.CancellationToken);
        var attachment = Assert.Single(firstRead.Attachments);
        Assert.Equal("application/json", attachment.MediaType);
        Assert.True(uint.TryParse(attachment.Id,out uint attachmentId)&&attachmentId>0);
        Assert.Equal(Zip(first.Sealed)["Doc_0/Attachs/ofd-compose.json"], attachment.Data);
        string input = Path.Combine(first.Directory,"extracted.json"); await File.WriteAllBytesAsync(input,extracted.SourceJson!, TestContext.Current.CancellationToken);
        var second = await Build("edit",input);
        var secondExtract = SourceContainer.Extract(second.Sealed, barcodeGeometryResolver:ResolveBarcode,numberingLabelsResolver:ResolveNumbering,sourceRenderResolver:ResolveSourceRender,cancellationToken:TestContext.Current.CancellationToken); Assert.True(secondExtract.Ok,secondExtract.Error);
        var secondRead = await new OfdReader().ReadAsync(new MemoryStream(second.Sealed), TestContext.Current.CancellationToken);
        Assert.Equal("office 中文",string.Concat(firstRead.Pages.SelectMany(p=>p.Elements).OfType<Ofdrw.Net.Core.Models.OfdTextElement>().Select(t=>t.Text)));
        Assert.Equal("edited office 中文新",string.Concat(secondRead.Pages.SelectMany(p=>p.Elements).OfType<Ofdrw.Net.Core.Models.OfdTextElement>().Select(t=>t.Text)));
        var before = JsonNode.Parse(first.Source)!; var after = JsonNode.Parse(secondExtract.SourceJson!)!;
        Assert.Equal("revision-1",before["resolvedDocument"]!["revisionId"]!.GetValue<string>());
        Assert.Equal("revision-2",after["resolvedDocument"]!["revisionId"]!.GetValue<string>());
        foreach (string key in new[]{"resolvedDocumentDigest","irDigest","layoutInputDigest"}) Assert.NotEqual(first.Identity[key]!.ToJsonString(),second.Identity[key]!.ToJsonString());
        Assert.NotEqual(before["resources"]!["layout"]![0]!["subsetDigest"]!.GetValue<string>(),after["resources"]!["layout"]![0]!["subsetDigest"]!.GetValue<string>());
        Assert.Equal(before["resources"]!["fonts"]!.ToJsonString(),after["resources"]!["fonts"]!.ToJsonString());
        Assert.Equal(originalHash,Hash(first.Sealed));
        Assert.False(second.Identity.AsObject().ContainsKey("dataDigest"));
        Assert.False(second.Identity.AsObject().ContainsKey("compiledDigest"));
        foreach(var secret in new[]{"UNUSED_SECRET","DEBUG_SECRET","TOKEN_SECRET","PASSWORD_SECRET","UNUSED_STYLE_SECRET","unknownFunction"})
        { Assert.DoesNotContain(secret,Encoding.UTF8.GetString(first.Source)); Assert.DoesNotContain(secret,Encoding.UTF8.GetString(second.Source)); }
        Assert.Contains("printed",Encoding.UTF8.GetString(first.Source)); Assert.Contains("office 中文",Encoding.UTF8.GetString(first.Source));
        // Preserve file paths for independent Java reader evidence outside the runtime code.
        if (Environment.GetEnvironmentVariable("OFD17_EVIDENCE") is { } evidence)
        { Directory.CreateDirectory(evidence); File.WriteAllBytes(Path.Combine(evidence,"initial.ofd"),first.Sealed); File.WriteAllBytes(Path.Combine(evidence,"edited.ofd"),second.Sealed); File.WriteAllText(Path.Combine(evidence,"paths.json"),JsonSerializer.Serialize(new[]{first.Directory,second.Directory}));
          foreach(var (name, directory) in new[]{("initial",first.Directory),("edited",second.Directory)}) { var target=Path.Combine(evidence,"fixtures",name);Directory.CreateDirectory(target); foreach(var file in new[]{"ir.json","source.json"})File.Copy(Path.Combine(directory,file),Path.Combine(target,file),true); } }
    }
    [Theory]
    [InlineData("protocol", "PROTOCOL_INVALID")]
    [InlineData("digest", "DIGEST_MISMATCH")]
    [InlineData("resource", "RESOURCE_MISSING")]
    [InlineData("version", "VERSION_UNSUPPORTED")]
    [InlineData("extension", "VERSION_UNSUPPORTED")]
    [InlineData("mime", "SCHEMA_INVALID")]
    [InlineData("schema", "SCHEMA_INVALID")]
    public async Task Recognizable_failures(string mutation,string expected)
    {
        var first=await Initial.Value;
        var bytes=Mutate(first.Sealed,(manifest,entries)=> {
            switch(mutation)
            {
                case "protocol": manifest["protocol"]="forged"; break;
                case "digest": manifest["parts"]![0]!["sha256"]=new string('0',64); break;
                case "resource": entries.Remove(entries.Keys.First(p=>p.EndsWith(".otf"))); break;
                case "version": manifest["containerProfileVersion"]="future"; break;
                case "extension": manifest["capabilities"]!.AsArray().Add("execute-script"); break;
                case "mime": manifest["parts"]![0]!["mimeType"]="text/javascript"; break;
                case "schema": var content=JsonNode.Parse(manifest["parts"]![0]!["content"]!.GetValue<string>())!; content["credentials"]="SECRET"; manifest["parts"]![0]!["content"]=content.ToJsonString(); break;
            }
        });
        Assert.Equal(expected,SourceContainer.Extract(bytes, barcodeGeometryResolver:ResolveBarcode,numberingLabelsResolver:ResolveNumbering,sourceRenderResolver:ResolveSourceRender,cancellationToken:TestContext.Current.CancellationToken).Error);
    }
    [Fact]
    public async Task Distribution_has_no_source_or_semantics_anywhere()
    {
        var first=await Initial.Value;
        var result=SourceContainer.Create(first.Ofd.Bytes!,first.Identity["irDigest"]!.GetValue<string>(),first.Ofd.ObjectMap!,ContainerProfile.Distribution, barcodeGeometryResolver:ResolveBarcode,numberingLabelsResolver:ResolveNumbering,sourceRenderResolver:ResolveSourceRender,cancellationToken:TestContext.Current.CancellationToken, resourceMap:first.Ofd.ResourceMap);
        Assert.True(result.Ok,result.Error);
        var extracted=SourceContainer.Extract(result.Bytes!, barcodeGeometryResolver:ResolveBarcode,numberingLabelsResolver:ResolveNumbering,sourceRenderResolver:ResolveSourceRender,cancellationToken:TestContext.Current.CancellationToken); Assert.True(extracted.Ok,extracted.Error);
        Assert.Equal("distribution",extracted.Profile); Assert.Null(extracted.SourceJson);
        foreach(var bytes in Zip(result.Bytes!).Values)
        { var text=Encoding.UTF8.GetString(bytes); Assert.DoesNotContain("resolved-document@",text); Assert.DoesNotContain("printed",text); Assert.DoesNotContain("revision-1",text); }
        Assert.Equal("DISTRIBUTION_SOURCE_FORBIDDEN",SourceContainer.Create(first.Ofd.Bytes!,first.Identity["irDigest"]!.GetValue<string>(),first.Ofd.ObjectMap!,ContainerProfile.Distribution,first.Source, barcodeGeometryResolver:ResolveBarcode,numberingLabelsResolver:ResolveNumbering,sourceRenderResolver:ResolveSourceRender,cancellationToken:TestContext.Current.CancellationToken, resourceMap:first.Ofd.ResourceMap).Error);
    }
    [Fact]
    public async Task Budget_cancellation_path_duplicates_DTD_and_forged_name_fail_closed()
    {
        var first=await Initial.Value;
        Assert.Equal("SIZE_LIMIT",SourceContainer.Extract(first.Sealed,new(){PackageBytes=100}, barcodeGeometryResolver:ResolveBarcode,numberingLabelsResolver:ResolveNumbering,sourceRenderResolver:ResolveSourceRender,cancellationToken:TestContext.Current.CancellationToken).Error);
        Assert.Equal("SIZE_LIMIT",SourceContainer.Extract(first.Sealed,new(){Entries=1}, barcodeGeometryResolver:ResolveBarcode,numberingLabelsResolver:ResolveNumbering,sourceRenderResolver:ResolveSourceRender,cancellationToken:TestContext.Current.CancellationToken).Error);
        Assert.Equal("CANCELLED",SourceContainer.Extract(first.Sealed,cancellationToken:new(true)).Error);
        foreach(string alias in new[]{"../escape","Doc_0/Res/é.bin","Doc_0\\escape","/absolute","a//b","a/./b"})
        { var entries=Zip(first.Sealed);entries.Add(alias,[1]);Assert.Equal("PACKAGE_PATH",SourceContainer.Extract(Pack(entries), barcodeGeometryResolver:ResolveBarcode,numberingLabelsResolver:ResolveNumbering,sourceRenderResolver:ResolveSourceRender,cancellationToken:TestContext.Current.CancellationToken).Error); }
        Assert.Equal("PACKAGE_DUPLICATE",SourceContainer.Extract(Pack(Zip(first.Sealed),"ofd.XML"), barcodeGeometryResolver:ResolveBarcode,numberingLabelsResolver:ResolveNumbering,sourceRenderResolver:ResolveSourceRender,cancellationToken:TestContext.Current.CancellationToken).Error);
        var dtd=Zip(first.Sealed);dtd["OFD.xml"]=Encoding.UTF8.GetBytes("<!DOCTYPE OFD [<!ENTITY x SYSTEM 'file:///etc/passwd'>]><OFD xmlns='http://www.ofdspec.org/2016'>&x;</OFD>");
        Assert.False(SourceContainer.Extract(Pack(dtd), barcodeGeometryResolver:ResolveBarcode,numberingLabelsResolver:ResolveNumbering,sourceRenderResolver:ResolveSourceRender,cancellationToken:TestContext.Current.CancellationToken).Ok);
        var forged=Zip(first.Sealed);forged["Doc_0/Attachs/Attachments.xml"]=Encoding.UTF8.GetBytes(Encoding.UTF8.GetString(forged["Doc_0/Attachs/Attachments.xml"]).Replace("ofd-compose.json","forged.json"));
        Assert.Equal("ATTACHMENT_INVALID",SourceContainer.Extract(Pack(forged), barcodeGeometryResolver:ResolveBarcode,numberingLabelsResolver:ResolveNumbering,sourceRenderResolver:ResolveSourceRender,cancellationToken:TestContext.Current.CancellationToken).Error);
    }
    [Fact]
    public async Task Signed_presence_is_unverified_and_signed_input_cannot_be_resealed()
    {
        var first=await Initial.Value;
        var signed=Mutate(first.Sealed,(manifest,entries)=> {
            var root=XDocument.Parse(Encoding.UTF8.GetString(entries["OFD.xml"]));
            root.Descendants().First(e=>e.Name.LocalName=="DocBody").Add(new XElement(root.Root!.Name.Namespace+"Signatures","Doc_0/Signs/Signatures.xml"));
            entries["OFD.xml"]=Encoding.UTF8.GetBytes(root.ToString());
            entries["Doc_0/Signs/Signatures.xml"]=Encoding.UTF8.GetBytes("<Signatures xmlns='http://www.ofdspec.org/2016'/>");
            var record=manifest["entries"]!.AsArray().Single(e=>e!["path"]!.GetValue<string>()=="OFD.xml")!;
            record["byteLength"]=entries["OFD.xml"].Length;record["sha256"]=Hash(entries["OFD.xml"]);
        });
        var result=SourceContainer.Extract(signed,barcodeGeometryResolver:ResolveBarcode,numberingLabelsResolver:ResolveNumbering,sourceRenderResolver:ResolveSourceRender,cancellationToken:TestContext.Current.CancellationToken);
        Assert.True(result.Ok,result.Error);Assert.Equal("present-unverified",result.Signature);Assert.Equal("internal-consistency-only",result.Integrity);
        Assert.Equal("SIGNED_INPUT_UNSUPPORTED",SourceContainer.Create(signed,first.Identity["irDigest"]!.GetValue<string>(),first.Ofd.ObjectMap!,ContainerProfile.Distribution,barcodeGeometryResolver:ResolveBarcode,numberingLabelsResolver:ResolveNumbering,sourceRenderResolver:ResolveSourceRender,cancellationToken:TestContext.Current.CancellationToken, resourceMap:first.Ofd.ResourceMap).Error);
    }

    [Fact]
    public async Task Combined_media_assets_are_preserved_and_missing_source_image_is_rejected()
    {
        var fixture=await Build("combined");
        var extracted=SourceContainer.Extract(fixture.Sealed,barcodeGeometryResolver:ResolveBarcode,numberingLabelsResolver:ResolveNumbering,sourceRenderResolver:ResolveSourceRender,cancellationToken:TestContext.Current.CancellationToken);
        Assert.True(extracted.Ok,extracted.Error);Assert.NotEmpty(extracted.Assets!);
        var bytes=Mutate(fixture.Sealed,(_,entries)=>entries.Remove(entries.Keys.First(p=>p.StartsWith("Doc_0/Attachs/Assets/"))));
        Assert.Equal("RESOURCE_MISSING",SourceContainer.Extract(bytes,barcodeGeometryResolver:ResolveBarcode,numberingLabelsResolver:ResolveNumbering,sourceRenderResolver:ResolveSourceRender,cancellationToken:TestContext.Current.CancellationToken).Error);
        var read=await new OfdReader().ReadAsync(new MemoryStream(fixture.Sealed),TestContext.Current.CancellationToken);
        Assert.Contains(read.Pages.SelectMany(p=>p.Elements),e=>e is Ofdrw.Net.Core.Models.OfdImageElement);
    }

    [Theory]
    [InlineData("resources", "RESOURCE_INCOMPLETE")]
    [InlineData("semantics", "SEMANTIC_INCOMPLETE")]
    [InlineData("partial-semantics", "SEMANTIC_INCOMPLETE")]
    [InlineData("source-node", "SEMANTIC_SOURCE")]
    [InlineData("source-range", "SEMANTIC_SOURCE")]
    [InlineData("page", "SEMANTIC_REFERENCE")]
    public async Task Recomputed_hashes_do_not_bypass_cross_part_consistency(string mutation,string expected)
    {
        var first=await Initial.Value;
        var bytes=Mutate(first.Sealed,(manifest,_)=> {
            string name=mutation=="resources"?"resources":"semanticMap";
            var part=manifest["parts"]!.AsArray().Single(p=>p!["name"]!.GetValue<string>()==name)!;
            var content=JsonNode.Parse(part["content"]!.GetValue<string>())!;
            switch(mutation)
            {
                case "resources":content=JsonNode.Parse("{\"fonts\":[],\"images\":[],\"layout\":[]}")!;break;
                case "semantics":content["entries"]=new JsonArray();break;
                case "partial-semantics":content["entries"]!.AsArray().RemoveAt(0);content["entries"]![0]!["readingOrder"]=0;break;
                case "source-node":content["entries"]![0]!["nodeId"]="nonexistent-node";break;
                case "source-range":content["entries"]![0]!["sourceRanges"]![0]!["sourceText"]!["range"]!["end"]=1;break;
                case "page":content["entries"]![0]!["pageIndex"]=99;break;
            }
            string json=content.ToJsonString();part["content"]=json;part["sha256"]=Hash(Encoding.UTF8.GetBytes(json));
        });
        Assert.Equal(expected,SourceContainer.Extract(bytes,barcodeGeometryResolver:ResolveBarcode,numberingLabelsResolver:ResolveNumbering,sourceRenderResolver:ResolveSourceRender,cancellationToken:TestContext.Current.CancellationToken).Error);
    }

    [Fact]
    public async Task Rejects_compression_bombs_nested_archives_header_lies_and_duplicate_JSON_keys()
    {
        var first=await Initial.Value;
        var entries=Zip(first.Sealed);entries.Add("Doc_0/Res/bomb.otf",new byte[2*1024*1024]);
        Assert.Equal("SIZE_LIMIT",SourceContainer.Extract(Pack(entries),barcodeGeometryResolver:ResolveBarcode,numberingLabelsResolver:ResolveNumbering,sourceRenderResolver:ResolveSourceRender,cancellationToken:TestContext.Current.CancellationToken).Error);
        entries=Zip(first.Sealed);entries.Add("Doc_0/Res/nested.zip",[80,75,3,4]);
        Assert.Equal("UNEXPECTED_ENTRY",SourceContainer.Extract(Pack(entries),barcodeGeometryResolver:ResolveBarcode,numberingLabelsResolver:ResolveNumbering,sourceRenderResolver:ResolveSourceRender,cancellationToken:TestContext.Current.CancellationToken).Error);
        var header=(byte[])first.Sealed.Clone();header[14]^=1;
        Assert.Equal("PACKAGE_SIZE",SourceContainer.Extract(header,barcodeGeometryResolver:ResolveBarcode,numberingLabelsResolver:ResolveNumbering,sourceRenderResolver:ResolveSourceRender,cancellationToken:TestContext.Current.CancellationToken).Error);
        entries=Zip(first.Sealed);const string path="Doc_0/Attachs/ofd-compose.json";
        entries[path]=Encoding.UTF8.GetBytes("{\"namespace\":\"ofd-compose\","+Encoding.UTF8.GetString(entries[path])[1..]);
        Assert.Equal("SCHEMA_INVALID",SourceContainer.Extract(Pack(entries),barcodeGeometryResolver:ResolveBarcode,numberingLabelsResolver:ResolveNumbering,sourceRenderResolver:ResolveSourceRender,cancellationToken:TestContext.Current.CancellationToken).Error);
        Assert.Equal("SIZE_LIMIT",SourceContainer.Extract(first.Sealed,new(){WorkBytes=100},barcodeGeometryResolver:ResolveBarcode,numberingLabelsResolver:ResolveNumbering,sourceRenderResolver:ResolveSourceRender,cancellationToken:TestContext.Current.CancellationToken).Error);
    }

    private sealed class ChangingMap(IReadOnlyDictionary<string,string[]> original) : IReadOnlyDictionary<string,string[]>
    {
        private readonly Dictionary<string,string[]> data=original.ToDictionary(p=>p.Key,p=>p.Value.ToArray());
        private bool changed;
        public string[] this[string key]=>data[key];
        public IEnumerable<string> Keys=>data.Keys;
        public IEnumerable<string[]> Values=>data.Values;
        public int Count=>data.Count;
        public bool ContainsKey(string key)=>data.ContainsKey(key);
        public bool TryGetValue(string key,out string[] value)=>data.TryGetValue(key,out value!);
        public IEnumerator<KeyValuePair<string,string[]>> GetEnumerator()
        {
            foreach(var pair in data)yield return pair;
            if(!changed){changed=true;data.First().Value[0]="caller-mutated";}
        }
        System.Collections.IEnumerator System.Collections.IEnumerable.GetEnumerator()=>GetEnumerator();
    }
    private sealed class ChangingMemory(byte[] initial, byte[]? subsequent = null) : System.Buffers.MemoryManager<byte>
    {
        private int reads;
        private readonly byte[] later=subsequent??new byte[initial.Length];
        public ReadOnlyMemory<byte> Input=>CreateMemory(initial.Length);
        public override Span<byte> GetSpan()=>reads++==0?initial:later;
        public override System.Buffers.MemoryHandle Pin(int elementIndex=0)=>throw new NotSupportedException();
        public override void Unpin() { }
        protected override void Dispose(bool disposing) { }
    }
    [Fact]
    public async Task Owns_caller_JSON_and_object_map_before_validation_and_serialization()
    {
        var first=await Initial.Value;
        using var source=new ChangingMemory(first.Source);
        var created=SourceContainer.Create(first.Ofd.Bytes!,first.Identity["irDigest"]!.GetValue<string>(),new ChangingMap(first.Ofd.ObjectMap!),ContainerProfile.NativeEditable,source.Input,barcodeGeometryResolver:ResolveBarcode,numberingLabelsResolver:ResolveNumbering,sourceRenderResolver:ResolveSourceRender,cancellationToken:TestContext.Current.CancellationToken, resourceMap:first.Ofd.ResourceMap);
        Assert.True(created.Ok,created.Error);
        var extracted=SourceContainer.Extract(created.Bytes!,barcodeGeometryResolver:ResolveBarcode,numberingLabelsResolver:ResolveNumbering,sourceRenderResolver:ResolveSourceRender,cancellationToken:TestContext.Current.CancellationToken);
        Assert.True(extracted.Ok,extracted.Error);
        Assert.DoesNotContain("caller-mutated",Encoding.UTF8.GetString(created.Bytes!));
    }

    [Theory]
    [InlineData("checkbox-true","[x]")]
    [InlineData("checkbox-false","[ ]")]
    public async Task Boolean_controls_keep_the_layout_display_representation(string mode,string expected)
    {
        var fixture=await Build(mode);
        var extracted=SourceContainer.Extract(fixture.Sealed,barcodeGeometryResolver:ResolveBarcode,numberingLabelsResolver:ResolveNumbering,sourceRenderResolver:ResolveSourceRender,cancellationToken:TestContext.Current.CancellationToken);
        Assert.True(extracted.Ok,extracted.Error);
        var read=await new OfdReader().ReadAsync(new MemoryStream(fixture.Sealed),TestContext.Current.CancellationToken);
        Assert.Equal(expected,string.Concat(read.Pages.SelectMany(p=>p.Elements).OfType<Ofdrw.Net.Core.Models.OfdTextElement>().Select(t=>t.Text)));
    }
    [Fact]
    public async Task Replacing_source_image_and_recomputing_hashes_cannot_change_the_rendered_asset()
    {
        var fixture=await Build("combined");
        var corpus=JsonNode.Parse(await File.ReadAllTextAsync(Path.Combine(Root,"packages/media-core/tests/fixtures.json"),TestContext.Current.CancellationToken))!;
        byte[] replacement=Convert.FromBase64String(corpus["jpeg"]!.GetValue<string>());
        string digest=Hash(replacement);
        var bytes=Mutate(fixture.Sealed,(manifest,entries)=> {
            var part=manifest["parts"]!.AsArray().Single(p=>p!["name"]!.GetValue<string>()=="resources")!;
            var resources=JsonNode.Parse(part["content"]!.GetValue<string>())!;
            var image=resources["images"]![0]!;string oldDigest=image["sha256"]!.GetValue<string>();Assert.NotEqual(oldDigest,digest);
            string oldPath="Doc_0/Attachs/Assets/"+oldDigest+".bin",newPath="Doc_0/Attachs/Assets/"+digest+".bin";
            entries.Remove(oldPath);entries.Add(newPath,replacement);
            image["sha256"]=digest;image["byteLength"]=replacement.Length;image["mimeType"]="image/jpeg";
            string json=resources.ToJsonString();part["content"]=json;part["sha256"]=Hash(Encoding.UTF8.GetBytes(json));
            var entry=manifest["entries"]!.AsArray().Single(e=>e!["path"]!.GetValue<string>()==oldPath)!;
            entry["path"]=newPath;entry["sha256"]=digest;entry["byteLength"]=replacement.Length;
        });
        Assert.Equal("RESOURCE_IMAGE_MISMATCH",SourceContainer.Extract(bytes,barcodeGeometryResolver:ResolveBarcode,numberingLabelsResolver:ResolveNumbering,sourceRenderResolver:ResolveSourceRender,cancellationToken:TestContext.Current.CancellationToken).Error);
        byte[] Inline(byte[] imageBytes)=>Mutate(fixture.Sealed,(manifest,entries)=> {
            foreach(var part in manifest["parts"]!.AsArray())
            {
                string name=part!["name"]!.GetValue<string>();var content=JsonNode.Parse(part["content"]!.GetValue<string>())!;
                if(name=="resolvedDocument")content["body"]!.AsArray().Single(b=>b!["kind"]!.GetValue<string>()=="image-binding")!["sources"]=new JsonArray(Convert.ToBase64String(imageBytes));
                if(name=="resources")content["images"]=new JsonArray();
                string json=content.ToJsonString();part["content"]=json;part["sha256"]=Hash(Encoding.UTF8.GetBytes(json));
            }
            var inventory=manifest["entries"]!.AsArray();
            foreach(var entry in inventory.ToArray())if(entry!["path"]!.GetValue<string>().StartsWith("Doc_0/Attachs/Assets/",StringComparison.Ordinal)){entries.Remove(entry["path"]!.GetValue<string>());inventory.Remove(entry);}
        });
        Assert.Equal("RESOURCE_IMAGE_MISMATCH",SourceContainer.Extract(Inline(replacement),barcodeGeometryResolver:ResolveBarcode,numberingLabelsResolver:ResolveNumbering,sourceRenderResolver:ResolveSourceRender,cancellationToken:TestContext.Current.CancellationToken).Error);
        byte[] originalImage=Zip(fixture.Sealed).First(e=>e.Key.StartsWith("Doc_0/Attachs/Assets/",StringComparison.Ordinal)).Value;
        var sameImage=SourceContainer.Extract(Inline(originalImage),barcodeGeometryResolver:ResolveBarcode,numberingLabelsResolver:ResolveNumbering,sourceRenderResolver:ResolveSourceRender,cancellationToken:TestContext.Current.CancellationToken);Assert.True(sameImage.Ok,sameImage.Error);
    }

    [Fact]
    public async Task Source_image_ID_swap_is_rejected_even_when_the_digest_set_is_unchanged()
    {
        var fixture=await Build("two-images");
        var bytes=Mutate(fixture.Sealed,(manifest,_)=> {
            var part=manifest["parts"]!.AsArray().Single(p=>p!["name"]!.GetValue<string>()=="resources")!;
            var resources=JsonNode.Parse(part["content"]!.GetValue<string>())!;var images=resources["images"]!.AsArray();Assert.Equal(2,images.Count);
            foreach(string key in new[]{"sha256","byteLength"}){var first=images[0]![key]!.DeepClone();images[0]![key]=images[1]![key]!.DeepClone();images[1]![key]=first;}
            string json=resources.ToJsonString();part["content"]=json;part["sha256"]=Hash(Encoding.UTF8.GetBytes(json));
        });
        Assert.Equal("RESOURCE_IMAGE_MISMATCH",SourceContainer.Extract(bytes,barcodeGeometryResolver:ResolveBarcode,numberingLabelsResolver:ResolveNumbering,sourceRenderResolver:ResolveSourceRender,cancellationToken:TestContext.Current.CancellationToken).Error);
    }

    [Fact]
    public async Task Empty_paragraph_without_source_ranges_roundtrips_as_empty_text()
    {
        var fixture=await Build("empty-paragraph");
        var extracted=SourceContainer.Extract(fixture.Sealed,barcodeGeometryResolver:ResolveBarcode,numberingLabelsResolver:ResolveNumbering,sourceRenderResolver:ResolveSourceRender,cancellationToken:TestContext.Current.CancellationToken);Assert.True(extracted.Ok,extracted.Error);
        var read=await new OfdReader().ReadAsync(new MemoryStream(fixture.Sealed),TestContext.Current.CancellationToken);
        Assert.All(read.Pages.SelectMany(p=>p.Elements).OfType<Ofdrw.Net.Core.Models.OfdTextElement>(),t=>Assert.Equal("",t.Text));
    }
    [Theory]
    [InlineData("OFD.xml")]
    [InlineData("Doc_0/Document.xml")]
    [InlineData("Doc_0/PublicRes.xml")]
    [InlineData("Doc_0/Pages/Page_0/Content.xml")]
    [InlineData("Doc_0/Attachs/Attachments.xml")]
    public async Task Rejects_wrong_XML_root_in_each_fixed_writer_entry(string path)
    {
        var first=await Initial.Value;
        byte[] Change(byte[] bytes)
        {
            var entries=Zip(bytes);var xml=XDocument.Parse(Encoding.UTF8.GetString(entries[path]));xml.Root!.Name=xml.Root.Name.Namespace+"Font";
            entries[path]=Encoding.UTF8.GetBytes(xml.ToString());return Pack(entries);
        }
        Assert.Equal("PACKAGE_XML",SourceContainer.Extract(Change(first.Sealed),barcodeGeometryResolver:ResolveBarcode,numberingLabelsResolver:ResolveNumbering,sourceRenderResolver:ResolveSourceRender,cancellationToken:TestContext.Current.CancellationToken).Error);
        if(Zip(first.Ofd.Bytes!).ContainsKey(path))Assert.Equal("PACKAGE_XML",SourceContainer.Create(Change(first.Ofd.Bytes!),first.Identity["irDigest"]!.GetValue<string>(),first.Ofd.ObjectMap!,ContainerProfile.NativeEditable,first.Source,barcodeGeometryResolver:ResolveBarcode,numberingLabelsResolver:ResolveNumbering,sourceRenderResolver:ResolveSourceRender,cancellationToken:TestContext.Current.CancellationToken, resourceMap:first.Ofd.ResourceMap).Error);
    }

    [Theory]
    [InlineData("resource-location")]
    [InlineData("page-location")]
    [InlineData("font-location")]
    public async Task Rejects_dangling_internal_XML_references(string mutation)
    {
        var first=await Initial.Value;var entries=Zip(first.Ofd.Bytes!);
        string path=mutation=="font-location"?"Doc_0/PublicRes.xml":"Doc_0/Document.xml";
        var xml=XDocument.Parse(Encoding.UTF8.GetString(entries[path]));
        if(mutation=="resource-location")xml.Descendants().Single(e=>e.Name.LocalName=="PublicRes").Value="Missing.xml";
        if(mutation=="page-location")xml.Descendants().Single(e=>e.Name.LocalName=="Page").SetAttributeValue("BaseLoc","Pages/Page_99/Content.xml");
        if(mutation=="font-location")xml.Descendants().Single(e=>e.Name.LocalName=="FontFile").Value="missing.otf";
        entries[path]=Encoding.UTF8.GetBytes(xml.ToString());
        var result=SourceContainer.Create(Pack(entries),first.Identity["irDigest"]!.GetValue<string>(),first.Ofd.ObjectMap!,ContainerProfile.Distribution,barcodeGeometryResolver:ResolveBarcode,numberingLabelsResolver:ResolveNumbering,sourceRenderResolver:ResolveSourceRender,cancellationToken:TestContext.Current.CancellationToken, resourceMap:first.Ofd.ResourceMap);
        Assert.Equal(mutation=="font-location"?"RESOURCE_MISSING":"PACKAGE_REFERENCE",result.Error);
    }

    [Theory]
    [InlineData("head")]
    [InlineData("tail")]
    public async Task Manifest_IR_digest_is_checked_against_the_hashed_identity_and_DocID(string half)
    {
        var first=await Initial.Value;
        var bytes=Mutate(first.Sealed,(manifest,_)=> {
            string digest=manifest["irDigest"]!.GetValue<string>();int at=half=="head"?0:63;
            manifest["irDigest"]=digest[..at]+(digest[at]=='0'?'1':'0')+digest[(at+1)..];
        });
        Assert.Equal("DIGEST_MISMATCH",SourceContainer.Extract(bytes,barcodeGeometryResolver:ResolveBarcode,numberingLabelsResolver:ResolveNumbering,sourceRenderResolver:ResolveSourceRender,cancellationToken:TestContext.Current.CancellationToken).Error);
        var mismatchedDoc=Mutate(first.Sealed,(manifest,entries)=> {
            var xml=XDocument.Parse(Encoding.UTF8.GetString(entries["OFD.xml"]));xml.Descendants().Single(e=>e.Name.LocalName=="DocID").Value=new string('0',32);
            entries["OFD.xml"]=Encoding.UTF8.GetBytes(xml.ToString());
            var record=manifest["entries"]!.AsArray().Single(e=>e!["path"]!.GetValue<string>()=="OFD.xml")!;record["sha256"]=Hash(entries["OFD.xml"]);record["byteLength"]=entries["OFD.xml"].Length;
        });
        Assert.Equal("DIGEST_MISMATCH",SourceContainer.Extract(mismatchedDoc,barcodeGeometryResolver:ResolveBarcode,numberingLabelsResolver:ResolveNumbering,sourceRenderResolver:ResolveSourceRender,cancellationToken:TestContext.Current.CancellationToken).Error);
    }
    [Theory]
    [InlineData("weight")]
    [InlineData("italic")]
    [InlineData("family")]
    public async Task Recomputed_font_metadata_cannot_change_the_rendered_face(string field)
    {
        var first=await Initial.Value;
        var bytes=Mutate(first.Sealed,(manifest,_)=> {
            var part=manifest["parts"]!.AsArray().Single(p=>p!["name"]!.GetValue<string>()=="resources")!;
            var resources=JsonNode.Parse(part["content"]!.GetValue<string>())!;var font=resources["fonts"]![0]!;
            if(field=="weight")font[field]=700;else if(field=="italic")font[field]=true;else font[field]="unrequested-family";
            string json=resources.ToJsonString();part["content"]=json;part["sha256"]=Hash(Encoding.UTF8.GetBytes(json));
        });
        Assert.Equal("FONT_FACE_MISMATCH",SourceContainer.Extract(bytes,barcodeGeometryResolver:ResolveBarcode,numberingLabelsResolver:ResolveNumbering,sourceRenderResolver:ResolveSourceRender,cancellationToken:TestContext.Current.CancellationToken).Error);
    }
    [Theory]
    [InlineData(ContainerProfile.NativeEditable)]
    [InlineData(ContainerProfile.Distribution)]
    public async Task Orphan_resource_bytes_cannot_carry_hidden_source(ContainerProfile profile)
    {
        var first=await Initial.Value;var entries=Zip(first.Ofd.Bytes!);entries.Add("Doc_0/Res/leak.png",Encoding.UTF8.GetBytes("FULL_SOURCE_SECRET"));
        var result=SourceContainer.Create(Pack(entries),first.Identity["irDigest"]!.GetValue<string>(),first.Ofd.ObjectMap!,profile,profile==ContainerProfile.NativeEditable?first.Source:default,barcodeGeometryResolver:ResolveBarcode,numberingLabelsResolver:ResolveNumbering,sourceRenderResolver:ResolveSourceRender,cancellationToken:TestContext.Current.CancellationToken, resourceMap:first.Ofd.ResourceMap);
        Assert.Equal("RESOURCE_ORPHAN",result.Error);Assert.Null(result.Bytes);
    }

    [Fact]
    public async Task Distribution_rejects_a_resource_declared_in_XML_but_unused_by_pages()
    {
        var first=await Initial.Value;var entries=Zip(first.Ofd.Bytes!);entries.Add("Doc_0/Res/leak.png",Encoding.UTF8.GetBytes("FULL_SOURCE_SECRET"));
        var resource=XDocument.Parse(Encoding.UTF8.GetString(entries["Doc_0/PublicRes.xml"]));var ns=resource.Root!.Name.Namespace;
        resource.Root.Add(new XElement(ns+"MultiMedias",new XElement(ns+"MultiMedia",new XAttribute("ID","777"),new XAttribute("Type","Image"),new XAttribute("Format","PNG"),new XElement(ns+"MediaFile","leak.png"))));
        entries["Doc_0/PublicRes.xml"]=Encoding.UTF8.GetBytes(resource.ToString());
        var doc=XDocument.Parse(Encoding.UTF8.GetString(entries["Doc_0/Document.xml"]));doc.Descendants(ns+"MaxUnitID").Single().Value="777";entries["Doc_0/Document.xml"]=Encoding.UTF8.GetBytes(doc.ToString());
        var result=SourceContainer.Create(Pack(entries),first.Identity["irDigest"]!.GetValue<string>(),first.Ofd.ObjectMap!,ContainerProfile.Distribution,barcodeGeometryResolver:ResolveBarcode,numberingLabelsResolver:ResolveNumbering,sourceRenderResolver:ResolveSourceRender,cancellationToken:TestContext.Current.CancellationToken, resourceMap:first.Ofd.ResourceMap);
        Assert.Equal("RESOURCE_ORPHAN",result.Error);Assert.Null(result.Bytes);
    }
    [Fact]
    public async Task Package_preflight_and_parse_use_the_same_owned_snapshot()
    {
        var first=await Initial.Value;var entries=Zip(first.Sealed);const string path="Doc_0/Attachs/ofd-compose.json";
        var manifest=JsonNode.Parse(entries[path])!;var part=manifest["parts"]!.AsArray().Single(p=>p!["name"]!.GetValue<string>()=="resolvedDocument")!;
        string content=part["content"]!.GetValue<string>().Replace("revision-1","revision-2",StringComparison.Ordinal);part["content"]=content;part["sha256"]=Hash(Encoding.UTF8.GetBytes(content));
        entries[path]=Encoding.UTF8.GetBytes(manifest.ToJsonString());var changed=Pack(entries,level:CompressionLevel.NoCompression);Assert.Equal(first.Sealed.Length,changed.Length);
        changed[14]^=1; // The second version also lies in the local-header CRC; BCL alone ignores it.
        Assert.Equal("PACKAGE_SIZE",SourceContainer.Extract(changed,barcodeGeometryResolver:ResolveBarcode,numberingLabelsResolver:ResolveNumbering,sourceRenderResolver:ResolveSourceRender,cancellationToken:TestContext.Current.CancellationToken).Error);
        using var input=new ChangingMemory(first.Sealed,changed);
        var result=SourceContainer.Extract(input.Input,barcodeGeometryResolver:ResolveBarcode,numberingLabelsResolver:ResolveNumbering,sourceRenderResolver:ResolveSourceRender,cancellationToken:TestContext.Current.CancellationToken);Assert.True(result.Ok,result.Error);
        Assert.Equal("revision-1",JsonNode.Parse(result.SourceJson!)!["resolvedDocument"]!["revisionId"]!.GetValue<string>());
    }

    [Theory]
    [InlineData("OFD.xml")]
    [InlineData("Doc_0/Document.xml")]
    [InlineData("Doc_0/PublicRes.xml")]
    [InlineData("Doc_0/Pages/Page_0/Content.xml")]
    public async Task Root_metadata_cannot_hide_source_on_distribution(string path)
    {
        var first=await Initial.Value;var entries=Zip(first.Ofd.Bytes!);var xml=XDocument.Parse(Encoding.UTF8.GetString(entries[path]));
        xml.Root!.SetAttributeValue("leak","FULL_SOURCE_SECRET");entries[path]=Encoding.UTF8.GetBytes(xml.ToString());
        var result=SourceContainer.Create(Pack(entries),first.Identity["irDigest"]!.GetValue<string>(),first.Ofd.ObjectMap!,ContainerProfile.Distribution,barcodeGeometryResolver:ResolveBarcode,numberingLabelsResolver:ResolveNumbering,sourceRenderResolver:ResolveSourceRender,cancellationToken:TestContext.Current.CancellationToken, resourceMap:first.Ofd.ResourceMap);
        Assert.Equal("UNEXPECTED_METADATA",result.Error);
    }

    [Fact]
    public async Task Native_rejects_a_declared_image_without_a_page_reference()
    {
        var fixture=await Build("two-images");var entries=Zip(fixture.Ofd.Bytes!);var removed=fixture.Ofd.ObjectMap!.Last();
        var page=XDocument.Parse(Encoding.UTF8.GetString(entries["Doc_0/Pages/Page_0/Content.xml"]));page.Descendants().Single(e=>(string?)e.Attribute("ID")==removed.Value[0]).Remove();
        entries["Doc_0/Pages/Page_0/Content.xml"]=Encoding.UTF8.GetBytes(page.ToString());
        var source=JsonNode.Parse(fixture.Source)!;var semantics=source["semanticMap"]!["entries"]!.AsArray();semantics.Remove(semantics.Single(e=>e!["objectId"]!.GetValue<string>()==removed.Key));
        var map=fixture.Ofd.ObjectMap!.Where(p=>p.Key!=removed.Key).ToDictionary(p=>p.Key,p=>p.Value);
        var assets=SourceContainer.Extract(fixture.Sealed,barcodeGeometryResolver:ResolveBarcode,numberingLabelsResolver:ResolveNumbering,sourceRenderResolver:ResolveSourceRender,cancellationToken:TestContext.Current.CancellationToken).Assets!;
        var result=SourceContainer.Create(Pack(entries),fixture.Identity["irDigest"]!.GetValue<string>(),map,ContainerProfile.NativeEditable,Encoding.UTF8.GetBytes(source.ToJsonString()),assets,barcodeGeometryResolver:ResolveBarcode,numberingLabelsResolver:ResolveNumbering,sourceRenderResolver:ResolveSourceRender,cancellationToken:TestContext.Current.CancellationToken,resourceMap:fixture.Ofd.ResourceMap);
        Assert.Equal("RESOURCE_ORPHAN",result.Error);
    }
    [Fact]
    public async Task Font_family_permutation_is_checked_against_each_rendered_text_resource()
    {
        var fixture=await Build("two-fonts");
        var bytes=Mutate(fixture.Sealed,(manifest,_)=> {
            var part=manifest["parts"]!.AsArray().Single(p=>p!["name"]!.GetValue<string>()=="resources")!;
            var resources=JsonNode.Parse(part["content"]!.GetValue<string>())!;var fonts=resources["fonts"]!.AsArray();Assert.Equal(2,fonts.Count);
            string first=fonts[0]!["family"]!.GetValue<string>();fonts[0]!["family"]=fonts[1]!["family"]!.DeepClone();fonts[1]!["family"]=first;
            string json=resources.ToJsonString();part["content"]=json;part["sha256"]=Hash(Encoding.UTF8.GetBytes(json));
        });
        Assert.Equal("FONT_FAMILY_MISMATCH",SourceContainer.Extract(bytes,barcodeGeometryResolver:ResolveBarcode,numberingLabelsResolver:ResolveNumbering,sourceRenderResolver:ResolveSourceRender,cancellationToken:TestContext.Current.CancellationToken).Error);
    }

    [Fact]
    public async Task Physical_resource_map_cannot_permute_distinct_font_resources()
    {
        var fixture=await Build("two-fonts");
        var bytes=Mutate(fixture.Sealed,(manifest,_)=> {
            var map=manifest["resourceMap"]!.AsObject();var keys=map.Select(p=>p.Key).ToArray();Assert.Equal(2,keys.Length);
            string first=map[keys[0]]!.GetValue<string>();map[keys[0]]=map[keys[1]]!.DeepClone();map[keys[1]]=first;
        });
        Assert.Equal("RESOURCE_INCOMPLETE",SourceContainer.Extract(bytes,barcodeGeometryResolver:ResolveBarcode,numberingLabelsResolver:ResolveNumbering,sourceRenderResolver:ResolveSourceRender,cancellationToken:TestContext.Current.CancellationToken).Error);
    }

    [Fact]
    public async Task Additional_unmapped_source_text_is_rejected_after_rehashing()
    {
        var first=await Initial.Value;
        var bytes=Mutate(first.Sealed,(manifest,_)=> {
            var part=manifest["parts"]!.AsArray().Single(p=>p!["name"]!.GetValue<string>()=="resolvedDocument")!;var source=JsonNode.Parse(part["content"]!.GetValue<string>())!;
            source["body"]!.AsArray().Add(JsonNode.Parse("{\"kind\":\"paragraph\",\"nodeId\":\"extra-p\",\"fragments\":[{\"kind\":\"text\",\"text\":\"EXTRA_UNRENDERED_TEXT\",\"origin\":{\"kind\":\"static\",\"nodeId\":\"extra-t\"}}]}"));
            string json=source.ToJsonString();part["content"]=json;part["sha256"]=Hash(Encoding.UTF8.GetBytes(json));
        });
        Assert.Equal("SEMANTIC_INCOMPLETE",SourceContainer.Extract(bytes,barcodeGeometryResolver:ResolveBarcode,numberingLabelsResolver:ResolveNumbering,sourceRenderResolver:ResolveSourceRender,cancellationToken:TestContext.Current.CancellationToken).Error);
    }
    [Fact]
    public async Task Every_image_in_a_source_occurrence_requires_a_rendered_mapping()
    {
        var fixture=await Build("two-images");
        var bytes=Mutate(fixture.Sealed,(manifest,_)=> {
            var part=manifest["parts"]!.AsArray().Single(p=>p!["name"]!.GetValue<string>()=="resolvedDocument")!;
            var source=JsonNode.Parse(part["content"]!.GetValue<string>())!;
            source["body"]![0]!["sources"]!.AsArray().Add(source["body"]![1]!["sources"]![0]!.DeepClone());
            string json=source.ToJsonString();part["content"]=json;part["sha256"]=Hash(Encoding.UTF8.GetBytes(json));
        });
        Assert.Equal("SEMANTIC_INCOMPLETE",SourceContainer.Extract(bytes,barcodeGeometryResolver:ResolveBarcode,numberingLabelsResolver:ResolveNumbering,sourceRenderResolver:ResolveSourceRender,cancellationToken:TestContext.Current.CancellationToken).Error);
    }
    [Fact]
    public async Task Source_text_ranges_cover_whitespace_and_line_breaks()
    {
        var fixture=await Build("whitespace");
        Assert.True(SourceContainer.Extract(fixture.Sealed,barcodeGeometryResolver:ResolveBarcode,numberingLabelsResolver:ResolveNumbering,sourceRenderResolver:ResolveSourceRender,cancellationToken:TestContext.Current.CancellationToken).Ok);
    }
    [Theory]
    [InlineData("suffix")]
    [InlineData("prefix")]
    [InlineData("gap")]
    public async Task Unmapped_text_within_an_existing_source_occurrence_is_rejected(string position)
    {
        var first=await Initial.Value;
        var bytes=Mutate(first.Sealed,(manifest,_)=> {
            const string secret="SECRET_UNRENDERED";
            foreach(var part in manifest["parts"]!.AsArray())
            {
                string name=part!["name"]!.GetValue<string>();
                if(name is not "resolvedDocument" and not "semanticMap")continue;
                var content=JsonNode.Parse(part["content"]!.GetValue<string>())!;
                int insertion=position=="prefix"?0:position=="gap"?7:9;
                if(name=="resolvedDocument")
                {
                    var fragment=content["body"]![0]!["fragments"]![0]!;
                    fragment["text"]=fragment["text"]!.GetValue<string>().Insert(insertion,secret);
                }
                else
                {
                    void Insert(JsonNode text)
                    {
                        text["text"]=text["text"]!.GetValue<string>().Insert(insertion,secret);
                        var range=text["range"]!;int start=range["start"]!.GetValue<int>(),end=range["end"]!.GetValue<int>();
                        if(start>=insertion){range["start"]=start+secret.Length;range["end"]=end+secret.Length;}
                    }
                    foreach(var entry in content["entries"]!.AsArray())
                    {
                        if(entry!["sourceText"] is {} text)Insert(text);
                        foreach(var range in entry["sourceRanges"]!.AsArray())Insert(range!["sourceText"]!);
                    }
                }
                string json=content.ToJsonString();part["content"]=json;part["sha256"]=Hash(Encoding.UTF8.GetBytes(json));
            }
        });
        Assert.Equal("SEMANTIC_INCOMPLETE",SourceContainer.Extract(bytes,barcodeGeometryResolver:ResolveBarcode,numberingLabelsResolver:ResolveNumbering,sourceRenderResolver:ResolveSourceRender,cancellationToken:TestContext.Current.CancellationToken).Error);
    }
    [Theory]
    [InlineData("element")]
    [InlineData("attribute")]
    [InlineData("text")]
    [InlineData("duplicate-scalar")]
    [InlineData("scalar-value")]
    [InlineData("missing-scalar")]
    public async Task XML_metadata_must_obey_the_fixed_writer_context(string mutation)
    {
        var first=await Initial.Value;var entries=Zip(first.Ofd.Bytes!);var xml=XDocument.Parse(Encoding.UTF8.GetString(entries["Doc_0/Document.xml"]));
        if(mutation=="element")xml.Root!.Add(new XElement(xml.Root.Name.Namespace+"Creator","FULL_SOURCE_SECRET"));
        if(mutation=="attribute")xml.Root!.SetAttributeValue("Value","FULL_SOURCE_SECRET");
        if(mutation=="text")xml.Root!.Add(new XText("FULL_SOURCE_SECRET"));
        var box=xml.Descendants().Single(e=>e.Name.LocalName=="PhysicalBox");
        if(mutation=="duplicate-scalar")box.Parent!.Add(new XElement(box.Name,"{\"source\":\"FULL_SOURCE_SECRET\"}"));
        if(mutation=="scalar-value")box.Value="{\"source\":\"FULL_SOURCE_SECRET\"}";
        if(mutation=="missing-scalar")box.Remove();
        entries["Doc_0/Document.xml"]=Encoding.UTF8.GetBytes(xml.ToString());
        var result=SourceContainer.Create(Pack(entries),first.Identity["irDigest"]!.GetValue<string>(),first.Ofd.ObjectMap!,ContainerProfile.Distribution,barcodeGeometryResolver:ResolveBarcode,numberingLabelsResolver:ResolveNumbering,sourceRenderResolver:ResolveSourceRender,cancellationToken:TestContext.Current.CancellationToken,resourceMap:first.Ofd.ResourceMap);
        Assert.Equal("UNEXPECTED_METADATA",result.Error);
    }
    [Theory]
    [InlineData("0")]
    [InlineData("1")]
    public async Task Stale_MaxUnitID_cannot_create_duplicate_attachment_IDs(string maximum)
    {
        var first=await Initial.Value;var entries=Zip(first.Ofd.Bytes!);var xml=XDocument.Parse(Encoding.UTF8.GetString(entries["Doc_0/Document.xml"]));xml.Descendants().Single(e=>e.Name.LocalName=="MaxUnitID").Value=maximum;entries["Doc_0/Document.xml"]=Encoding.UTF8.GetBytes(xml.ToString());
        var result=SourceContainer.Create(Pack(entries),first.Identity["irDigest"]!.GetValue<string>(),first.Ofd.ObjectMap!,ContainerProfile.Distribution,barcodeGeometryResolver:ResolveBarcode,numberingLabelsResolver:ResolveNumbering,sourceRenderResolver:ResolveSourceRender,cancellationToken:TestContext.Current.CancellationToken,resourceMap:first.Ofd.ResourceMap);
        Assert.Equal("RESOURCE_INVALID",result.Error);Assert.Null(result.Bytes);
    }
    [Fact]
    public async Task Watermark_sources_remain_bound_to_their_actual_image_objects()
    {
        var fixture=await Build("watermarks");
        var bytes=Mutate(fixture.Sealed,(manifest,_)=> {
            var part=manifest["parts"]!.AsArray().Single(p=>p!["name"]!.GetValue<string>()=="resources")!;var resources=JsonNode.Parse(part["content"]!.GetValue<string>())!;var images=resources["images"]!.AsArray();Assert.Equal(2,images.Count);
            foreach(string key in new[]{"sha256","byteLength"}){var first=images[0]![key]!.DeepClone();images[0]![key]=images[1]![key]!.DeepClone();images[1]![key]=first;}
            string json=resources.ToJsonString();part["content"]=json;part["sha256"]=Hash(Encoding.UTF8.GetBytes(json));
        });
        Assert.Equal("RESOURCE_IMAGE_MISMATCH",SourceContainer.Extract(bytes,barcodeGeometryResolver:ResolveBarcode,numberingLabelsResolver:ResolveNumbering,sourceRenderResolver:ResolveSourceRender,cancellationToken:TestContext.Current.CancellationToken).Error);
    }

    [Theory]
    [InlineData("text")]
    [InlineData("remove-witness")]
    [InlineData("header")]
    public async Task Page_text_decorations_are_bound_to_actual_text(string mutation)
    {
        var fixture=await Build("text-watermarks");
        var bytes=Mutate(fixture.Sealed,(manifest,_)=> {
            string name=mutation=="remove-witness"?"semanticMap":"resolvedDocument";
            var part=manifest["parts"]!.AsArray().Single(p=>p!["name"]!.GetValue<string>()==name)!;
            var source=JsonNode.Parse(part["content"]!.GetValue<string>())!;
            if(mutation=="remove-witness")source["pageDecorations"]=new JsonArray();
            else if(mutation=="header")source["settings"]!["page"]!["header"]!["parts"]![0]!["text"]="FORGED_HEADER";
            else source["settings"]!["page"]!["watermarks"]![0]!["text"]="FORGED_WATERMARK";
            string json=source.ToJsonString();part["content"]=json;part["sha256"]=Hash(Encoding.UTF8.GetBytes(json));
        });
        Assert.Equal(mutation=="remove-witness"?"SEMANTIC_INCOMPLETE":"SEMANTIC_SOURCE",SourceContainer.Extract(bytes,barcodeGeometryResolver:ResolveBarcode,numberingLabelsResolver:ResolveNumbering,sourceRenderResolver:ResolveSourceRender,cancellationToken:TestContext.Current.CancellationToken).Error);
    }
    [Theory]
    [InlineData("path")]
    [InlineData("fill")]
    [InlineData("barcode-value")]
    [InlineData("barcode-width")]
    public async Task Nontext_source_payloads_require_the_actual_rendered_shape(string mutation)
    {
        var fixture=await Build(mutation.StartsWith("barcode",StringComparison.Ordinal)?"combined":"path");
        var bytes=Mutate(fixture.Sealed,(manifest,_)=> {
            var part=manifest["parts"]!.AsArray().Single(p=>p!["name"]!.GetValue<string>()=="resolvedDocument")!;
            var source=JsonNode.Parse(part["content"]!.GetValue<string>())!;
            void Walk(JsonNode? node)
            {
                if(node is JsonArray a){foreach(var child in a)Walk(child);return;}
                if(node is not JsonObject obj)return;
                if(obj["kind"]?.GetValue<string>()=="path") {if(mutation=="path")obj["commands"]![0]!["x"]=2;else obj["fill"]="#445566";return;}
                if(obj["kind"]?.GetValue<string>()=="barcode-binding") {if(mutation=="barcode-value"&&obj["options"]!["symbology"]!.GetValue<string>()=="code128")obj["value"]="DIFFERENT_VALID_128";if(mutation=="barcode-width")obj["options"]!["width"]=70;return;}
                foreach(var pair in obj)Walk(pair.Value);
            }
            Walk(source["body"]);
            string json=source.ToJsonString();part["content"]=json;part["sha256"]=Hash(Encoding.UTF8.GetBytes(json));
        });
        Assert.Equal("SEMANTIC_SOURCE",SourceContainer.Extract(bytes,barcodeGeometryResolver:ResolveBarcode,numberingLabelsResolver:ResolveNumbering,sourceRenderResolver:ResolveSourceRender,cancellationToken:TestContext.Current.CancellationToken).Error);
    }
    [Fact]
    public async Task Barcode_verification_is_an_explicit_host_capability_and_fails_closed()
    {
        var fixture=await Build("combined");
        Assert.Equal("BARCODE_VERIFIER_REQUIRED",SourceContainer.Extract(fixture.Sealed,numberingLabelsResolver:ResolveNumbering,sourceRenderResolver:ResolveSourceRender,cancellationToken:TestContext.Current.CancellationToken).Error);
        Assert.Equal("BARCODE_VERIFICATION_FAILED",SourceContainer.Extract(fixture.Sealed,barcodeGeometryResolver:(_,_)=>ReadOnlyMemory<byte>.Empty,numberingLabelsResolver:ResolveNumbering,sourceRenderResolver:ResolveSourceRender,cancellationToken:TestContext.Current.CancellationToken).Error);
        Assert.Equal("SEMANTIC_SOURCE",SourceContainer.Extract(fixture.Sealed,barcodeGeometryResolver:(_,_)=>"[]"u8.ToArray(),numberingLabelsResolver:ResolveNumbering,sourceRenderResolver:ResolveSourceRender,cancellationToken:TestContext.Current.CancellationToken).Error);
    }
    [Fact]
    public async Task Data_paths_are_removed_and_cannot_be_reintroduced_by_rehashing()
    {
        var fixture=await Initial.Value;Assert.DoesNotContain("dataPath",Encoding.UTF8.GetString(fixture.Source));
        var bytes=Mutate(fixture.Sealed,(manifest,_)=> {
            var part=manifest["parts"]!.AsArray().Single(p=>p!["name"]!.GetValue<string>()=="resolvedDocument")!;var source=JsonNode.Parse(part["content"]!.GetValue<string>())!;
            source["body"]![0]!["fragments"]![0]!["origin"]!["dataPath"]="SECRET_BUSINESS_SCHEMA";
            string json=source.ToJsonString();part["content"]=json;part["sha256"]=Hash(Encoding.UTF8.GetBytes(json));
        });
        Assert.Equal("SOURCE_NOT_MINIMAL",SourceContainer.Extract(bytes,numberingLabelsResolver:ResolveNumbering,sourceRenderResolver:ResolveSourceRender,cancellationToken:TestContext.Current.CancellationToken).Error);
    }
    [Fact]
    public async Task Numerically_duplicate_ID_spellings_are_rejected()
    {
        var fixture=await Initial.Value;var entries=Zip(fixture.Ofd.Bytes!);var xml=XDocument.Parse(Encoding.UTF8.GetString(entries["Doc_0/Document.xml"]));
        xml.Descendants().Single(e=>e.Name.LocalName=="Page").SetAttributeValue("ID","01");entries["Doc_0/Document.xml"]=Encoding.UTF8.GetBytes(xml.ToString());
        var result=SourceContainer.Create(Pack(entries),fixture.Identity["irDigest"]!.GetValue<string>(),fixture.Ofd.ObjectMap!,ContainerProfile.Distribution,numberingLabelsResolver:ResolveNumbering,sourceRenderResolver:ResolveSourceRender,cancellationToken:TestContext.Current.CancellationToken);
        Assert.Equal("PACKAGE_REFERENCE",result.Error);Assert.Null(result.Bytes);
    }

    [Fact]
    public async Task Numbering_origins_preserve_continuation_restart_and_repeat_source()
    {
        var fixture=await Build("list");var extracted=SourceContainer.Extract(fixture.Sealed,numberingLabelsResolver:ResolveNumbering,sourceRenderResolver:ResolveSourceRender,cancellationToken:TestContext.Current.CancellationToken);Assert.True(extracted.Ok,extracted.Error);
        var reader=await new OfdReader().ReadAsync(new MemoryStream(fixture.Sealed),TestContext.Current.CancellationToken);
        string text=string.Concat(reader.Pages.SelectMany(p=>p.Elements).OfType<Ofdrw.Net.Core.Models.OfdTextElement>().Select(t=>t.Text));
        Assert.Contains("1. ",text);Assert.Contains("AA",text);Assert.Contains("5. ",text);Assert.Contains("6. ",text);
        var bytes=Mutate(fixture.Sealed,(manifest,_)=> {
            var part=manifest["parts"]!.AsArray().Single(p=>p!["name"]!.GetValue<string>()=="resolvedDocument")!;var source=JsonNode.Parse(part["content"]!.GetValue<string>())!;
            source["body"]![0]!["layout"]!["numbering"]!["suffix"]="SECRET_SUFFIX";string json=source.ToJsonString();part["content"]=json;part["sha256"]=Hash(Encoding.UTF8.GetBytes(json));
        });
        Assert.Equal("SEMANTIC_SOURCE",SourceContainer.Extract(bytes,numberingLabelsResolver:ResolveNumbering,sourceRenderResolver:ResolveSourceRender,cancellationToken:TestContext.Current.CancellationToken).Error);
    }

    [Fact]
    public async Task Adding_unrendered_numbering_to_a_mapped_paragraph_is_rejected()
    {
        var fixture=await Initial.Value;
        var bytes=Mutate(fixture.Sealed,(manifest,_)=> {
            var part=manifest["parts"]!.AsArray().Single(p=>p!["name"]!.GetValue<string>()=="resolvedDocument")!;var source=JsonNode.Parse(part["content"]!.GetValue<string>())!;
            source["body"]![0]!["layout"]=JsonNode.Parse("{\"numbering\":{\"listId\":\"forged\",\"format\":\"decimal\"}}");string json=source.ToJsonString();part["content"]=json;part["sha256"]=Hash(Encoding.UTF8.GetBytes(json));
        });
        Assert.Equal("SEMANTIC_INCOMPLETE",SourceContainer.Extract(bytes,numberingLabelsResolver:ResolveNumbering,sourceRenderResolver:ResolveSourceRender,cancellationToken:TestContext.Current.CancellationToken).Error);
    }

    [Theory]
    [InlineData("paragraph-bold")]
    [InlineData("fragment-bold")]
    [InlineData("paragraph-italic")]
    public async Task Effective_source_style_must_match_the_physical_font_face(string mutation)
    {
        var fixture=await Build(mutation=="paragraph-italic"?"two-italic-faces":"two-faces");
        var bytes=Mutate(fixture.Sealed,(manifest,_)=> {
            var part=manifest["parts"]!.AsArray().Single(p=>p!["name"]!.GetValue<string>()=="resolvedDocument")!;var source=JsonNode.Parse(part["content"]!.GetValue<string>())!;
            if(mutation=="fragment-bold")source["body"]![0]!["fragments"]![0]!["styleId"]="second";
            else source["styles"]!["regular"]![mutation=="paragraph-italic"?"italic":"bold"]=true;
            string json=source.ToJsonString();part["content"]=json;part["sha256"]=Hash(Encoding.UTF8.GetBytes(json));
        });
        Assert.Equal("FONT_FAMILY_MISMATCH",SourceContainer.Extract(bytes,sourceRenderResolver:ResolveSourceRender,cancellationToken:TestContext.Current.CancellationToken).Error);
    }
    [Fact]
    public async Task Numbering_rules_require_the_explicit_authoritative_host_resolver()
    {
        var fixture=await Build("list");
        Assert.Equal("NUMBERING_VERIFIER_REQUIRED",SourceContainer.Extract(fixture.Sealed,sourceRenderResolver:ResolveSourceRender,cancellationToken:TestContext.Current.CancellationToken).Error);
        Assert.Equal("NUMBERING_VERIFICATION_FAILED",SourceContainer.Extract(fixture.Sealed,numberingLabelsResolver:(_,_)=>ReadOnlyMemory<byte>.Empty,sourceRenderResolver:ResolveSourceRender,cancellationToken:TestContext.Current.CancellationToken).Error);
        Assert.Equal("NUMBERING_VERIFICATION_FAILED",SourceContainer.Extract(fixture.Sealed,numberingLabelsResolver:(_,_)=>"[]"u8.ToArray(),sourceRenderResolver:ResolveSourceRender,cancellationToken:TestContext.Current.CancellationToken).Error);
    }

    [Fact]
    public async Task Numbering_request_budget_is_reserved_before_calling_the_host()
    {
        var fixture=await Build("list");bool called=false;
        var result=SourceContainer.Extract(fixture.Sealed,limits:new(){WorkBytes=64*1024*1024},numberingLabelsResolver:(request,token)=>{called=true;return ResolveNumbering(request,token);},sourceRenderResolver:ResolveSourceRender,cancellationToken:TestContext.Current.CancellationToken);
        Assert.Equal("SIZE_LIMIT",result.Error);Assert.False(called);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task Source_traversal_order_cannot_diverge_from_semantic_and_physical_order(bool rewriteSemantics)
    {
        var fixture=await Build("two-fonts");
        var bytes=Mutate(fixture.Sealed,(manifest,_)=> {
            foreach(var part in manifest["parts"]!.AsArray())
            {
                string name=part!["name"]!.GetValue<string>();
                if(name!="resolvedDocument"&&!(rewriteSemantics&&name=="semanticMap"))continue;
                var content=JsonNode.Parse(part["content"]!.GetValue<string>())!;
                if(name=="resolvedDocument")
                {
                    var body=content["body"]!.AsArray();var first=body[0]!.DeepClone();body[0]=body[1]!.DeepClone();body[1]=first;
                }
                else
                {
                    var entries=content["entries"]!.AsArray().Select(e=>e!.DeepClone()).Reverse().ToArray();
                    for(int i=0;i<entries.Length;i++)entries[i]["readingOrder"]=i;
                    content["entries"]=new JsonArray(entries);
                }
                string json=content.ToJsonString();part["content"]=json;part["sha256"]=Hash(Encoding.UTF8.GetBytes(json));
            }
        });
        Assert.Equal("SEMANTIC_ORDER",SourceContainer.Extract(bytes,sourceRenderResolver:ResolveSourceRender,cancellationToken:TestContext.Current.CancellationToken).Error);
    }

    [Theory]
    [InlineData("image")]
    [InlineData("path")]
    [InlineData("barcode")]
    [InlineData("text")]
    public async Task Source_occurrences_cannot_gain_duplicate_physical_objects(string kind)
    {
        var fixture=await Build(kind=="image"?"two-images":kind=="path"?"path":kind=="text"?"initial":"combined");
        var bytes=Mutate(fixture.Sealed,(manifest,entries)=> {
            var part=manifest["parts"]!.AsArray().Single(p=>p!["name"]!.GetValue<string>()=="semanticMap")!;var semantic=JsonNode.Parse(part["content"]!.GetValue<string>())!;
            var original=semantic["entries"]!.AsArray().First(e=>e!["nodeId"]!.GetValue<string>()==(kind=="image"?"image":kind=="path"?"path":kind=="text"?"t":"code128"))!;
            string target=manifest["objectMap"]![original["objectId"]!.GetValue<string>()]![0]!.GetValue<string>();
            var doc=XDocument.Parse(Encoding.UTF8.GetString(entries["Doc_0/Document.xml"]));var maximum=doc.Descendants().Single(e=>e.Name.LocalName=="MaxUnitID");int next=int.Parse(maximum.Value,System.Globalization.CultureInfo.InvariantCulture);maximum.Value=(next+1).ToString(System.Globalization.CultureInfo.InvariantCulture);
            var pages=entries.Where(e=>e.Key.StartsWith("Doc_0/Pages/",StringComparison.Ordinal)).OrderBy(e=>int.Parse(e.Key.Split('/')[2][5..],System.Globalization.CultureInfo.InvariantCulture)).ToArray();
            XElement? copied=null;foreach(var p in pages){var xml=XDocument.Parse(Encoding.UTF8.GetString(p.Value));var found=xml.Descendants().FirstOrDefault(e=>(string?)e.Attribute("ID")==target);if(found is not null)copied=new XElement(found);}
            Assert.NotNull(copied);copied.SetAttributeValue("ID",next);var page=XDocument.Parse(Encoding.UTF8.GetString(pages[^1].Value));page.Descendants().Single(e=>e.Name.LocalName=="Layer").Add(copied);entries[pages[^1].Key]=Encoding.UTF8.GetBytes(page.ToString());
            entries["Doc_0/Document.xml"]=Encoding.UTF8.GetBytes(doc.ToString());
            var attachments=XDocument.Parse(Encoding.UTF8.GetString(entries["Doc_0/Attachs/Attachments.xml"]));attachments.Descendants().Single(e=>e.Name.LocalName=="Attachment").SetAttributeValue("ID",next+1);entries["Doc_0/Attachs/Attachments.xml"]=Encoding.UTF8.GetBytes(attachments.ToString());
            var duplicate=original.DeepClone();duplicate["objectId"]="duplicate-atomic";duplicate["readingOrder"]=semantic["entries"]!.AsArray().Count;duplicate["pageIndex"]=pages.Length-1;semantic["entries"]!.AsArray().Add(duplicate);manifest["objectMap"]!["duplicate-atomic"]=new JsonArray(next.ToString(System.Globalization.CultureInfo.InvariantCulture));
            string json=semantic.ToJsonString();part["content"]=json;part["sha256"]=Hash(Encoding.UTF8.GetBytes(json));
            foreach(var entry in manifest["entries"]!.AsArray()){byte[] value=entries[entry!["path"]!.GetValue<string>()];entry["sha256"]=Hash(value);entry["byteLength"]=value.Length;}
        });
        Assert.Equal("SEMANTIC_CARDINALITY",SourceContainer.Extract(bytes,barcodeGeometryResolver:ResolveBarcode,sourceRenderResolver:ResolveSourceRender,cancellationToken:TestContext.Current.CancellationToken).Error);
    }
    [Fact]
    public async Task Repeated_header_atomic_nodes_have_one_instance_per_table_body_page()
    {
        var fixture=await Build("header-atomics");
        Assert.True(SourceContainer.Extract(fixture.Sealed,barcodeGeometryResolver:ResolveBarcode,sourceRenderResolver:ResolveSourceRender,cancellationToken:TestContext.Current.CancellationToken).Ok);
        var source=JsonNode.Parse(fixture.Source)!;Assert.True(source["semanticMap"]!["entries"]!.AsArray().Count(e=>e!["nodeId"]!.GetValue<string>()=="header-image")>1);
    }
    [Fact]
    public async Task Section_page_numbers_are_derived_from_source_sections_and_physical_pages()
    {
        var fixture=await Build("section-pages");
        Assert.True(SourceContainer.Extract(fixture.Sealed,sourceRenderResolver:ResolveSourceRender,cancellationToken:TestContext.Current.CancellationToken).Ok);
        var bytes=Mutate(fixture.Sealed,(manifest,_)=> {
            foreach(var part in manifest["parts"]!.AsArray())
            {
                string name=part!["name"]!.GetValue<string>();if(name is not "resolvedDocument" and not "semanticMap")continue;
                var source=JsonNode.Parse(part["content"]!.GetValue<string>())!;
                if(name=="resolvedDocument")source["settings"]!["page"]!["startPageNumber"]=2;
                else foreach(var witness in source["pageDecorations"]!.AsArray().Where(w=>w!["pointer"]!.GetValue<string>()=="/settings/page/header"))witness!["sectionPage"]=1;
                string json=source.ToJsonString();part["content"]=json;part["sha256"]=Hash(Encoding.UTF8.GetBytes(json));
            }
        });
        Assert.Equal("SEMANTIC_SOURCE",SourceContainer.Extract(bytes,sourceRenderResolver:ResolveSourceRender,cancellationToken:TestContext.Current.CancellationToken).Error);
    }

    [Fact]
    public async Task An_empty_control_between_text_fragments_preserves_its_single_anchor()
    {
        var fixture=await Build("empty-control");
        Assert.True(SourceContainer.Extract(fixture.Sealed,sourceRenderResolver:ResolveSourceRender,cancellationToken:TestContext.Current.CancellationToken).Ok);
    }

    [Fact]
    public async Task Repeat_business_keys_are_opaque_in_source_semantics_and_generated_sections()
    {
        var fixture=await Build("private-repeat");string source=Encoding.UTF8.GetString(fixture.Source);
        Assert.DoesNotContain("PRIVATE_ACCOUNT",source);Assert.DoesNotContain("PRIVATE_CHILD",source);Assert.Contains("instance-",source);Assert.Contains("@editing-section:",source);
        var extracted=SourceContainer.Extract(fixture.Sealed,sourceRenderResolver:ResolveSourceRender,cancellationToken:TestContext.Current.CancellationToken);Assert.True(extracted.Ok,extracted.Error);
        var reader=await new OfdReader().ReadAsync(new MemoryStream(fixture.Sealed),TestContext.Current.CancellationToken);
        string visible=string.Concat(reader.Pages.SelectMany(p=>p.Elements).OfType<Ofdrw.Net.Core.Models.OfdTextElement>().Select(t=>t.Text));Assert.Contains("Public A",visible);Assert.Contains("Public B",visible);Assert.Contains("visible child",visible);
        var bytes=Mutate(fixture.Sealed,(manifest,_)=> {
            foreach(var part in manifest["parts"]!.AsArray())
            {
                string name=part!["name"]!.GetValue<string>();if(name is not "resolvedDocument" and not "semanticMap")continue;
                var content=JsonNode.Parse(part["content"]!.GetValue<string>())!;
                if(name=="resolvedDocument")content["body"]![0]!["instancePath"]![0]!["key"]="PRIVATE_ACCOUNT_REINTRODUCED";
                else content["entries"]![0]!["repeatInstance"]![0]!["key"]="PRIVATE_ACCOUNT_REINTRODUCED";
                string json=content.ToJsonString();part["content"]=json;part["sha256"]=Hash(Encoding.UTF8.GetBytes(json));
            }
        });
        Assert.Equal("SOURCE_NOT_MINIMAL",SourceContainer.Extract(bytes,sourceRenderResolver:ResolveSourceRender,cancellationToken:TestContext.Current.CancellationToken).Error);
    }
    [Theory]
    [InlineData("missing")]
    [InlineData("null")]
    public async Task Binding_evaluation_state_cannot_be_reintroduced(string state)
    {
        var fixture=await Initial.Value;
        var bytes=Mutate(fixture.Sealed,(manifest,_)=> {
            var part=manifest["parts"]!.AsArray().Single(p=>p!["name"]!.GetValue<string>()=="resolvedDocument")!;var source=JsonNode.Parse(part["content"]!.GetValue<string>())!;
            source["body"]![0]!["fragments"]![0]!["origin"]!["valueState"]=state;string json=source.ToJsonString();part["content"]=json;part["sha256"]=Hash(Encoding.UTF8.GetBytes(json));
        });
        Assert.Equal("SOURCE_NOT_MINIMAL",SourceContainer.Extract(bytes,sourceRenderResolver:ResolveSourceRender,cancellationToken:TestContext.Current.CancellationToken).Error);
    }

    [Theory]
    [InlineData("/settings/page/watermarks/0")]
    [InlineData("/settings/page/header")]
    public async Task Removing_a_physical_page_decoration_and_all_its_maps_is_rejected(string pointer)
    {
        var fixture=await Build("text-watermarks");
        var bytes=Mutate(fixture.Sealed,(manifest,entries)=> {
            var part=manifest["parts"]!.AsArray().Single(p=>p!["name"]!.GetValue<string>()=="semanticMap")!;var map=JsonNode.Parse(part["content"]!.GetValue<string>())!;
            var witnesses=map["pageDecorations"]!.AsArray();var removed=witnesses.Where(w=>w!["pointer"]!.GetValue<string>()==pointer).ToArray();Assert.NotEmpty(removed);
            var physical=new HashSet<string>();
            foreach(var witness in removed)
            {
                string id=witness!["objectId"]!.GetValue<string>();foreach(var target in manifest["objectMap"]![id]!.AsArray())physical.Add(target!.GetValue<string>());
                manifest["objectMap"]!.AsObject().Remove(id);var decorations=map["decorations"]!.AsArray();decorations.Remove(decorations.Single(d=>d!.GetValue<string>()==id));witnesses.Remove(witness);
            }
            foreach(string path in entries.Keys.Where(p=>p.StartsWith("Doc_0/Pages/",StringComparison.Ordinal)).ToArray())
            {var xml=XDocument.Parse(Encoding.UTF8.GetString(entries[path]));xml.Descendants().Where(e=>physical.Contains((string?)e.Attribute("ID")??"")).Remove();entries[path]=Encoding.UTF8.GetBytes(xml.ToString());}
            string json=map.ToJsonString();part["content"]=json;part["sha256"]=Hash(Encoding.UTF8.GetBytes(json));
            foreach(var entry in manifest["entries"]!.AsArray()){byte[] value=entries[entry!["path"]!.GetValue<string>()];entry["sha256"]=Hash(value);entry["byteLength"]=value.Length;}
        });
        Assert.Equal("SEMANTIC_INCOMPLETE",SourceContainer.Extract(bytes,sourceRenderResolver:ResolveSourceRender,cancellationToken:TestContext.Current.CancellationToken).Error);
    }
    [Fact]
    public async Task Empty_and_hidden_page_bands_do_not_require_output_witnesses()
    {
        var fixture=await Build("empty-bands");Assert.True(SourceContainer.Extract(fixture.Sealed,sourceRenderResolver:ResolveSourceRender,cancellationToken:TestContext.Current.CancellationToken).Ok);
    }
    [Theory]
    [InlineData("style")]
    [InlineData("semantic")]
    [InlineData("profile")]
    public async Task Unprinted_link_targets_are_removed_and_cannot_be_reintroduced(string location)
    {
        var fixture=await Build("links");Assert.DoesNotContain("LINK_SECRET",Encoding.UTF8.GetString(fixture.Source));Assert.DoesNotContain("\"link\"",Encoding.UTF8.GetString(fixture.Source));
        var bytes=Mutate(fixture.Sealed,(manifest,_)=> {
            string name=location=="semantic"?"semanticMap":location=="profile"?"renderProfile":"resolvedDocument";
            var part=manifest["parts"]!.AsArray().Single(p=>p!["name"]!.GetValue<string>()==name)!;var content=JsonNode.Parse(part["content"]!.GetValue<string>())!;
            if(location=="semantic")content["entries"]![0]!["link"]="https://example.invalid/?token=LINK_SECRET";
            else if(location=="profile")content["layout"]!["defaultStyle"]!["link"]="https://example.invalid/?token=LINK_SECRET";
            else content["styles"]!.AsObject().First().Value!["link"]="https://example.invalid/?token=LINK_SECRET";
            string json=content.ToJsonString();part["content"]=json;part["sha256"]=Hash(Encoding.UTF8.GetBytes(json));
        });
        Assert.Equal("SOURCE_NOT_MINIMAL",SourceContainer.Extract(bytes,sourceRenderResolver:ResolveSourceRender,cancellationToken:TestContext.Current.CancellationToken).Error);
    }

    [Fact]
    public async Task Unused_table_and_cell_link_targets_are_not_retained_in_referenced_styles()
    {
        var fixture=await Build("table-links");Assert.DoesNotContain("LINK_SECRET",Encoding.UTF8.GetString(fixture.Source));Assert.DoesNotContain("\"link\"",Encoding.UTF8.GetString(fixture.Source));
        Assert.True(SourceContainer.Extract(fixture.Sealed,sourceRenderResolver:ResolveSourceRender,cancellationToken:TestContext.Current.CancellationToken).Ok);
    }

    [Theory]
    [InlineData("page-inset")]
    [InlineData("page-width")]
    [InlineData("page-color")]
    [InlineData("paragraph-border")]
    [InlineData("cell-background")]
    [InlineData("cell-border")]
    [InlineData("highlight")]
    [InlineData("underline")]
    public async Task Generated_path_payloads_are_recomputed_from_the_actual_source(string mutation)
    {
        var fixture=await Build("decorated-paths");
        var bytes=Mutate(fixture.Sealed,(manifest,_)=> {
            var part=manifest["parts"]!.AsArray().Single(p=>p!["name"]!.GetValue<string>()=="resolvedDocument")!;var source=JsonNode.Parse(part["content"]!.GetValue<string>())!;
            switch(mutation)
            {
                case "page-inset":source["settings"]!["page"]!["border"]!["inset"]=7;break;
                case "page-width":source["settings"]!["page"]!["border"]!["width"]=0.8;break;
                case "page-color":source["settings"]!["page"]!["border"]!["color"]="#223344";break;
                case "paragraph-border":source["body"]![0]!["layout"]!["border"]!["width"]=0.7;break;
                case "cell-background":source["body"]![1]!["rows"]![0]!["cells"]![0]!["layout"]!["background"]="#D0D0D0";break;
                case "cell-border":source["body"]![1]!["rows"]![0]!["cells"]![0]!["border"]!["color"]="#008800";break;
                case "highlight":source["styles"]!["paint"]!["highlight"]="#00FFFF";break;
                case "underline":source["styles"]!["paint"]!["underline"]=false;break;
            }
            string json=source.ToJsonString();part["content"]=json;part["sha256"]=Hash(Encoding.UTF8.GetBytes(json));
        });
        Assert.Equal("GENERATED_PATH_MISMATCH",SourceContainer.Extract(bytes,sourceRenderResolver:ResolveSourceRender,cancellationToken:TestContext.Current.CancellationToken).Error);
    }
    [Fact]
    public async Task Generated_paths_require_explicit_recomputation_and_cannot_be_omitted()
    {
        var fixture=await Build("page-border");
        Assert.Equal("SOURCE_RENDER_VERIFIER_REQUIRED",SourceContainer.Extract(fixture.Sealed,cancellationToken:TestContext.Current.CancellationToken).Error);
        Assert.Equal("SOURCE_RENDER_VERIFICATION_FAILED",SourceContainer.Extract(fixture.Sealed,sourceRenderResolver:(_,_)=>null,cancellationToken:TestContext.Current.CancellationToken).Error);
        var bytes=Mutate(fixture.Sealed,(manifest,entries)=> {
            var part=manifest["parts"]!.AsArray().Single(p=>p!["name"]!.GetValue<string>()=="semanticMap")!;var map=JsonNode.Parse(part["content"]!.GetValue<string>())!;string id=map["decorations"]![0]!.GetValue<string>(),physical=manifest["objectMap"]![id]![0]!.GetValue<string>();
            map["decorations"]!.AsArray().RemoveAt(0);manifest["objectMap"]!.AsObject().Remove(id);
            foreach(string path in entries.Keys.Where(p=>p.StartsWith("Doc_0/Pages/",StringComparison.Ordinal)).ToArray()){var xml=XDocument.Parse(Encoding.UTF8.GetString(entries[path]));xml.Descendants().Where(e=>(string?)e.Attribute("ID")==physical).Remove();entries[path]=Encoding.UTF8.GetBytes(xml.ToString());}
            string json=map.ToJsonString();part["content"]=json;part["sha256"]=Hash(Encoding.UTF8.GetBytes(json));
            foreach(var entry in manifest["entries"]!.AsArray()){byte[] value=entries[entry!["path"]!.GetValue<string>()];entry["sha256"]=Hash(value);entry["byteLength"]=value.Length;}
        });
        Assert.Equal("GENERATED_PATH_MISMATCH",SourceContainer.Extract(bytes,sourceRenderResolver:ResolveSourceRender,cancellationToken:TestContext.Current.CancellationToken).Error);
    }
    [Fact]
    public async Task Generated_paths_cannot_be_disguised_as_paragraph_semantics()
    {
        var fixture=await Build("page-border");
        var bytes=Mutate(fixture.Sealed,(manifest,_)=> {
            foreach(var part in manifest["parts"]!.AsArray())
            {
                string name=part!["name"]!.GetValue<string>();if(name is not "resolvedDocument" and not "semanticMap")continue;var source=JsonNode.Parse(part["content"]!.GetValue<string>())!;
                if(name=="resolvedDocument")source["settings"]!["page"]!.AsObject().Remove("border");
                else {string id=source["decorations"]![0]!.GetValue<string>();source["decorations"]!.AsArray().RemoveAt(0);source["entries"]!.AsArray().Add(new JsonObject { ["objectId"]=id,["nodeId"]="p",["pageIndex"]=0,["readingOrder"]=source["entries"]!.AsArray().Count });}
                string json=source.ToJsonString();part["content"]=json;part["sha256"]=Hash(Encoding.UTF8.GetBytes(json));
            }
        });
        Assert.Equal("SEMANTIC_SOURCE",SourceContainer.Extract(bytes,cancellationToken:TestContext.Current.CancellationToken).Error);
    }

    [Theory]
    [InlineData("options")]
    [InlineData("required")]
    [InlineData("placeholder")]
    public async Task Unrendered_control_metadata_is_not_retained_or_reintroduced(string field)
    {
        var fixture=await Build("control-metadata");string text=Encoding.UTF8.GetString(fixture.Source);Assert.DoesNotContain("HIDDEN_",text);Assert.Contains("visible fallback",text);
        var bytes=Mutate(fixture.Sealed,(manifest,_)=> {
            var part=manifest["parts"]!.AsArray().Single(p=>p!["name"]!.GetValue<string>()=="resolvedDocument")!;var source=JsonNode.Parse(part["content"]!.GetValue<string>())!;var control=source["body"]![0]!["fragments"]![0]!;
            if(field=="options")control[field]=new JsonArray("HIDDEN_OPTION");else if(field=="required")control[field]=true;else control[field]="HIDDEN_PLACEHOLDER";
            string json=source.ToJsonString();part["content"]=json;part["sha256"]=Hash(Encoding.UTF8.GetBytes(json));
        });
        Assert.Equal("SOURCE_NOT_MINIMAL",SourceContainer.Extract(bytes,cancellationToken:TestContext.Current.CancellationToken).Error);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task Complete_IR_identity_is_anchored_in_OFD_metadata(bool distribution)
    {
        var fixture=await Initial.Value;
        byte[] original=distribution?SourceContainer.Create(fixture.Ofd.Bytes!,fixture.Identity["irDigest"]!.GetValue<string>(),fixture.Ofd.ObjectMap!,ContainerProfile.Distribution,cancellationToken:TestContext.Current.CancellationToken).Bytes!:fixture.Sealed;
        var root=XDocument.Parse(Encoding.UTF8.GetString(Zip(original)["OFD.xml"]));
        Assert.Equal("ofd-compose:ir-sha256:"+fixture.Identity["irDigest"]!.GetValue<string>(),root.Descendants().Single(e=>e.Name.LocalName=="Keywords").Value);
        var bytes=Mutate(original,(manifest,_)=> {
            string digest=manifest["irDigest"]!.GetValue<string>();string replacement=digest[..32]+new string(digest[32]=='0'?'1':'0',32);manifest["irDigest"]=replacement;
            var part=manifest["parts"]!.AsArray().Single(p=>p!["name"]!.GetValue<string>()=="irDigest")!;string content=JsonSerializer.Serialize(replacement);part["content"]=content;part["sha256"]=Hash(Encoding.UTF8.GetBytes(content));
        });
        Assert.Equal("DIGEST_MISMATCH",SourceContainer.Extract(bytes,cancellationToken:TestContext.Current.CancellationToken).Error);
    }
    [Theory]
    [InlineData("row")]
    [InlineData("column")]
    [InlineData("rowSpan")]
    [InlineData("columnSpan")]
    [InlineData("tableId")]
    [InlineData("remove")]
    [InlineData("repeatedHeader")]
    public async Task Table_relationships_match_authoritative_source_layout(string mutation)
    {
        var fixture=await Build("header-atomics");
        var bytes=Mutate(fixture.Sealed,(manifest,_)=> {
            var part=manifest["parts"]!.AsArray().Single(p=>p!["name"]!.GetValue<string>()=="semanticMap")!;var map=JsonNode.Parse(part["content"]!.GetValue<string>())!;
            var entry=map["entries"]!.AsArray().First(e=>e![mutation=="repeatedHeader"?"repeatedHeader":"table"] is not null)!;
            if(mutation=="remove")entry.AsObject().Remove("table");else if(mutation=="tableId")entry["table"]![mutation]="wrong-table";else if(mutation=="repeatedHeader")entry[mutation]!["instanceIndex"]=entry[mutation]!["instanceIndex"]!.GetValue<int>()+1;else entry["table"]![mutation]=entry["table"]![mutation]!.GetValue<int>()+1;
            string json=map.ToJsonString();part["content"]=json;part["sha256"]=Hash(Encoding.UTF8.GetBytes(json));
        });
        Assert.Equal("TABLE_RELATION_MISMATCH",SourceContainer.Extract(bytes,barcodeGeometryResolver:ResolveBarcode,sourceRenderResolver:ResolveSourceRender,cancellationToken:TestContext.Current.CancellationToken).Error);
    }
    [Fact]
    public async Task Page_bands_use_the_authoritative_render_host()
    {
        var fixture=await Build("section-pages");
        Assert.Equal("SOURCE_RENDER_VERIFIER_REQUIRED",SourceContainer.Extract(fixture.Sealed,cancellationToken:TestContext.Current.CancellationToken).Error);
        Assert.True(SourceContainer.Extract(fixture.Sealed,sourceRenderResolver:ResolveSourceRender,cancellationToken:TestContext.Current.CancellationToken).Ok);
    }

}
