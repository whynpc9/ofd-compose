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
        var sealedResult = SourceContainer.Create(ofd.Bytes!, Hash(ir), ofd.ObjectMap!, ContainerProfile.NativeEditable, sourceBytes, assets, cancellationToken:TestContext.Current.CancellationToken);
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
        var extracted = SourceContainer.Extract(first.Sealed, cancellationToken:TestContext.Current.CancellationToken);
        Assert.True(extracted.Ok, extracted.Error);
        Assert.Equal("internal-consistency-only", extracted.Integrity); Assert.Equal("unsigned", extracted.Signature);
        var firstRead = await new OfdReader().ReadAsync(new MemoryStream(first.Sealed), TestContext.Current.CancellationToken);
        var attachment = Assert.Single(firstRead.Attachments);
        Assert.Equal("application/json", attachment.MediaType);
        Assert.True(uint.TryParse(attachment.Id,out uint attachmentId)&&attachmentId>0);
        Assert.Equal(Zip(first.Sealed)["Doc_0/Attachs/ofd-compose.json"], attachment.Data);
        string input = Path.Combine(first.Directory,"extracted.json"); await File.WriteAllBytesAsync(input,extracted.SourceJson!, TestContext.Current.CancellationToken);
        var second = await Build("edit",input);
        var secondExtract = SourceContainer.Extract(second.Sealed, cancellationToken:TestContext.Current.CancellationToken); Assert.True(secondExtract.Ok,secondExtract.Error);
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
        Assert.Equal(expected,SourceContainer.Extract(bytes, cancellationToken:TestContext.Current.CancellationToken).Error);
    }
    [Fact]
    public async Task Distribution_has_no_source_or_semantics_anywhere()
    {
        var first=await Initial.Value;
        var result=SourceContainer.Create(first.Ofd.Bytes!,first.Identity["irDigest"]!.GetValue<string>(),first.Ofd.ObjectMap!,ContainerProfile.Distribution, cancellationToken:TestContext.Current.CancellationToken);
        Assert.True(result.Ok,result.Error);
        var extracted=SourceContainer.Extract(result.Bytes!, cancellationToken:TestContext.Current.CancellationToken); Assert.True(extracted.Ok,extracted.Error);
        Assert.Equal("distribution",extracted.Profile); Assert.Null(extracted.SourceJson);
        foreach(var bytes in Zip(result.Bytes!).Values)
        { var text=Encoding.UTF8.GetString(bytes); Assert.DoesNotContain("resolved-document@",text); Assert.DoesNotContain("printed",text); Assert.DoesNotContain("revision-1",text); }
        Assert.Equal("DISTRIBUTION_SOURCE_FORBIDDEN",SourceContainer.Create(first.Ofd.Bytes!,first.Identity["irDigest"]!.GetValue<string>(),first.Ofd.ObjectMap!,ContainerProfile.Distribution,first.Source, cancellationToken:TestContext.Current.CancellationToken).Error);
    }
    [Fact]
    public async Task Budget_cancellation_path_duplicates_DTD_and_forged_name_fail_closed()
    {
        var first=await Initial.Value;
        Assert.Equal("SIZE_LIMIT",SourceContainer.Extract(first.Sealed,new(){PackageBytes=100}, cancellationToken:TestContext.Current.CancellationToken).Error);
        Assert.Equal("SIZE_LIMIT",SourceContainer.Extract(first.Sealed,new(){Entries=1}, cancellationToken:TestContext.Current.CancellationToken).Error);
        Assert.Equal("CANCELLED",SourceContainer.Extract(first.Sealed,cancellationToken:new(true)).Error);
        foreach(string alias in new[]{"../escape","Doc_0/Res/é.bin","Doc_0\\escape","/absolute","a//b","a/./b"})
        { var entries=Zip(first.Sealed);entries.Add(alias,[1]);Assert.Equal("PACKAGE_PATH",SourceContainer.Extract(Pack(entries), cancellationToken:TestContext.Current.CancellationToken).Error); }
        Assert.Equal("PACKAGE_DUPLICATE",SourceContainer.Extract(Pack(Zip(first.Sealed),"ofd.XML"), cancellationToken:TestContext.Current.CancellationToken).Error);
        var dtd=Zip(first.Sealed);dtd["OFD.xml"]=Encoding.UTF8.GetBytes("<!DOCTYPE OFD [<!ENTITY x SYSTEM 'file:///etc/passwd'>]><OFD xmlns='http://www.ofdspec.org/2016'>&x;</OFD>");
        Assert.False(SourceContainer.Extract(Pack(dtd), cancellationToken:TestContext.Current.CancellationToken).Ok);
        var forged=Zip(first.Sealed);forged["Doc_0/Attachs/Attachments.xml"]=Encoding.UTF8.GetBytes(Encoding.UTF8.GetString(forged["Doc_0/Attachs/Attachments.xml"]).Replace("ofd-compose.json","forged.json"));
        Assert.Equal("ATTACHMENT_INVALID",SourceContainer.Extract(Pack(forged), cancellationToken:TestContext.Current.CancellationToken).Error);
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
        var result=SourceContainer.Extract(signed,cancellationToken:TestContext.Current.CancellationToken);
        Assert.True(result.Ok,result.Error);Assert.Equal("present-unverified",result.Signature);Assert.Equal("internal-consistency-only",result.Integrity);
        Assert.Equal("SIGNED_INPUT_UNSUPPORTED",SourceContainer.Create(signed,first.Identity["irDigest"]!.GetValue<string>(),first.Ofd.ObjectMap!,ContainerProfile.Distribution,cancellationToken:TestContext.Current.CancellationToken).Error);
    }

    [Fact]
    public async Task Combined_media_assets_are_preserved_and_missing_source_image_is_rejected()
    {
        var fixture=await Build("combined");
        var extracted=SourceContainer.Extract(fixture.Sealed,cancellationToken:TestContext.Current.CancellationToken);
        Assert.True(extracted.Ok,extracted.Error);Assert.NotEmpty(extracted.Assets!);
        var bytes=Mutate(fixture.Sealed,(_,entries)=>entries.Remove(entries.Keys.First(p=>p.StartsWith("Doc_0/Attachs/Assets/"))));
        Assert.Equal("RESOURCE_MISSING",SourceContainer.Extract(bytes,cancellationToken:TestContext.Current.CancellationToken).Error);
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
        Assert.Equal(expected,SourceContainer.Extract(bytes,cancellationToken:TestContext.Current.CancellationToken).Error);
    }

    [Fact]
    public async Task Rejects_compression_bombs_nested_archives_header_lies_and_duplicate_JSON_keys()
    {
        var first=await Initial.Value;
        var entries=Zip(first.Sealed);entries.Add("Doc_0/Res/bomb.otf",new byte[2*1024*1024]);
        Assert.Equal("SIZE_LIMIT",SourceContainer.Extract(Pack(entries),cancellationToken:TestContext.Current.CancellationToken).Error);
        entries=Zip(first.Sealed);entries.Add("Doc_0/Res/nested.zip",[80,75,3,4]);
        Assert.Equal("UNEXPECTED_ENTRY",SourceContainer.Extract(Pack(entries),cancellationToken:TestContext.Current.CancellationToken).Error);
        var header=(byte[])first.Sealed.Clone();header[14]^=1;
        Assert.Equal("PACKAGE_SIZE",SourceContainer.Extract(header,cancellationToken:TestContext.Current.CancellationToken).Error);
        entries=Zip(first.Sealed);const string path="Doc_0/Attachs/ofd-compose.json";
        entries[path]=Encoding.UTF8.GetBytes("{\"namespace\":\"ofd-compose\","+Encoding.UTF8.GetString(entries[path])[1..]);
        Assert.Equal("SCHEMA_INVALID",SourceContainer.Extract(Pack(entries),cancellationToken:TestContext.Current.CancellationToken).Error);
        Assert.Equal("SIZE_LIMIT",SourceContainer.Extract(first.Sealed,new(){WorkBytes=100},cancellationToken:TestContext.Current.CancellationToken).Error);
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
        var created=SourceContainer.Create(first.Ofd.Bytes!,first.Identity["irDigest"]!.GetValue<string>(),new ChangingMap(first.Ofd.ObjectMap!),ContainerProfile.NativeEditable,source.Input,cancellationToken:TestContext.Current.CancellationToken);
        Assert.True(created.Ok,created.Error);
        var extracted=SourceContainer.Extract(created.Bytes!,cancellationToken:TestContext.Current.CancellationToken);
        Assert.True(extracted.Ok,extracted.Error);
        Assert.DoesNotContain("caller-mutated",Encoding.UTF8.GetString(created.Bytes!));
    }

    [Theory]
    [InlineData("checkbox-true","[x]")]
    [InlineData("checkbox-false","[ ]")]
    public async Task Boolean_controls_keep_the_layout_display_representation(string mode,string expected)
    {
        var fixture=await Build(mode);
        var extracted=SourceContainer.Extract(fixture.Sealed,cancellationToken:TestContext.Current.CancellationToken);
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
        Assert.Equal("RESOURCE_IMAGE_MISMATCH",SourceContainer.Extract(bytes,cancellationToken:TestContext.Current.CancellationToken).Error);
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
        Assert.Equal("RESOURCE_IMAGE_MISMATCH",SourceContainer.Extract(Inline(replacement),cancellationToken:TestContext.Current.CancellationToken).Error);
        byte[] originalImage=Zip(fixture.Sealed).First(e=>e.Key.StartsWith("Doc_0/Attachs/Assets/",StringComparison.Ordinal)).Value;
        var sameImage=SourceContainer.Extract(Inline(originalImage),cancellationToken:TestContext.Current.CancellationToken);Assert.True(sameImage.Ok,sameImage.Error);
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
        Assert.Equal("RESOURCE_IMAGE_MISMATCH",SourceContainer.Extract(bytes,cancellationToken:TestContext.Current.CancellationToken).Error);
    }

    [Fact]
    public async Task Empty_paragraph_without_source_ranges_roundtrips_as_empty_text()
    {
        var fixture=await Build("empty-paragraph");
        var extracted=SourceContainer.Extract(fixture.Sealed,cancellationToken:TestContext.Current.CancellationToken);Assert.True(extracted.Ok,extracted.Error);
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
        Assert.Equal("PACKAGE_XML",SourceContainer.Extract(Change(first.Sealed),cancellationToken:TestContext.Current.CancellationToken).Error);
        if(Zip(first.Ofd.Bytes!).ContainsKey(path))Assert.Equal("PACKAGE_XML",SourceContainer.Create(Change(first.Ofd.Bytes!),first.Identity["irDigest"]!.GetValue<string>(),first.Ofd.ObjectMap!,ContainerProfile.NativeEditable,first.Source,cancellationToken:TestContext.Current.CancellationToken).Error);
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
        var result=SourceContainer.Create(Pack(entries),first.Identity["irDigest"]!.GetValue<string>(),first.Ofd.ObjectMap!,ContainerProfile.Distribution,cancellationToken:TestContext.Current.CancellationToken);
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
        Assert.Equal("DIGEST_MISMATCH",SourceContainer.Extract(bytes,cancellationToken:TestContext.Current.CancellationToken).Error);
        var mismatchedDoc=Mutate(first.Sealed,(manifest,entries)=> {
            var xml=XDocument.Parse(Encoding.UTF8.GetString(entries["OFD.xml"]));xml.Descendants().Single(e=>e.Name.LocalName=="DocID").Value=new string('0',32);
            entries["OFD.xml"]=Encoding.UTF8.GetBytes(xml.ToString());
            var record=manifest["entries"]!.AsArray().Single(e=>e!["path"]!.GetValue<string>()=="OFD.xml")!;record["sha256"]=Hash(entries["OFD.xml"]);record["byteLength"]=entries["OFD.xml"].Length;
        });
        Assert.Equal("DIGEST_MISMATCH",SourceContainer.Extract(mismatchedDoc,cancellationToken:TestContext.Current.CancellationToken).Error);
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
        Assert.Equal("FONT_FACE_MISMATCH",SourceContainer.Extract(bytes,cancellationToken:TestContext.Current.CancellationToken).Error);
    }
    [Theory]
    [InlineData(ContainerProfile.NativeEditable)]
    [InlineData(ContainerProfile.Distribution)]
    public async Task Orphan_resource_bytes_cannot_carry_hidden_source(ContainerProfile profile)
    {
        var first=await Initial.Value;var entries=Zip(first.Ofd.Bytes!);entries.Add("Doc_0/Res/leak.png",Encoding.UTF8.GetBytes("FULL_SOURCE_SECRET"));
        var result=SourceContainer.Create(Pack(entries),first.Identity["irDigest"]!.GetValue<string>(),first.Ofd.ObjectMap!,profile,profile==ContainerProfile.NativeEditable?first.Source:default,cancellationToken:TestContext.Current.CancellationToken);
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
        var result=SourceContainer.Create(Pack(entries),first.Identity["irDigest"]!.GetValue<string>(),first.Ofd.ObjectMap!,ContainerProfile.Distribution,cancellationToken:TestContext.Current.CancellationToken);
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
        Assert.Equal("PACKAGE_SIZE",SourceContainer.Extract(changed,cancellationToken:TestContext.Current.CancellationToken).Error);
        using var input=new ChangingMemory(first.Sealed,changed);
        var result=SourceContainer.Extract(input.Input,cancellationToken:TestContext.Current.CancellationToken);Assert.True(result.Ok,result.Error);
        Assert.Equal("revision-1",JsonNode.Parse(result.SourceJson!)!["resolvedDocument"]!["revisionId"]!.GetValue<string>());
    }

}
