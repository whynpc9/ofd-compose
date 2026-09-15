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
    [InlineData("duplicate-markers")]
    [InlineData("multi-glyph")]
    [InlineData("nonidentity-contract")]
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
                var state=ir.RootElement.GetProperty("graphicsStates").EnumerateArray().Single(s=>s.GetProperty("id").GetString()==obj.GetProperty("stateId").GetString());
                string xmlText=read switch { OfdTextElement t=>t.SourceXml!, OfdPathElement path=>path.SourceXml!, OfdImageElement image=>image.SourceXml!, _=>throw new InvalidOperationException() };
                var readXml=XElement.Parse(xmlText);
                Assert.Equal((int)Math.Round(state.GetProperty("opacity").GetDouble()*255,MidpointRounding.AwayFromZero),(int?)readXml.Attribute("Alpha")??255);
                if(read is OfdPathElement readPath) CompareCommands(readPath.AbbreviatedData,readXml.Attribute("Rule")?.Value,obj);
                var expectedClips=new List<JsonElement>();
                if(state.TryGetProperty("clip",out var stateClip))expectedClips.Add(stateClip);
                if(obj.TryGetProperty("clip",out var imageClip))expectedClips.Add(imageClip);
                var readClips=readXml.Elements().Where(e=>e.Name.LocalName=="Clips").SelectMany(e=>e.Elements()).ToArray();
                Assert.Equal(expectedClips.Count,readClips.Length);
                for(int c=0;c<readClips.Length;c++)
                {
                    var path=readClips[c].Elements().Single(e=>e.Name.LocalName=="Area").Elements().Single(e=>e.Name.LocalName=="Path");
                    CompareCommands(path.Elements().Single(e=>e.Name.LocalName=="AbbreviatedData").Value,path.Attribute("Rule")?.Value,expectedClips[c]);
                }
                if (read is OfdTextElement text)
                {
                    Assert.Equal(obj.GetProperty("logicalText").GetString(), text.Text);
                    var glyphs = obj.GetProperty("glyphs").EnumerateArray().ToArray();
                    var font=ir.RootElement.GetProperty("resources").EnumerateArray().Single(r=>r.GetProperty("id").GetString()==obj.GetProperty("fontId").GetString());
                    var subsetMap=font.TryGetProperty("glyphIdMap",out var mappings)?mappings.EnumerateArray().ToDictionary(m=>m.GetProperty("original").GetUInt32(),m=>m.GetProperty("subset").GetUInt32()):null;
                    var actualMappings=readXml.Elements().Where(e=>e.Name.LocalName=="CGTransform").ToArray();
                    var clusters=obj.GetProperty("clusters").EnumerateArray().ToArray();Assert.Equal(clusters.Length,actualMappings.Length);
                    for(int c=0;c<clusters.Length;c++)
                    {
                        var range=clusters[c].GetProperty("logicalRange");var indices=clusters[c].GetProperty("glyphIndices").EnumerateArray().Select(g=>g.GetInt32()).ToArray();var actual=actualMappings[c];
                        Assert.Equal(range.GetProperty("start").GetInt32(),(int)actual.Attribute("CodePosition")!);
                        Assert.Equal(range.GetProperty("end").GetInt32()-range.GetProperty("start").GetInt32(),(int?)actual.Attribute("CodeCount")??1);
                        Assert.Equal(indices.Length,(int?)actual.Attribute("GlyphCount")??1);
                        var glyphIds=actual.Elements().Single(e=>e.Name.LocalName=="Glyphs").Value.Split((char[]?)null,StringSplitOptions.RemoveEmptyEntries).Select(v=>uint.Parse(v,CultureInfo.InvariantCulture));
                        Assert.Equal(indices.Select(g=>{uint id=glyphs[g].GetProperty("glyphId").GetUInt32();return subsetMap is null?id:subsetMap[id];}),glyphIds);
                    }
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
            System.Buffers.Binary.BinaryPrimitives.WriteUInt32BigEndian(corrupt.AsSpan(12+i*16+4),0);
            found=true; break;
        }
        Assert.True(found);
        RepairFontAdjustment(corrupt);
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
        RepairFontAdjustment(corrupt);
        var ir=Encoding.UTF8.GetBytes(Encoding.UTF8.GetString(fixture.Ir).Replace(Digest(resource.Bytes.ToArray()),Digest(corrupt)));
        var result=await new OfdIrWriter().WriteAsync(ir,Digest(ir),[new(resource.ResourceId,corrupt)],cancellationToken:TestContext.Current.CancellationToken);
        Assert.False(result.Ok);Assert.Equal("IR_RESOURCE",Assert.Single(result.Diagnostics).Code);Assert.Contains("FDSelect",Assert.Single(result.Diagnostics).Message);
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
    [Fact]
    public async Task Zip_entry_limit_precedes_resource_decoding()
    {
        var fixture=await Fixture("cff");
        var invalid=fixture.Resources.Select(r=>new WriterResource(r.ResourceId,new byte[]{1})).ToList();
        var result=await new OfdIrWriter().WriteAsync(fixture.Ir,Digest(fixture.Ir),invalid,new WriterLimits {ZipEntries=0},TestContext.Current.CancellationToken);
        Assert.False(result.Ok);Assert.Equal("RESOURCE_LIMIT",Assert.Single(result.Diagnostics).Code);
    }
    private static async Task<OfdWriteResult> ChangedImage(string fixtureName, Func<byte[],byte[]> change)
    {
        var fixture=await Fixture(fixtureName);
        var image=fixture.Resources.Single(r=>r.Bytes.Span.StartsWith(new byte[]{137,80,78,71}) || r.Bytes.Span.StartsWith(new byte[]{255,216}));
        var changed=change(image.Bytes.ToArray());
        var ir=Encoding.UTF8.GetBytes(Encoding.UTF8.GetString(fixture.Ir).Replace(Digest(image.Bytes.ToArray()),Digest(changed)));
        var resources=fixture.Resources.Select(r=>r.ResourceId==image.ResourceId?new WriterResource(r.ResourceId,changed):r).ToList();
        return await new OfdIrWriter().WriteAsync(ir,Digest(ir),resources,cancellationToken:TestContext.Current.CancellationToken);
    }
    [Fact]
    public async Task Apng_with_valid_crcs_is_not_embedded_as_static_png()
    {
        var result=await ChangedImage("combined",bytes=>
        {
            byte[] Chunk(string type,byte[] payload)
            {
                var chunk=new byte[payload.Length+12];System.Buffers.Binary.BinaryPrimitives.WriteUInt32BigEndian(chunk,(uint)payload.Length);
                Encoding.ASCII.GetBytes(type).CopyTo(chunk,4);payload.CopyTo(chunk,8);uint crc=0xffffffff;
                foreach(byte b in chunk.AsSpan(4,payload.Length+4)){crc^=b;for(int i=0;i<8;i++)crc=(crc>>1)^((crc&1)!=0?0xedb88320u:0);}
                System.Buffers.Binary.BinaryPrimitives.WriteUInt32BigEndian(chunk.AsSpan(chunk.Length-4),~crc);return chunk;
            }
            byte[] control=[0,0,0,1,0,0,0,0];var frame=new byte[26];bytes.AsSpan(16,8).CopyTo(frame.AsSpan(4));frame[21]=1;frame[23]=30;
            return [..bytes.AsSpan(0,33),..Chunk("acTL",control),..Chunk("fcTL",frame),..bytes.AsSpan(33)];
        });
        Assert.False(result.Ok);Assert.Equal("UNSUPPORTED_FEATURE",Assert.Single(result.Diagnostics).Code);
    }
    [Theory]
    [InlineData(1,true)] [InlineData(2,true)] [InlineData(3,true)] [InlineData(4,true)]
    [InlineData(5,true)] [InlineData(6,true)] [InlineData(7,true)] [InlineData(8,true)]
    [InlineData(1,false)] [InlineData(2,false)] [InlineData(3,false)] [InlineData(4,false)]
    [InlineData(5,false)] [InlineData(6,false)] [InlineData(7,false)] [InlineData(8,false)]
    public async Task Exif_orientation_uses_declared_ifd_offset_and_byte_order(int orientation,bool little)
    {
        var result=await ChangedImage("jpeg",bytes=>
        {
            // IFD deliberately starts at 24 rather than the common fixed offset 8.
            var payload=new byte[6+24+2+12+4];Encoding.ASCII.GetBytes("Exif\0\0").CopyTo(payload,0);
            payload[6]=payload[7]=(byte)(little?'I':'M');
            void U16(int at,ushort n){if(little)System.Buffers.Binary.BinaryPrimitives.WriteUInt16LittleEndian(payload.AsSpan(6+at),n);else System.Buffers.Binary.BinaryPrimitives.WriteUInt16BigEndian(payload.AsSpan(6+at),n);}
            void U32(int at,uint n){if(little)System.Buffers.Binary.BinaryPrimitives.WriteUInt32LittleEndian(payload.AsSpan(6+at),n);else System.Buffers.Binary.BinaryPrimitives.WriteUInt32BigEndian(payload.AsSpan(6+at),n);}
            U16(2,42);U32(4,24);U16(24,1);U16(26,274);U16(28,3);U32(30,1);U16(34,(ushort)orientation);
            var segment=new byte[payload.Length+4];segment[0]=255;segment[1]=225;System.Buffers.Binary.BinaryPrimitives.WriteUInt16BigEndian(segment.AsSpan(2),(ushort)(payload.Length+2));payload.CopyTo(segment,4);
            return [..bytes.AsSpan(0,2),..segment,..bytes.AsSpan(2)];
        });
        Assert.Equal(orientation==1,result.Ok);
        if(orientation!=1)Assert.Equal("UNSUPPORTED_FEATURE",Assert.Single(result.Diagnostics).Code);
    }
    [Fact]
    public async Task Non_huffman_jpeg_process_fails_explicitly()
    {
        var result=await ChangedImage("jpeg",bytes=>{int at=bytes.AsSpan().IndexOf(new byte[]{255,192});Assert.True(at>=0);bytes[at+1]=195;return bytes;});
        Assert.False(result.Ok);Assert.Equal("UNSUPPORTED_FEATURE",Assert.Single(result.Diagnostics).Code);
    }
    [Fact]
    public async Task Xml_inexpressible_but_well_formed_utf16_is_an_unsupported_feature()
    {
        var fixture=await Fixture("cff");string source=Encoding.UTF8.GetString(fixture.Ir);
        string key="\"logicalText\":\"";int at=source.IndexOf(key,StringComparison.Ordinal)+key.Length;
        Assert.Equal('o',source[at]);
        var ir=Encoding.UTF8.GetBytes(source[..at]+"\\u0000"+source[(at+1)..]);
        var result=await new OfdIrWriter().WriteAsync(ir,Digest(ir),fixture.Resources,cancellationToken:TestContext.Current.CancellationToken);
        Assert.False(result.Ok);Assert.Null(result.ObjectMap);Assert.Equal("UNSUPPORTED_FEATURE",Assert.Single(result.Diagnostics).Code);
    }
    public static TheoryData<string,string,bool> InvalidPathCases
    {
        get
        {
            var cases=new TheoryData<string,string,bool>();
            foreach(string location in new[]{"path","state-clip","image-clip"})
                foreach(string op in new[]{"line","cubic","close"})
                    foreach(bool afterClose in new[]{false,true})cases.Add(location,op,afterClose);
            return cases;
        }
    }
    private static async Task<OfdWriteResult> ChangedCommands(string location,string commands)
    {
        var fixture=await Fixture("geometry");using var document=JsonDocument.Parse(fixture.Ir);var root=document.RootElement;
        var objects=root.GetProperty("pages")[0].GetProperty("objects").EnumerateArray().ToArray();
        var target=location switch {
            "path"=>objects.First(o=>o.GetProperty("kind").GetString()=="path"),
            "state-clip"=>root.GetProperty("graphicsStates")[0].GetProperty("clip"),
            _=>objects.First(o=>o.GetProperty("kind").GetString()=="image").GetProperty("clip") };
        var ir=Encoding.UTF8.GetBytes(Encoding.UTF8.GetString(fixture.Ir).Replace(target.GetProperty("commands").GetRawText(),commands));
        return await new OfdIrWriter().WriteAsync(ir,Digest(ir),fixture.Resources,cancellationToken:TestContext.Current.CancellationToken);
    }
    [Theory]
    [MemberData(nameof(InvalidPathCases))]
    public async Task Paths_and_clips_reject_commands_without_an_open_subpath(string location,string op,bool afterClose)
    {
        string command=op switch {
            "line"=>"{\"op\":\"line\",\"x\":0,\"y\":0}",
            "cubic"=>"{\"op\":\"cubic\",\"x\":0,\"x1\":0,\"x2\":0,\"y\":0,\"y1\":0,\"y2\":0}",
            _=>"{\"op\":\"close\"}" };
        string prefix=afterClose?"{\"op\":\"move\",\"x\":0,\"y\":0},{\"op\":\"close\"},":"";
        var result=await ChangedCommands(location,"["+prefix+command+"]");
        Assert.False(result.Ok);Assert.Null(result.ObjectMap);Assert.Equal("IR_PATH_INVALID",Assert.Single(result.Diagnostics).Code);
    }
    [Theory]
    [InlineData("path")][InlineData("state-clip")][InlineData("image-clip")]
    public async Task Move_reopens_a_closed_path_or_clip(string location)
    {
        var result=await ChangedCommands(location,"[{\"op\":\"move\",\"x\":0,\"y\":0},{\"op\":\"close\"},{\"op\":\"move\",\"x\":1,\"y\":1},{\"op\":\"line\",\"x\":2,\"y\":2}]");
        Assert.True(result.Ok,JsonSerializer.Serialize(result.Diagnostics));
    }
    [Theory]
    [InlineData("cff")][InlineData("truetype")]
    public async Task Sfnt_flavor_must_match_embedded_outline_tables(string name)
    {
        var fixture=await Fixture(name);var resource=fixture.Resources[0];var bad=resource.Bytes.ToArray();
        byte[] flavor=name=="cff"?[0,1,0,0]:Encoding.ASCII.GetBytes("OTTO");flavor.CopyTo(bad,0);
        RepairFontAdjustment(bad);
        var ir=Encoding.UTF8.GetBytes(Encoding.UTF8.GetString(fixture.Ir).Replace(Digest(resource.Bytes.ToArray()),Digest(bad)));
        var result=await new OfdIrWriter().WriteAsync(ir,Digest(ir),[new(resource.ResourceId,bad)],cancellationToken:TestContext.Current.CancellationToken);
        Assert.False(result.Ok);Assert.Equal("IR_RESOURCE",Assert.Single(result.Diagnostics).Code);
    }
    private static void CompareCommands(string data,string? rule,JsonElement expected)
    {
        Assert.Equal(expected.GetProperty("fillRule").GetString()=="evenodd"?"Even-Odd":"NonZero",rule??"NonZero");
        var tokens=data.Split((char[]?)null,StringSplitOptions.RemoveEmptyEntries);int at=0;
        foreach(var command in expected.GetProperty("commands").EnumerateArray())
        {
            string op=command.GetProperty("op").GetString()!;
            Assert.Equal(op switch {"move"=>"M","line"=>"L","cubic"=>"B",_=>"C"},tokens[at++]);
            string[] coordinates=op switch {"move" or "line"=>["x","y"],"cubic"=>["x1","y1","x2","y2","x","y"],_=>[]};
            foreach(string coordinate in coordinates)
                Assert.InRange(Math.Abs(double.Parse(tokens[at++],CultureInfo.InvariantCulture)-command.GetProperty(coordinate).GetDouble()/1000),0,1e-9);
        }
        Assert.Equal(tokens.Length,at);
    }
    private static int FontTableOffset(byte[] bytes,string name)
    {
        int count=System.Buffers.Binary.BinaryPrimitives.ReadUInt16BigEndian(bytes.AsSpan(4));
        for(int i=0;i<count;i++)if(Encoding.ASCII.GetString(bytes,12+i*16,4)==name)
            return (int)System.Buffers.Binary.BinaryPrimitives.ReadUInt32BigEndian(bytes.AsSpan(12+i*16+8));
        throw new InvalidOperationException("Fixture table missing");
    }
    private static void RepairFontAdjustment(byte[] bytes)
    {
        int adjustment=FontTableOffset(bytes,"head")+8;
        System.Buffers.Binary.BinaryPrimitives.WriteUInt32BigEndian(bytes.AsSpan(adjustment),0);
        uint sum=0;for(int i=0;i<bytes.Length;i+=4){uint word=0;for(int b=0;b<4;b++)word=(word<<8)|(i+b<bytes.Length?bytes[i+b]:0u);sum=unchecked(sum+word);}
        System.Buffers.Binary.BinaryPrimitives.WriteUInt32BigEndian(bytes.AsSpan(adjustment),unchecked(0xb1b0afbAu-sum));
    }
    [Theory]
    [InlineData("cff")][InlineData("truetype")]
    public async Task Corrupt_whole_font_adjustment_is_rejected_with_valid_table_checksums(string name)
    {
        var fixture=await Fixture(name);var resource=fixture.Resources[0];var bad=resource.Bytes.ToArray();
        bad[FontTableOffset(bad,"head")+8]^=1;
        var ir=Encoding.UTF8.GetBytes(Encoding.UTF8.GetString(fixture.Ir).Replace(Digest(resource.Bytes.ToArray()),Digest(bad)));
        var result=await new OfdIrWriter().WriteAsync(ir,Digest(ir),[new(resource.ResourceId,bad)],cancellationToken:TestContext.Current.CancellationToken);
        Assert.False(result.Ok);var diagnostic=Assert.Single(result.Diagnostics);Assert.Equal("IR_RESOURCE",diagnostic.Code);Assert.Contains("whole-font checksum",diagnostic.Message);
    }
    [Theory]
    [InlineData("overlap")][InlineData("reordered")][InlineData("empty-range")]
    public async Task Unrepresentable_cluster_relations_are_not_coarsened(string kind)
    {
        var fixture=await Fixture("cff");using var document=JsonDocument.Parse(fixture.Ir);
        var obj=document.RootElement.GetProperty("pages")[0].GetProperty("objects")[0];
        var clusters=obj.GetProperty("clusters");
        string a=clusters[0].GetRawText(),b=clusters[1].GetRawText(),ra=clusters[0].GetProperty("logicalRange").GetRawText(),rb=clusters[1].GetProperty("logicalRange").GetRawText();
        string source=obj.GetRawText();
        source=kind switch {
            "overlap"=>source.Replace(b,b.Replace("\"logicalRange\":"+rb,"\"logicalRange\":"+ra)),
            "reordered"=>source.Replace(a,a.Replace("\"logicalRange\":"+ra,"\"logicalRange\":"+rb)).Replace(b,b.Replace("\"logicalRange\":"+rb,"\"logicalRange\":"+ra)),
            _=>source.Replace(a,a.Replace("\"logicalRange\":"+ra,"\"logicalRange\":{\"end\":0,\"start\":0}")) };
        var ir=Encoding.UTF8.GetBytes(Encoding.UTF8.GetString(fixture.Ir).Replace(obj.GetRawText(),source));var result=await new OfdIrWriter().WriteAsync(ir,Digest(ir),fixture.Resources,cancellationToken:TestContext.Current.CancellationToken);
        Assert.False(result.Ok);Assert.Null(result.ObjectMap);Assert.Equal("UNSUPPORTED_FEATURE",Assert.Single(result.Diagnostics).Code);
    }
    [Theory]
    [InlineData(0)][InlineData(1)][InlineData(2)]
    public async Task Predefined_cff_charsets_reject_excess_charstrings(int charset)
    {
        var fixture=await Fixture("cff");var resource=fixture.Resources[0];var bad=resource.Bytes.ToArray();
        int start=FontTableOffset(bad,"CFF "),directory=28;
        Assert.Equal("CFF ",Encoding.ASCII.GetString(bad,directory,4));
        int length=(int)System.Buffers.Binary.BinaryPrimitives.ReadUInt32BigEndian(bad.AsSpan(directory+12));
        // Remove ROS designation using equal-length non-CID DICT entries; this is an intentionally malformed font.
        byte[] ros=[28,1,138,28,1,139,139,12,30];int rosAt=bad.AsSpan(start,200).IndexOf(ros);Assert.True(rosAt>=0);
        byte[] replacement=[141,12,6,139,12,5,139,12,2];replacement.CopyTo(bad,start+rosAt);
        byte[] charsetOffset=[29,0,0,2,221,15];int charsetAt=bad.AsSpan(start,200).IndexOf(charsetOffset);Assert.True(charsetAt>=0);
        System.Buffers.Binary.BinaryPrimitives.WriteUInt32BigEndian(bad.AsSpan(start+charsetAt+1),(uint)charset);
        uint checksum=0;for(int i=0;i<length;i+=4){uint word=0;for(int b=0;b<4;b++)word=(word<<8)|(i+b<length?bad[start+i+b]:0u);checksum=unchecked(checksum+word);}
        System.Buffers.Binary.BinaryPrimitives.WriteUInt32BigEndian(bad.AsSpan(directory+4),checksum);RepairFontAdjustment(bad);
        var ir=Encoding.UTF8.GetBytes(Encoding.UTF8.GetString(fixture.Ir).Replace(Digest(resource.Bytes.ToArray()),Digest(bad)));
        var result=await new OfdIrWriter().WriteAsync(ir,Digest(ir),[new(resource.ResourceId,bad)],cancellationToken:TestContext.Current.CancellationToken);
        Assert.False(result.Ok);var diagnostic=Assert.Single(result.Diagnostics);Assert.Equal("IR_RESOURCE",diagnostic.Code);Assert.Contains("predefined CFF charset",diagnostic.Message);
    }
    private static void RepairTableChecksum(byte[] bytes,string tag)
    {
        int count=System.Buffers.Binary.BinaryPrimitives.ReadUInt16BigEndian(bytes.AsSpan(4));
        for(int d=12;d<12+count*16;d+=16)if(Encoding.ASCII.GetString(bytes,d,4)==tag)
        {
            int start=(int)System.Buffers.Binary.BinaryPrimitives.ReadUInt32BigEndian(bytes.AsSpan(d+8)),length=(int)System.Buffers.Binary.BinaryPrimitives.ReadUInt32BigEndian(bytes.AsSpan(d+12));
            uint sum=0;for(int i=0;i<length;i+=4){uint word=0;for(int b=0;b<4;b++)word=(word<<8)|(i+b<length?bytes[start+i+b]:0u);sum=unchecked(sum+word);}
            System.Buffers.Binary.BinaryPrimitives.WriteUInt32BigEndian(bytes.AsSpan(d+4),sum);RepairFontAdjustment(bytes);return;
        }
        throw new InvalidOperationException("Fixture table missing");
    }
    [Theory]
    [InlineData("cff",false)][InlineData("truetype",false)][InlineData("truetype",true)]
    public async Task Maxp_version_and_length_match_the_outline_flavor(string name,bool truncate)
    {
        var fixture=await Fixture(name);var resource=fixture.Resources[0];var bad=resource.Bytes.ToArray();
        if(truncate)
        {
            int count=System.Buffers.Binary.BinaryPrimitives.ReadUInt16BigEndian(bad.AsSpan(4));
            for(int d=12;d<12+count*16;d+=16)if(Encoding.ASCII.GetString(bad,d,4)=="maxp")System.Buffers.Binary.BinaryPrimitives.WriteUInt32BigEndian(bad.AsSpan(d+12),6);
        }
        else System.Buffers.Binary.BinaryPrimitives.WriteUInt32BigEndian(bad.AsSpan(FontTableOffset(bad,"maxp")),name=="cff"?0x00010000u:0x00005000u);
        RepairTableChecksum(bad,"maxp");
        var ir=Encoding.UTF8.GetBytes(Encoding.UTF8.GetString(fixture.Ir).Replace(Digest(resource.Bytes.ToArray()),Digest(bad)));
        var result=await new OfdIrWriter().WriteAsync(ir,Digest(ir),[new(resource.ResourceId,bad)],cancellationToken:TestContext.Current.CancellationToken);
        Assert.False(result.Ok);var diagnostic=Assert.Single(result.Diagnostics);Assert.Equal("IR_RESOURCE",diagnostic.Code);Assert.Contains("maxp",diagnostic.Message);
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
