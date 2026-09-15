using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using OFDCompose.FixedWriting;
using UglyToad.PdfPig;
using Xunit;
namespace OFDCompose.PdfIrWriter.Tests;
public sealed class MappingTests
{
    private static byte[] Canonical(JsonNode node)
    {
        node["semantics"]=new JsonArray();node["identity"]!["semanticDigest"]=WriterTests.Digest("[]"u8.ToArray());
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
        string output=Path.Combine(WriterTests.Root,".scratch/issue16-output");await File.WriteAllBytesAsync(Path.Combine(output,name+"-mapping.pdf"),result.Bytes!,TestContext.Current.CancellationToken);
        await File.WriteAllBytesAsync(Path.Combine(output,name+"-mapping.ir.json"),bytes,TestContext.Current.CancellationToken);
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
