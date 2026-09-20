using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using OFDCompose.FixedWriting;
using UglyToad.PdfPig;
using Xunit;
namespace OFDCompose.PdfIrWriter.Tests;
public sealed class ReadingOrderTests
{
    [Theory][InlineData(false,false,false,false)][InlineData(false,true,false,false)][InlineData(false,true,true,false)][InlineData(true,false,false,false)][InlineData(true,true,false,false)][InlineData(true,false,true,false)][InlineData(true,true,true,false)][InlineData(true,false,false,true)]
    public async Task Conflicting_text_reading_order_is_a_backend_diagnostic(bool reverse,bool acrossPages,bool repeat,bool nontext)
    {
        var f=await WriterTests.Fixture("truetype");var n=JsonNode.Parse(f.Ir)!;var template=n["pages"]![0]!["objects"]![0]!;var objects=new JsonArray();
        for(int i=0;i<2;i++)
        {
            var obj=template.DeepClone();obj["id"]="p0o"+i;obj["drawOrder"]=i;obj["logicalText"]=i==0?"A":"B";obj["displayText"]=i==0?"A":"B";
            var glyph=obj["glyphs"]![0]!.DeepClone();glyph["clusterId"]=0;glyph["position"]!["x"]=20000+i*10000;obj["glyphs"]=new JsonArray(glyph);
            obj["clusters"]=new JsonArray(new JsonObject{["clusterId"]=0,["logicalRange"]=new JsonObject{["start"]=0,["end"]=1},["displayRange"]=new JsonObject{["start"]=0,["end"]=1},["glyphIndices"]=new JsonArray(0)});objects.Add(obj);
        }
        if(nontext)objects[1]=new JsonObject{["id"]="p0o1",["drawOrder"]=1,["kind"]="path",["coordinateSpace"]="page",["bounds"]=template["bounds"]!.DeepClone(),["stateId"]="s0",["commands"]=new JsonArray(new JsonObject{["op"]="move",["x"]=100,["y"]=100},new JsonObject{["op"]="line",["x"]=200,["y"]=200}),["fill"]=false,["stroke"]=true,["fillRule"]="nonzero"};
        n["pages"]![0]!["objects"]=objects;n["markers"]=new JsonArray();n["semantics"]=new JsonArray(new JsonObject{["objectId"]="p0o1",["nodeId"]="b",["readingOrder"]=0},new JsonObject{["objectId"]="p0o0",["nodeId"]="a",["readingOrder"]=1});
        if(!reverse)n["semantics"]=new JsonArray(new JsonObject{["objectId"]="p0o0",["nodeId"]="a",["readingOrder"]=2},new JsonObject{["objectId"]="p0o1",["nodeId"]="b",["readingOrder"]=9});
        if(repeat)foreach(var sem in n["semantics"]!.AsArray()){sem!["nodeId"]="shared-header";sem["repeatInstance"]=new JsonArray(new JsonObject{["nodeId"]="repeat",["key"]="shared"});}
        if(acrossPages)
        {
            var second=n["pages"]![0]!.DeepClone();second["id"]="p1";second["pageIndex"]=1;var obj=objects[1]!.DeepClone();obj["id"]="p1o0";obj["drawOrder"]=0;second["objects"]=new JsonArray(obj);objects.RemoveAt(1);n["pages"]!.AsArray().Add(second);
            foreach(var sem in n["semantics"]!.AsArray())if(sem!["objectId"]!.GetValue<string>()=="p0o1")sem["objectId"]="p1o0";
        }
        using var semantics=JsonDocument.Parse(n["semantics"]!.ToJsonString());n["identity"]!["semanticDigest"]=WriterTests.Digest(Encoding.UTF8.GetBytes(IrValidation.Canonical(semantics.RootElement,false,TestContext.Current.CancellationToken)));
        using var parsed=JsonDocument.Parse(n.ToJsonString());byte[] ir=Encoding.UTF8.GetBytes(IrValidation.Canonical(parsed.RootElement,false,TestContext.Current.CancellationToken));
        var result=await new PdfIrWriter().WriteAsync(ir,WriterTests.Digest(ir),f.Resources,cancellationToken:TestContext.Current.CancellationToken);
        bool supported=!reverse||nontext;Assert.Equal(supported,result.Ok);
        if(supported){using var pdf=PdfDocument.Open(result.Bytes!);Assert.Equal(nontext?"A":"AB",string.Concat(pdf.GetPages().Select(p=>p.Text)));}
        else{Assert.Null(result.Bytes);Assert.Contains(result.Diagnostics,d=>d.Code=="UNSUPPORTED_FEATURE"&&d.Path==(acrossPages?"p1o0":"p0o1"));}
    }
}
