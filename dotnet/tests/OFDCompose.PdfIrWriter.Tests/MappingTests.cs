using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using OFDCompose.FixedWriting;
using UglyToad.PdfPig;
using Xunit;
namespace OFDCompose.PdfIrWriter.Tests;
public sealed class MappingTests
{
    private static byte[] Canonical(JsonNode node,bool retainSemantics=false)
    {
        if(!retainSemantics)node["semantics"]=new JsonArray();
        using var semantics=JsonDocument.Parse(node["semantics"]!.ToJsonString());node["identity"]!["semanticDigest"]=WriterTests.Digest(Encoding.UTF8.GetBytes(IrValidation.Canonical(semantics.RootElement)));
        using var doc=JsonDocument.Parse(node.ToJsonString());return Encoding.UTF8.GetBytes(IrValidation.Canonical(doc.RootElement));
    }
    [Theory][InlineData("truetype")][InlineData("cff")]
    public async Task Same_glyph_different_cluster_origins_surrogates_and_multichar(string name)
    {
        var f=await WriterTests.Fixture(name);var node=JsonNode.Parse(f.Ir)!;var page=node["pages"]![0]!;var obj=page["objects"]![0]!.DeepClone();
        var original=obj["glyphs"]![0]!.DeepClone();var glyphs=new JsonArray();var clusters=new JsonArray();string logical="A😀ffi";int[] ends=[1,3,6];
        for(int i=0,start=0;i<3;i++)
        {
            var glyph=original.DeepClone();glyph["clusterId"]=i;glyph["position"]!["x"]=20000+i*5000;glyphs.Add(glyph);
            clusters.Add(new JsonObject{["clusterId"]=i,["logicalRange"]=new JsonObject{["start"]=start,["end"]=ends[i]},["displayRange"]=new JsonObject{["start"]=start,["end"]=ends[i]},["glyphIndices"]=new JsonArray(i)});start=ends[i];
        }
        obj["glyphs"]=glyphs;obj["clusters"]=clusters;obj["logicalText"]=logical;obj["displayText"]=logical;page["objects"]=new JsonArray(obj);node["markers"]=new JsonArray();
        var bytes=Canonical(node);var result=await new PdfIrWriter().WriteAsync(bytes,WriterTests.Digest(bytes),f.Resources,cancellationToken:TestContext.Current.CancellationToken);
        Assert.True(result.Ok,JsonSerializer.Serialize(result.Diagnostics));using var pdf=PdfDocument.Open(result.Bytes!);Assert.Equal(logical,pdf.GetPage(1).Text);
        string output=WriterTests.Output;await File.WriteAllBytesAsync(Path.Combine(output,name+"-mapping.pdf"),result.Bytes!,TestContext.Current.CancellationToken);
        await File.WriteAllBytesAsync(Path.Combine(output,name+"-mapping.ir.json"),bytes,TestContext.Current.CancellationToken);
    }
    [Fact] public async Task Printable_logical_display_difference_extracts_without_loss()
    {
        var f=await WriterTests.Fixture("logical-display");var node=JsonNode.Parse(f.Ir)!;
        var obj=node["pages"]![0]!["objects"]![0]!;obj["logicalText"]=obj["logicalText"]!.GetValue<string>().Replace("\r\n","XY",StringComparison.Ordinal);
        byte[] ir=Canonical(node);var result=await new PdfIrWriter().WriteAsync(ir,WriterTests.Digest(ir),f.Resources,cancellationToken:TestContext.Current.CancellationToken);Assert.True(result.Ok,JsonSerializer.Serialize(result.Diagnostics));
        using var pdf=PdfDocument.Open(result.Bytes!);Assert.Equal("XY<&>\"'abc中文 𠮷",pdf.GetPage(1).Text);
        string output=WriterTests.Output;
        await File.WriteAllBytesAsync(Path.Combine(output,"logical-display-printable.pdf"),result.Bytes!,TestContext.Current.CancellationToken);
        await File.WriteAllBytesAsync(Path.Combine(output,"logical-display-printable.ir.json"),ir,TestContext.Current.CancellationToken);
    }
    [Theory][InlineData("  ",false)][InlineData("   ",false)][InlineData(" A",false)][InlineData("\u00a0A",false)][InlineData("\u0085A",true)][InlineData("A\u200b",false)][InlineData("A\U000e0001",false)][InlineData("\u200b",false)][InlineData("\U000e0001",false)]
    public async Task PdfJs_category_loss_is_diagnosed_precisely(string logical,bool expectedOk)
    {
        var f=await WriterTests.Fixture("truetype");var n=JsonNode.Parse(f.Ir)!;var page=n["pages"]![0]!;var obj=page["objects"]![0]!.DeepClone();
        obj["glyphs"]=new JsonArray(obj["glyphs"]![0]!.DeepClone());obj["logicalText"]=logical;obj["displayText"]=logical;
        obj["clusters"]=new JsonArray(new JsonObject{["clusterId"]=0,["logicalRange"]=new JsonObject{["start"]=0,["end"]=logical.Length},["displayRange"]=new JsonObject{["start"]=0,["end"]=logical.Length},["glyphIndices"]=new JsonArray(0)});
        page["objects"]=new JsonArray(obj);n["markers"]=new JsonArray();byte[] ir=Canonical(n);
        var result=await new PdfIrWriter().WriteAsync(ir,WriterTests.Digest(ir),f.Resources,cancellationToken:TestContext.Current.CancellationToken);
        Assert.Equal(expectedOk,result.Ok);
        if(result.Ok&&expectedOk)
        {
            using var pdf=PdfDocument.Open(result.Bytes!);Assert.Equal(logical,pdf.GetPage(1).Text);
            await File.WriteAllBytesAsync(Path.Combine(WriterTests.Output,"nel-control.pdf"),result.Bytes!,TestContext.Current.CancellationToken);
            await File.WriteAllBytesAsync(Path.Combine(WriterTests.Output,"nel-control.ir.json"),ir,TestContext.Current.CancellationToken);
        }
        else Assert.Contains(result.Diagnostics,d=>d.Code=="UNSUPPORTED_FEATURE"&&d.Path=="p0o0");
    }
    [Theory][InlineData(2147483648u)][InlineData(4294967295u)]
    public async Task Original_glyph_ids_use_full_uint32_contract(uint original)
    {
        var f=await WriterTests.Fixture("nonidentity-contract");var n=JsonNode.Parse(f.Ir)!;
        var font=n["resources"]!.AsArray().Single(r=>r!["kind"]!.GetValue<string>()=="font")!;
        var glyph=n["pages"]![0]!["objects"]![0]!["glyphs"]![0]!;uint previous=glyph["glyphId"]!.GetValue<uint>();glyph["glyphId"]=original;
        var map=font["glyphIdMap"]!.AsArray();var entry=map.Single(r=>r!["original"]!.GetValue<uint>()==previous)!;entry["original"]=original;
        font["glyphIdMap"]=new JsonArray(map.OrderBy(r=>r!["original"]!.GetValue<uint>()).Select(r=>r!.DeepClone()).ToArray());
        byte[] ir=Canonical(n);var result=await new PdfIrWriter().WriteAsync(ir,WriterTests.Digest(ir),f.Resources,cancellationToken:TestContext.Current.CancellationToken);
        Assert.True(result.Ok,JsonSerializer.Serialize(result.Diagnostics));using var pdf=PdfDocument.Open(result.Bytes!);Assert.Equal("q́",pdf.GetPage(1).Text);
    }
    [Fact]
    public async Task Fallback_form_clip_expansion_shares_the_command_budget()
    {
        var f=await WriterTests.Fixture("truetype");var n=JsonNode.Parse(f.Ir)!;var obj=n["pages"]![0]!["objects"]![0]!.DeepClone();
        obj["glyphs"]=new JsonArray(obj["glyphs"]!.AsArray().Take(3).Select(g=>g!.DeepClone()).ToArray());
        obj["clusters"]=new JsonArray(obj["clusters"]!.AsArray().Take(3).Select(c=>c!.DeepClone()).ToArray());obj["logicalText"]="AAA";obj["displayText"]="AAA";n["pages"]![0]!["objects"]=new JsonArray(obj);n["markers"]=new JsonArray();
        n["graphicsStates"]![0]!["clip"]=JsonNode.Parse("{\"coordinateSpace\":\"local\",\"fillRule\":\"nonzero\",\"commands\":[{\"op\":\"move\",\"x\":0,\"y\":0},{\"op\":\"line\",\"x\":100000,\"y\":0},{\"op\":\"line\",\"x\":100000,\"y\":100000},{\"op\":\"close\"}]}");
        byte[] ir=Canonical(n);var result=await new PdfIrWriter().WriteAsync(ir,WriterTests.Digest(ir),f.Resources,new WriterLimits{Commands=12},TestContext.Current.CancellationToken);
        Assert.False(result.Ok);Assert.Contains(result.Diagnostics,d=>d.Code=="RESOURCE_LIMIT"&&d.Path=="clips");
    }
    [Fact]
    public async Task Fallback_form_reservation_includes_repeated_dash_state()
    {
        var f=await WriterTests.Fixture("truetype");var n=JsonNode.Parse(f.Ir)!;var obj=n["pages"]![0]!["objects"]![0]!.DeepClone();
        obj["glyphs"]=new JsonArray(obj["glyphs"]!.AsArray().Take(3).Select(g=>g!.DeepClone()).ToArray());obj["clusters"]=new JsonArray(obj["clusters"]!.AsArray().Take(3).Select(c=>c!.DeepClone()).ToArray());
        obj["logicalText"]="AAA";obj["displayText"]="AAA";n["pages"]![0]!["objects"]=new JsonArray(obj);n["markers"]=new JsonArray();n["graphicsStates"]![0]!["dash"]=new JsonArray(Enumerable.Range(0,5000).Select(_=>(JsonNode?)JsonValue.Create(1)).ToArray());
        byte[] ir=Canonical(n);int budget=checked(ir.Length*12+f.Resources.Sum(r=>r.Bytes.Length)*3+65536+3*2048+4096);
        var result=await new PdfIrWriter().WriteAsync(ir,WriterTests.Digest(ir),f.Resources,new WriterLimits{OutputBytes=budget},TestContext.Current.CancellationToken);
        Assert.False(result.Ok);Assert.Contains(result.Diagnostics,d=>d.Code=="RESOURCE_LIMIT"&&d.Path=="output");
    }
    [Theory][InlineData(false,false,false)][InlineData(false,true,false)][InlineData(true,false,false)][InlineData(false,false,true)]
    public async Task Rtl_visual_glyph_array_preserves_logical_text_and_positions(bool overlap,bool rightToLeftPositions,bool wide)
    {
        var f=await WriterTests.Fixture("truetype");var n=JsonNode.Parse(f.Ir)!;var obj=n["pages"]![0]!["objects"]![0]!.DeepClone();
        var glyphs=obj["glyphs"]!.AsArray().Take(3).Select(g=>g!.DeepClone()).ToArray();
        if(wide)for(int i=0;i<glyphs.Length;i++)glyphs[i]["position"]!["x"]=20000+i*40000;
        if(rightToLeftPositions)for(int i=0;i<glyphs.Length;i++)glyphs[i]["position"]!["x"]=60000-i*5000;
        if(overlap){foreach(var g in glyphs)g["position"]!["x"]=20000;n["graphicsStates"]![0]!["opacity"]=0.5;}
        obj["logicalText"]="off";obj["displayText"]="off";obj["glyphs"]=new JsonArray(glyphs.Reverse().ToArray());
        var clusters=obj["clusters"]!.AsArray().Take(3).Select(c=>c!.DeepClone()).ToArray();for(int i=0;i<3;i++)clusters[i]["glyphIndices"]=new JsonArray(2-i);
        obj["clusters"]=new JsonArray(clusters);obj["direction"]="rtl";n["pages"]![0]!["objects"]=new JsonArray(obj);n["markers"]=new JsonArray();
        byte[] ir=Canonical(n);var result=await new PdfIrWriter().WriteAsync(ir,WriterTests.Digest(ir),f.Resources,cancellationToken:TestContext.Current.CancellationToken);
        Assert.True(result.Ok,JsonSerializer.Serialize(result.Diagnostics));using var pdf=PdfDocument.Open(result.Bytes!);Assert.Equal("off",pdf.GetPage(1).Text);
        Assert.Equal(3,pdf.GetPage(1).Letters.Count);
        for(int i=0;i<3;i++){var letter=pdf.GetPage(1).Letters[i];Assert.InRange(Math.Abs(letter.StartBaseLine.X-(glyphs[i]["position"]!["x"]!.GetValue<int>()+glyphs[i]["offset"]!["x"]!.GetValue<int>())*72d/25400),0,0.001);
            Assert.InRange(Math.Abs(letter.StartBaseLine.Y-(n["pages"]![0]!["height"]!.GetValue<int>()-glyphs[i]["position"]!["y"]!.GetValue<int>()-glyphs[i]["offset"]!["y"]!.GetValue<int>())*72d/25400),0,0.001);}
        string name=wide?"rtl-wide":overlap?"rtl-overlap":rightToLeftPositions?"rtl-positions":"rtl-order";string output=Directory.CreateDirectory(Path.Combine(WriterTests.Output,"rtl")).FullName;
        await File.WriteAllBytesAsync(Path.Combine(output,name+".pdf"),result.Bytes!,TestContext.Current.CancellationToken);await File.WriteAllBytesAsync(Path.Combine(output,name+".ir.json"),ir,TestContext.Current.CancellationToken);
        var reference=n.DeepClone();var referenceObject=reference["pages"]![0]!["objects"]![0]!;referenceObject["logicalText"]="ffo";referenceObject["displayText"]="ffo";referenceObject["direction"]="rtl";
        for(int i=0;i<3;i++){referenceObject["glyphs"]![i]!["clusterId"]=i;referenceObject["clusters"]![i]!["glyphIndices"]=new JsonArray(i);}
        reference["semantics"]=new JsonArray(new JsonObject{["objectId"]="p0o0",["nodeId"]="visual-order-reference",["readingOrder"]=0});
        byte[] referenceIr=Canonical(reference,true);var referencePdf=await new PdfIrWriter().WriteAsync(referenceIr,WriterTests.Digest(referenceIr),f.Resources,cancellationToken:TestContext.Current.CancellationToken);Assert.True(referencePdf.Ok);
        string referenceDirectory=Directory.CreateDirectory(Path.Combine(output,"reference")).FullName;await File.WriteAllBytesAsync(Path.Combine(referenceDirectory,name+".pdf"),referencePdf.Bytes!,TestContext.Current.CancellationToken);await File.WriteAllBytesAsync(Path.Combine(referenceDirectory,name+".ir.json"),referenceIr,TestContext.Current.CancellationToken);
    }
    [Theory][InlineData(0)][InlineData(1)]
    public async Task Combining_cluster_each_glyph_has_independent_reader_geometry(int index)
    {
        var f=await WriterTests.Fixture("multi-glyph");var n=JsonNode.Parse(f.Ir)!;var obj=n["pages"]![0]!["objects"]![0]!;
        var glyph=obj["glyphs"]![index]!.DeepClone();glyph["clusterId"]=0;obj["glyphs"]=new JsonArray(glyph);
        string text=index==0?"q":"\u0301";obj["logicalText"]=text;obj["displayText"]=text;
        obj["clusters"]=new JsonArray(new JsonObject{["clusterId"]=0,["logicalRange"]=new JsonObject{["start"]=0,["end"]=1},["displayRange"]=new JsonObject{["start"]=0,["end"]=1},["glyphIndices"]=new JsonArray(0)});
        byte[] ir=Canonical(n);var result=await new PdfIrWriter().WriteAsync(ir,WriterTests.Digest(ir),f.Resources,cancellationToken:TestContext.Current.CancellationToken);Assert.True(result.Ok,JsonSerializer.Serialize(result.Diagnostics));
        using var pdf=PdfDocument.Open(result.Bytes!);var letter=Assert.Single(pdf.GetPage(1).Letters);Assert.Equal(text,letter.Value);
        double x=(glyph["position"]!["x"]!.GetValue<double>()+glyph["offset"]!["x"]!.GetValue<double>())*72/25400;
        double y=(n["pages"]![0]!["height"]!.GetValue<double>()-glyph["position"]!["y"]!.GetValue<double>()-glyph["offset"]!["y"]!.GetValue<double>())*72/25400;
        Assert.InRange(Math.Abs(letter.StartBaseLine.X-x),0,0.001);Assert.InRange(Math.Abs(letter.StartBaseLine.Y-y),0,0.001);
    }
}
