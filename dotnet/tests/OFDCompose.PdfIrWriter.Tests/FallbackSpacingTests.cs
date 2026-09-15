using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using OFDCompose.FixedWriting;
using UglyToad.PdfPig;
using Xunit;
namespace OFDCompose.PdfIrWriter.Tests;
public sealed class FallbackSpacingTests
{
    [Theory][InlineData("columns","o f","o f")][InlineData("leading","o"," f")][InlineData("trailing","o ","f")]
    public async Task Unsemantic_objects_preserve_only_their_explicit_whitespace(string name,string left,string right)
    {
        var f=await WriterTests.Fixture("truetype");var n=JsonNode.Parse(f.Ir)!;var template=n["pages"]![0]!["objects"]![0]!;var originals=template["glyphs"]!.AsArray();int x=20000;var objects=new JsonArray();
        foreach(var text in new[]{left,right})
        {
            int objectIndex=objects.Count;if(name=="columns"&&objectIndex==1)x=100000;
            var obj=template.DeepClone();obj["id"]="p0o"+objectIndex;obj["drawOrder"]=objectIndex;obj["logicalText"]=text;obj["displayText"]=text;var glyphs=new JsonArray();var clusters=new JsonArray();
            for(int i=0;i<text.Length;i++)
            {
                var glyph=originals[text[i]=='o'?0:text[i]==' '?6:1]!.DeepClone();glyph["clusterId"]=i;glyph["position"]!["x"]=x;x+=glyph["advance"]!["x"]!.GetValue<int>();glyphs.Add(glyph);
                clusters.Add(new JsonObject{["clusterId"]=i,["logicalRange"]=new JsonObject{["start"]=i,["end"]=i+1},["displayRange"]=new JsonObject{["start"]=i,["end"]=i+1},["glyphIndices"]=new JsonArray(i)});
            }
            obj["glyphs"]=glyphs;obj["clusters"]=clusters;objects.Add(obj);
        }
        n["pages"]![0]!["objects"]=objects;n["semantics"]=new JsonArray();n["markers"]=new JsonArray();n["identity"]!["semanticDigest"]=WriterTests.Digest("[]"u8.ToArray());using var parsed=JsonDocument.Parse(n.ToJsonString());byte[] ir=Encoding.UTF8.GetBytes(IrValidation.Canonical(parsed.RootElement,false,TestContext.Current.CancellationToken));
        var result=await new PdfIrWriter().WriteAsync(ir,WriterTests.Digest(ir),f.Resources,cancellationToken:TestContext.Current.CancellationToken);Assert.True(result.Ok,JsonSerializer.Serialize(result.Diagnostics));using var pdf=PdfDocument.Open(result.Bytes!);Assert.Equal(left+right,pdf.GetPage(1).Text);
        string directory=Directory.CreateDirectory(Path.Combine(WriterTests.Output,"spacing")).FullName;
        await File.WriteAllBytesAsync(Path.Combine(directory,"spacing-"+name+".pdf"),result.Bytes!,TestContext.Current.CancellationToken);await File.WriteAllBytesAsync(Path.Combine(directory,"spacing-"+name+".ir.json"),ir,TestContext.Current.CancellationToken);
    }
}
