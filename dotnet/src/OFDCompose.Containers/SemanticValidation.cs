using System.Text.Json;
using System.Xml.Linq;
using static OFDCompose.Containers.ContainerBudget;
using static OFDCompose.Containers.SourceValidation;

namespace OFDCompose.Containers;
internal static class SemanticValidation
{
    private sealed record SourceNode(string Id, string? Binding, string? Control, string? Text, string Repeat);
    private static string? Optional(JsonElement value, string key) => value.TryGetProperty(key,out var field)?field.GetString():null;
    private static string Repeat(JsonElement value, string key) => value.TryGetProperty(key,out var array)
        ? string.Join("",array.EnumerateArray().Select(e=> { string id=Text(e,"nodeId"), k=Text(e,"key"); return id.Length+":"+id+k.Length+":"+k; })) : "";
    internal static void Validate(JsonElement map, JsonElement document, IReadOnlyDictionary<string,string[]> objectMap,
        IReadOnlyDictionary<string,(int Page,string? Text)> objects, ContainerBudget budget)
    {
        var index=new Dictionary<(string Id,string? Binding,string Repeat),List<SourceNode>>();
        void Walk(JsonElement value,string repeat)
        {
            budget.Charge(32);
            if(value.ValueKind==JsonValueKind.Array) { foreach(var child in value.EnumerateArray())Walk(child,repeat);return; }
            if(value.ValueKind!=JsonValueKind.Object)return;
            if(value.TryGetProperty("instancePath",out _)) repeat=Repeat(value,"instancePath");
            string? kind=Optional(value,"kind"), id=Optional(value,"nodeId");
            JsonElement origin=value;
            if(kind=="text" && value.TryGetProperty("origin",out var o)) { origin=o;id=Text(o,"nodeId"); }
            if(id is not null)
            {
                string? text=kind=="text"?Text(value,"text"):null;
                if(kind=="input-control")text=value.TryGetProperty("defaultValue",out var v) ? v.ValueKind==JsonValueKind.String?v.GetString():v.GetBoolean()?"[x]":"[ ]" : Optional(value,"placeholder")??"";
                var key=(id,Optional(origin,"bindingId"),repeat);
                if(!index.TryGetValue(key,out var list)) index[key]=list=[];
                list.Add(new(id,Optional(origin,"bindingId"),Optional(value,"controlId"),text,repeat));
            }
            foreach(var property in value.EnumerateObject())if(property.Name is not "origin" and not "instancePath")Walk(property.Value,repeat);
        }
        Walk(document.GetProperty("body"),"");
        var covered=new HashSet<string>();
        var semantics=map.GetProperty("entries");
        foreach(var decoration in map.GetProperty("decorations").EnumerateArray())
        {
            budget.Charge(32);
            Need(objectMap.ContainsKey(decoration.GetString()!) && covered.Add(decoration.GetString()!),"SEMANTIC_REFERENCE");
        }
        int order=0;
        foreach(var semantic in semantics.EnumerateArray())
        {
            budget.Charge(128);
            string objectId=Text(semantic,"objectId");
            Need(objectMap.TryGetValue(objectId,out var targets) && covered.Add(objectId),"SEMANTIC_REFERENCE");
            Need(semantic.GetProperty("readingOrder").GetInt32()==order++,"SEMANTIC_REFERENCE");
            Need(semantic.TryGetProperty("pageIndex",out var page) && targets!.All(t=>objects[t].Page==page.GetInt32()),"SEMANTIC_REFERENCE");
            string repeat=Repeat(semantic,"repeatInstance");
            bool Source(JsonElement reference,bool checkText)
            {
                string? binding=Optional(reference,"bindingId"),control=Optional(reference,"controlId");
                if(!index.TryGetValue((Text(reference,"nodeId"),binding,repeat),out var candidates))return false;
                budget.Charge(candidates.Count*32L);
                return candidates.Any(c=>c.Repeat==repeat && c.Binding==binding && (control is null||control==c.Control)
                    && (!checkText || c.Text==Text(reference.GetProperty("sourceText"),"text")));
            }
            Need(Source(semantic,semantic.TryGetProperty("sourceText",out _)),"SEMANTIC_SOURCE");
            if(semantic.TryGetProperty("sourceRanges",out var ranges))
            {
                Need(targets!.Length==1 && objects[targets[0]].Text is not null,"SEMANTIC_SOURCE");
                string logical=objects[targets[0]].Text!;
                if(semantic.TryGetProperty("sourceText",out var primary))Need(ranges.GetArrayLength()==1 && JsonElement.DeepEquals(primary,ranges[0].GetProperty("sourceText")),"SEMANTIC_SOURCE");
                int end=0;
                foreach(var range in ranges.EnumerateArray())
                {
                    budget.Charge(64);
                    Need(Source(range,true),"SEMANTIC_SOURCE");
                    var sourceText=range.GetProperty("sourceText");
                    string text=Text(sourceText,"text");
                    var sourceRange=sourceText.GetProperty("range"); var logicalRange=range.GetProperty("logicalRange");
                    int a=sourceRange.GetProperty("start").GetInt32(),b=sourceRange.GetProperty("end").GetInt32();
                    int x=logicalRange.GetProperty("start").GetInt32(),y=logicalRange.GetProperty("end").GetInt32();
                    Need(a>=0 && b>=a && b<=text.Length && x==end && y>=x && y<=logical.Length && b-a==y-x,"SEMANTIC_SOURCE");
                    Need(Boundary(text,a)&&Boundary(text,b)&&Boundary(logical,x)&&Boundary(logical,y),"SEMANTIC_SOURCE");
                    budget.Charge(b-a);Need(text.AsSpan(a,b-a).SequenceEqual(logical.AsSpan(x,y-x)),"SEMANTIC_SOURCE");end=y;
                }
                Need(end==logical.Length,"SEMANTIC_SOURCE");
            }
            else Need(targets!.All(t=>objects[t].Text is null),"SEMANTIC_SOURCE");
        }
        Need(covered.SetEquals(objectMap.Keys),"SEMANTIC_INCOMPLETE");
        // A source-bearing document cannot relabel all output as decoration.
        Need(semantics.GetArrayLength()>0 || !index.Values.SelectMany(v=>v).Any(v=>v.Text is {Length:>0}),"SEMANTIC_INCOMPLETE");
    }
    private static bool Boundary(string text,int offset)=>offset==0||offset==text.Length||!char.IsHighSurrogate(text[offset-1])||!char.IsLowSurrogate(text[offset]);
}
