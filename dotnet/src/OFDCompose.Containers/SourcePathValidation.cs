using System.Globalization;
using System.Text.Json;
using System.Xml.Linq;
using static OFDCompose.Containers.ContainerBudget;
using static OFDCompose.Containers.SourceValidation;

namespace OFDCompose.Containers;

// Validates local shape and paint. This is not a second layout engine or a proof of page placement.
internal sealed class SourcePathValidation(BarcodeGeometryResolver? resolver,ContainerBudget budget)
{
    private readonly Dictionary<string,JsonElement> barcodeCommands = new();
    internal void Validate(JsonElement source,XElement actual)
    {
        Need(actual.Name==SafePackage.Ns+"PathObject","SEMANTIC_SOURCE");
        bool barcode=Text(source,"kind")=="barcode-binding";
        JsonElement commands;
        if(barcode)
        {
            Need(resolver is not null,"BARCODE_VERIFIER_REQUIRED");
            string value=Text(source,"value");
            var options=source.GetProperty("options");
            Need(value.Length is >0 and <=2048 && options.GetRawText().Length<=4096,"SIZE_LIMIT");
            string key=value.Length+":"+value+options.GetRawText();
            budget.Charge(key.Length*4L);
            if(!barcodeCommands.TryGetValue(key,out commands))
            {
                Need(barcodeCommands.Count<256,"SIZE_LIMIT");
                budget.Charge(10000L+value.Length*value.Length*16L);
                var request=new BarcodeGeometryRequest("bwip-js@4.11.4/drawing-context@1",value,Bytes(options,budget));
                ReadOnlyMemory<byte> generated;
                try { generated=resolver!(request,budget.Token); }
                catch(OperationCanceledException) { throw; }
                catch(Exception) { throw new ContainerFailure("BARCODE_VERIFICATION_FAILED"); }
                budget.Charge(0);
                Need(generated.Length is >0 and <=2*1024*1024,"BARCODE_VERIFICATION_FAILED");
                using var parsed=SafePackage.Json(generated,budget);
                budget.Charge(generated.Length*4L);
                commands=parsed.RootElement.Clone();
                barcodeCommands.Add(key,commands);
            }
        }
        else commands=source.GetProperty("commands");
        Need(commands.ValueKind==JsonValueKind.Array && commands.GetArrayLength() is >0 and <=100000,"SEMANTIC_SOURCE");
        string data=actual.Element(SafePackage.Ns+"AbbreviatedData")!.Value;
        budget.Charge(data.Length*4L+commands.GetArrayLength()*64L);
        var tokens=data.Split(' ',StringSplitOptions.RemoveEmptyEntries);int offset=0;
        foreach(var command in commands.EnumerateArray())
        {
            budget.Charge(64);
            string op=Text(command,"op");
            string[] fields=op switch {"move" or "line"=>["x","y"],"cubic"=>["x1","y1","x2","y2","x","y"],"close"=>[],_=>throw new ContainerFailure("SEMANTIC_SOURCE")};
            Need(offset<tokens.Length&&tokens[offset++]==(op switch {"move"=>"M","line"=>"L","cubic"=>"B",_=>"C"}),"SEMANTIC_SOURCE");
            foreach(string field in fields)
            {
                Need(offset<tokens.Length,"SEMANTIC_SOURCE");
                Need(decimal.TryParse(tokens[offset++],NumberStyles.Float,CultureInfo.InvariantCulture,out decimal coordinate),"SEMANTIC_SOURCE");
                Need(command.TryGetProperty(field,out var number)&&number.ValueKind==JsonValueKind.Number,"SEMANTIC_SOURCE");
                decimal sourceNumber=number.GetDecimal();
                Need(Math.Abs(sourceNumber)<=1000000 && coordinate==Mm(sourceNumber),"SEMANTIC_SOURCE");
            }
        }
        Need(offset==tokens.Length,"SEMANTIC_SOURCE");
        bool fill=barcode||source.TryGetProperty("fill",out _),stroke=!barcode&&source.TryGetProperty("stroke",out _);
        Need((string?)actual.Attribute("Fill")==fill.ToString().ToLowerInvariant()&&(string?)actual.Attribute("Stroke")==stroke.ToString().ToLowerInvariant(),"SEMANTIC_SOURCE");
        string rule=!barcode&&source.TryGetProperty("fillRule",out var r)&&r.GetString()=="evenodd"?"Even-Odd":"NonZero";
        Need((string?)actual.Attribute("Rule")==rule,"SEMANTIC_SOURCE");
        if(fill)Color(actual,"FillColor",barcode?"#000000":Text(source,"fill"));
        if(stroke)
        {
            var pen=source.GetProperty("stroke");Color(actual,"StrokeColor",Text(pen,"color"));
            Need(decimal.Parse((string)actual.Attribute("LineWidth")!,CultureInfo.InvariantCulture)==Mm(pen.GetProperty("width").GetDecimal()),"SEMANTIC_SOURCE");
            string cap=pen.TryGetProperty("cap",out var c)?c.GetString()!:"butt",join=pen.TryGetProperty("join",out var j)?j.GetString()!:"miter";
            Need((string?)actual.Attribute("Cap")==Capitalize(cap)&&(string?)actual.Attribute("Join")==Capitalize(join),"SEMANTIC_SOURCE");
            decimal miter=pen.TryGetProperty("miterLimit",out var m)?m.GetDecimal():10;
            Need(decimal.Parse((string)actual.Attribute("MiterLimit")!,CultureInfo.InvariantCulture)==miter,"SEMANTIC_SOURCE");
            var dash=pen.TryGetProperty("dash",out var d)?d.EnumerateArray().Select(n=>Mm(n.GetDecimal())).ToArray():[];
            var emitted=((string?)actual.Attribute("DashPattern")??"").Split(' ',StringSplitOptions.RemoveEmptyEntries).Select(n=>decimal.Parse(n,CultureInfo.InvariantCulture));
            Need(dash.SequenceEqual(emitted),"SEMANTIC_SOURCE");
            if(dash.Length>0)Need(decimal.Parse((string)actual.Attribute("DashOffset")!,CultureInfo.InvariantCulture)==Mm(pen.TryGetProperty("dashOffset",out var o)?o.GetDecimal():0),"SEMANTIC_SOURCE");
        }
    }
    private static decimal Mm(decimal value)=>decimal.Round(value,3,MidpointRounding.AwayFromZero);
    private static string Capitalize(string value)=>char.ToUpperInvariant(value[0])+value[1..];
    private static void Color(XElement node,string element,string hex)
    {
        string expected=string.Join(" ",new[]{1,3,5}.Select(i=>int.Parse(hex.AsSpan(i,2),NumberStyles.HexNumber,CultureInfo.InvariantCulture)));
        Need((string?)node.Element(SafePackage.Ns+element)?.Attribute("Value")==expected,"SEMANTIC_SOURCE");
    }
}
