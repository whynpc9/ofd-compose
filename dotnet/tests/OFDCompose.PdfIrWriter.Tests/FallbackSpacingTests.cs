using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using OFDCompose.FixedWriting;
using UglyToad.PdfPig;
using Xunit;
namespace OFDCompose.PdfIrWriter.Tests;
public sealed class FallbackSpacingTests
{
    [Theory][InlineData("AB",false)][InlineData("q́",false)][InlineData("AB",true)][InlineData("q́",true)]
    public async Task Multi_glyph_cluster_preserves_text_across_absolute_positions(string logical,bool semantic)
    {
        var f=await WriterTests.Fixture("multi-glyph");var n=JsonNode.Parse(f.Ir)!;var obj=n["pages"]![0]!["objects"]![0]!;
        obj["logicalText"]=logical;obj["displayText"]=logical;obj["glyphs"]![1]!["position"]!["x"]=100000;
        if(!semantic){n["semantics"]=new JsonArray();n["identity"]!["semanticDigest"]=WriterTests.Digest("[]"u8.ToArray());}using var parsed=JsonDocument.Parse(n.ToJsonString());byte[] ir=Encoding.UTF8.GetBytes(IrValidation.Canonical(parsed.RootElement,false,TestContext.Current.CancellationToken));
        var result=await new PdfIrWriter().WriteAsync(ir,WriterTests.Digest(ir),f.Resources,cancellationToken:TestContext.Current.CancellationToken);Assert.True(result.Ok,JsonSerializer.Serialize(result.Diagnostics));using var pdf=PdfDocument.Open(result.Bytes!);Assert.Equal(logical,pdf.GetPage(1).Text);
        string directory=Directory.CreateDirectory(Path.Combine(WriterTests.Output,"spacing")).FullName;string name=(logical=="AB"?"spacing-cluster":"spacing-combining")+(semantic?"-semantic":"");
        await File.WriteAllBytesAsync(Path.Combine(directory,name+".pdf"),result.Bytes!,TestContext.Current.CancellationToken);await File.WriteAllBytesAsync(Path.Combine(directory,name+".ir.json"),ir,TestContext.Current.CancellationToken);
    }
    [Theory][InlineData("mixed","o ff","f")][InlineData("mixed-semantic","o ff","f")][InlineData("columns","o f","o f")][InlineData("semantic-runs","o","f")][InlineData("leading","o"," f")][InlineData("trailing","o ","f")]
    public async Task Unsemantic_objects_preserve_only_their_explicit_whitespace(string name,string left,string right)
    {
        var f=await WriterTests.Fixture("truetype");var n=JsonNode.Parse(f.Ir)!;var template=n["pages"]![0]!["objects"]![0]!;var originals=template["glyphs"]!.AsArray();int x=20000;var objects=new JsonArray();
        foreach(var text in new[]{left,right})
        {
            int objectIndex=objects.Count;if((name=="columns"||name=="semantic-runs")&&objectIndex==1)x=100000;
            var obj=template.DeepClone();obj["id"]="p0o"+objectIndex;obj["drawOrder"]=objectIndex;obj["logicalText"]=text;obj["displayText"]=text;var glyphs=new JsonArray();var clusters=new JsonArray();
            for(int i=0;i<text.Length;i++)
            {
                if(name.StartsWith("mixed",StringComparison.Ordinal)&&i==3)x+=40000;
                var glyph=originals[text[i]=='o'?0:text[i]==' '?6:1]!.DeepClone();glyph["clusterId"]=i;glyph["position"]!["x"]=x;x+=glyph["advance"]!["x"]!.GetValue<int>();glyphs.Add(glyph);
                clusters.Add(new JsonObject{["clusterId"]=i,["logicalRange"]=new JsonObject{["start"]=i,["end"]=i+1},["displayRange"]=new JsonObject{["start"]=i,["end"]=i+1},["glyphIndices"]=new JsonArray(i)});
            }
            obj["glyphs"]=glyphs;obj["clusters"]=clusters;objects.Add(obj);
        }
        n["pages"]![0]!["objects"]=objects;n["semantics"]=(name=="semantic-runs"||name=="mixed-semantic")?new JsonArray(new JsonObject{["objectId"]="p0o0",["nodeId"]="same",["readingOrder"]=0},new JsonObject{["objectId"]="p0o1",["nodeId"]="same",["readingOrder"]=1}):new JsonArray();n["markers"]=new JsonArray();using var semanticDoc=JsonDocument.Parse(n["semantics"]!.ToJsonString());n["identity"]!["semanticDigest"]=WriterTests.Digest(Encoding.UTF8.GetBytes(IrValidation.Canonical(semanticDoc.RootElement,false,TestContext.Current.CancellationToken)));using var parsed=JsonDocument.Parse(n.ToJsonString());byte[] ir=Encoding.UTF8.GetBytes(IrValidation.Canonical(parsed.RootElement,false,TestContext.Current.CancellationToken));
        var result=await new PdfIrWriter().WriteAsync(ir,WriterTests.Digest(ir),f.Resources,cancellationToken:TestContext.Current.CancellationToken);Assert.True(result.Ok,JsonSerializer.Serialize(result.Diagnostics));using var pdf=PdfDocument.Open(result.Bytes!);Assert.Equal(left+right,pdf.GetPage(1).Text);
        string directory=Directory.CreateDirectory(Path.Combine(WriterTests.Output,"spacing")).FullName;
        await File.WriteAllBytesAsync(Path.Combine(directory,"spacing-"+name+".pdf"),result.Bytes!,TestContext.Current.CancellationToken);await File.WriteAllBytesAsync(Path.Combine(directory,"spacing-"+name+".ir.json"),ir,TestContext.Current.CancellationToken);
    }
}
