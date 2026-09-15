using OFDCompose.FixedWriting;
using System.Text.Json.Nodes;
using System.Globalization;
using System.Security.Cryptography;
using System.IO.Compression;
using System.Text;
using System.Text.RegularExpressions;
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
        if(name=="visible-image")
        {
            var source=await Fixture("geometry");byte[] image=await File.ReadAllBytesAsync(Path.Combine(Root,"tests/pdf-writer/fixtures/visible-rgba.png"));
            var node=JsonNode.Parse(source.Ir)!;node["resources"]![0]!["digest"]=Digest(image);node["resources"]![0]!["pixelWidth"]=2;node["resources"]![0]!["pixelHeight"]=2;
            using var parsed=JsonDocument.Parse(node.ToJsonString());byte[] canonical=Encoding.UTF8.GetBytes(IrValidation.Canonical(parsed.RootElement));
            return(canonical,source.Resources.Select(r=>r.ResourceId=="r0"?new WriterResource("r0",image):r).ToList());
        }
        string path=Path.Combine(Root,"tests/ofd-writer/fixtures",name);byte[] ir=await File.ReadAllBytesAsync(Path.Combine(path,"ir.json"));
        using var m=JsonDocument.Parse(await File.ReadAllBytesAsync(Path.Combine(path,"manifest.json")));var resources=new List<WriterResource>();
        foreach(var r in m.RootElement.GetProperty("resources").EnumerateArray())resources.Add(new(r.GetProperty("resourceId").GetString()!,await File.ReadAllBytesAsync(Path.Combine(path,r.GetProperty("file").GetString()!))));return(ir,resources);
    }
    [Theory]
    [InlineData("visible-image")][InlineData("truetype")][InlineData("cff")][InlineData("combined")][InlineData("geometry")][InlineData("jpeg")][InlineData("multi-glyph")][InlineData("nonidentity-contract")][InlineData("duplicate-markers")][InlineData("glyphless")]
    public async Task Independent_reader_text_geometry_and_determinism(string name)
    {
        var f=await Fixture(name);var writer=new PdfIrWriter();var result=await writer.WriteAsync(f.Ir,Digest(f.Ir),f.Resources,cancellationToken:TestContext.Current.CancellationToken);
        Assert.True(result.Ok,JsonSerializer.Serialize(result.Diagnostics));
        Assert.True(result.Bytes!.AsSpan().StartsWith(new byte[]{37,80,68,70,45,49,46,55,10,37,226,227,207,211,10}));
        string wire=Encoding.Latin1.GetString(result.Bytes!);
        foreach(Match font in Regex.Matches(wire,@"/BaseFont /([^ ]+)"))Assert.Matches(@"^[A-Z]{6}\+",font.Groups[1].Value);
        var streams=new List<byte[]>();
        foreach(Match streamMatch in Regex.Matches(wire,@"<< /Length (\d+)[^\n]* >>\nstream\n"))
        {
            byte[] payload=result.Bytes.AsSpan(streamMatch.Index+streamMatch.Length,int.Parse(streamMatch.Groups[1].Value,CultureInfo.InvariantCulture)).ToArray();
            if(streamMatch.Value.Contains("/FlateDecode",StringComparison.Ordinal))
            {using var input=new MemoryStream(payload);using var z=new ZLibStream(input,CompressionMode.Decompress);using var decoded=new MemoryStream();z.CopyTo(decoded);payload=decoded.ToArray();}
            streams.Add(payload);
        }
        foreach(var resource in f.Resources.Where(r=>!r.Bytes.Span.StartsWith(new byte[]{137,80,78,71})))
            Assert.Contains(streams,b=>b.AsSpan().SequenceEqual(resource.Bytes.Span));
        Assert.Equal(result.Bytes,(await new PdfIrWriter().WriteAsync(f.Ir,Digest(f.Ir),f.Resources,cancellationToken:TestContext.Current.CancellationToken)).Bytes);
        string output=Path.Combine(Root,".scratch/issue16-output");Directory.CreateDirectory(output);await File.WriteAllBytesAsync(Path.Combine(output,name+".pdf"),result.Bytes!,TestContext.Current.CancellationToken);
        if(name=="visible-image")await File.WriteAllBytesAsync(Path.Combine(output,name+".ir.json"),f.Ir,TestContext.Current.CancellationToken);
        using var pdf=PdfDocument.Open(result.Bytes!,new ParsingOptions{UseLenientParsing=false});using var ir=JsonDocument.Parse(f.Ir);
        var states=ir.RootElement.GetProperty("graphicsStates").EnumerateArray().ToDictionary(s=>s.GetProperty("id").GetString()!);
        int count=0;double max=0,maxEnd=0,maxImage=0;
        foreach(var page in ir.RootElement.GetProperty("pages").EnumerateArray())
        {
            var actual=pdf.GetPage(page.GetProperty("pageIndex").GetInt32()+1);var letters=actual.Letters;int index=0;
            var objects=page.GetProperty("objects").EnumerateArray().ToArray();
            var images=actual.GetImages().ToArray();int imageIndex=0;
            Assert.Equal(string.Concat(objects.Where(o=>o.GetProperty("kind").GetString()=="text").Select(o=>o.GetProperty("logicalText").GetString())),actual.Text);
            foreach(var obj in objects)
            {
                Assert.Contains(obj.GetProperty("id").GetString()!,result.ObjectMap!.Keys);count++;
                if(obj.GetProperty("kind").GetString()=="image")
                {
                    var image=images[imageIndex++];var resource=ir.RootElement.GetProperty("resources").EnumerateArray().Single(r=>r.GetProperty("id").GetString()==obj.GetProperty("resourceId").GetString());
                    Assert.Equal(resource.GetProperty("pixelWidth").GetInt32(),image.WidthInSamples);Assert.Equal(resource.GetProperty("pixelHeight").GetInt32(),image.HeightInSamples);
                    var state=states[obj.GetProperty("stateId").GetString()!].GetProperty("transform");var placement=obj.GetProperty("transform");
                    double N(JsonElement e,string p)=>e.GetProperty(p).GetDouble();
                    (double X,double Y) Point(double pixelX,double pixelY)
                    {
                        // Canonical translation is um; linear image terms retain mm per pixel.
                        double x=1000*(N(placement,"a")*pixelX+N(placement,"c")*pixelY)+N(placement,"e");
                        double y=1000*(N(placement,"b")*pixelX+N(placement,"d")*pixelY)+N(placement,"f");
                        return ((N(state,"a")*x+N(state,"c")*y+N(state,"e"))*72/25400,
                            (N(page,"height")-N(state,"b")*x-N(state,"d")*y-N(state,"f"))*72/25400);
                    }
                    var expected=new[]{Point(0,0),Point(image.WidthInSamples,0),Point(0,image.HeightInSamples),Point(image.WidthInSamples,image.HeightInSamples)};
                    var corners=new[]{image.Bounds.TopLeft,image.Bounds.TopRight,image.Bounds.BottomLeft,image.Bounds.BottomRight};
                    for(int i=0;i<4;i++)
                    {
                        double error=Math.Max(Math.Abs(corners[i].X-expected[i].X),Math.Abs(corners[i].Y-expected[i].Y));
                        maxImage=Math.Max(maxImage,error);Assert.InRange(error,0,0.001);
                    }
                }
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
            Assert.Equal(letters.Count,index);Assert.Equal(images.Length,imageIndex);
        }
        Assert.Equal(count,result.ObjectMap!.Count);
        await File.WriteAllTextAsync(Path.Combine(output,name+"-geometry.json"),JsonSerializer.Serialize(new{Reader="PdfPig 0.1.11",MaxBaselineErrorPt=max,MaxReaderExtentErrorPt=maxEnd,MaxImageCornerErrorPt=maxImage}),TestContext.Current.CancellationToken);
    }
    [Fact] public async Task Control_whitespace_prefix_mixed_with_printable_mapping_is_rejected()
    {
        var f=await Fixture("logical-display");var r=await new PdfIrWriter().WriteAsync(f.Ir,Digest(f.Ir),f.Resources,cancellationToken:TestContext.Current.CancellationToken);
        Assert.False(r.Ok);Assert.Null(r.ObjectMap);Assert.Contains(r.Diagnostics,d=>d.Code=="UNSUPPORTED_FEATURE"&&d.Path=="p0o0");
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
