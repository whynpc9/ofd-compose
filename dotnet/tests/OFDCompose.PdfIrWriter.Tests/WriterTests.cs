using System.Security.Cryptography;
using System.Text.Json;
using OFDCompose.PdfIrWriter;
using UglyToad.PdfPig;
using Xunit;
namespace OFDCompose.PdfIrWriter.Tests;
public sealed class WriterTests
{
    internal static string Root { get { var d=new DirectoryInfo(AppContext.BaseDirectory);while(d is not null&&!File.Exists(Path.Combine(d.FullName,"pnpm-workspace.yaml")))d=d.Parent;return d!.FullName; } }
    internal static string Digest(byte[] b)=>Convert.ToHexStringLower(SHA256.HashData(b));
    internal static async Task<(byte[] Ir,List<WriterResource> Resources)> Fixture(string name)
    {
        string path=Path.Combine(Root,"tests/ofd-writer/fixtures",name);byte[] ir=await File.ReadAllBytesAsync(Path.Combine(path,"ir.json"));
        using var m=JsonDocument.Parse(await File.ReadAllBytesAsync(Path.Combine(path,"manifest.json")));var resources=new List<WriterResource>();
        foreach(var r in m.RootElement.GetProperty("resources").EnumerateArray())resources.Add(new(r.GetProperty("resourceId").GetString()!,await File.ReadAllBytesAsync(Path.Combine(path,r.GetProperty("file").GetString()!))));return(ir,resources);
    }
    [Theory]
    [InlineData("truetype")][InlineData("cff")][InlineData("combined")][InlineData("geometry")][InlineData("jpeg")][InlineData("logical-display")][InlineData("multi-glyph")][InlineData("nonidentity-contract")][InlineData("duplicate-markers")][InlineData("glyphless")]
    public async Task Independent_reader_text_geometry_and_determinism(string name)
    {
        var f=await Fixture(name);var writer=new PdfIrWriter();var result=await writer.WriteAsync(f.Ir,Digest(f.Ir),f.Resources,cancellationToken:TestContext.Current.CancellationToken);
        Assert.True(result.Ok,JsonSerializer.Serialize(result.Diagnostics));
        Assert.Equal(result.Bytes,(await new PdfIrWriter().WriteAsync(f.Ir,Digest(f.Ir),f.Resources,cancellationToken:TestContext.Current.CancellationToken)).Bytes);
        string output=Path.Combine(Root,".scratch/issue16-output");Directory.CreateDirectory(output);await File.WriteAllBytesAsync(Path.Combine(output,name+".pdf"),result.Bytes!,TestContext.Current.CancellationToken);
        using var pdf=PdfDocument.Open(result.Bytes!,new ParsingOptions{UseLenientParsing=false});using var ir=JsonDocument.Parse(f.Ir);
        var states=ir.RootElement.GetProperty("graphicsStates").EnumerateArray().ToDictionary(s=>s.GetProperty("id").GetString()!);
        int count=0;double max=0,maxEnd=0;
        foreach(var page in ir.RootElement.GetProperty("pages").EnumerateArray())
        {
            var actual=pdf.GetPage(page.GetProperty("pageIndex").GetInt32()+1);var letters=actual.Letters;int index=0;
            var objects=page.GetProperty("objects").EnumerateArray().ToArray();
            Assert.Equal(string.Concat(objects.Where(o=>o.GetProperty("kind").GetString()=="text").Select(o=>o.GetProperty("logicalText").GetString())),actual.Text);
            foreach(var obj in objects)
            {
                Assert.Contains(obj.GetProperty("id").GetString()!,result.ObjectMap!.Keys);count++;
                if(obj.GetProperty("kind").GetString()!="text")continue;
                var matrix=states[obj.GetProperty("stateId").GetString()!].GetProperty("transform");
                foreach(var g in obj.GetProperty("glyphs").EnumerateArray())
                {
                    double N(JsonElement e,string p)=>e.GetProperty(p).GetDouble();
                    double x=N(g.GetProperty("position"),"x")+N(g.GetProperty("offset"),"x"),y=N(g.GetProperty("position"),"y")+N(g.GetProperty("offset"),"y");
                    double tx=(N(matrix,"a")*x+N(matrix,"c")*y+N(matrix,"e"))*72/25400;
                    double ty=(N(page,"height")-N(matrix,"b")*x-N(matrix,"d")*y-N(matrix,"f"))*72/25400;
                    if(index>=letters.Count && name is "multi-glyph" or "nonidentity-contract") continue;
                    var letter=letters[index++];double dx=Math.Abs(letter.StartBaseLine.X-tx),dy=Math.Abs(letter.StartBaseLine.Y-ty);max=Math.Max(max,Math.Max(dx,dy));
                    Assert.True(dx<0.001&&dy<0.001,$"{name} glyph {index}: {dx},{dy}");
                    double advance=N(g.GetProperty("advance"),"x")*72/25400;
                    double endError=Math.Max(Math.Abs(letter.EndBaseLine.X-(tx+N(matrix,"a")*advance)),Math.Abs(letter.EndBaseLine.Y-(ty-N(matrix,"b")*advance)));
                    maxEnd=Math.Max(maxEnd,endError);
                    // PdfPig constructs this endpoint from CharacterBoundingBox.Width.
                    // Keep an explicit separate extent tolerance; start-position tolerance remains 0.001 pt.
                    Assert.InRange(endError,0,0.01);
                }
            }
            Assert.Equal(letters.Count,index);
        }
        Assert.Equal(count,result.ObjectMap!.Count);
        await File.WriteAllTextAsync(Path.Combine(output,name+"-geometry.json"),JsonSerializer.Serialize(new{Reader="PdfPig 0.1.11",MaxBaselineErrorPt=max,MaxReaderExtentErrorPt=maxEnd}),TestContext.Current.CancellationToken);
    }
    [Fact] public async Task Glyphless_logical_text_is_explicitly_rejected()
    {
        var f=await Fixture("glyphless-logical");var r=await new PdfIrWriter().WriteAsync(f.Ir,Digest(f.Ir),f.Resources,cancellationToken:TestContext.Current.CancellationToken);Assert.False(r.Ok);Assert.Null(r.ObjectMap);Assert.Contains(r.Diagnostics,d=>d.Code=="UNSUPPORTED_FEATURE");
    }
    [Fact] public async Task Budgets_and_digest_fail_atomically()
    {
        var f=await Fixture("truetype");
        foreach(var limits in new[]{new WriterLimits{JsonBytes=1},new WriterLimits{Glyphs=0},new WriterLimits{ResourceBytes=0},new WriterLimits{OutputBytes=100}})
        {var r=await new PdfIrWriter().WriteAsync(f.Ir,Digest(f.Ir),f.Resources,limits,TestContext.Current.CancellationToken);Assert.False(r.Ok);Assert.Null(r.ObjectMap);Assert.Contains(r.Diagnostics,d=>d.Code=="RESOURCE_LIMIT");}
        var bad=await new PdfIrWriter().WriteAsync(f.Ir,new string('0',64),f.Resources,cancellationToken:TestContext.Current.CancellationToken);Assert.False(bad.Ok);Assert.Contains(bad.Diagnostics,d=>d.Code=="IR_DIGEST_MISMATCH");
    }
}
