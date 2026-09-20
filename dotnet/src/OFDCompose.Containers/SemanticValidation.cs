using System.Text.Json;
using System.Xml.Linq;
using static OFDCompose.Containers.ContainerBudget;
using static OFDCompose.Containers.SourceValidation;

namespace OFDCompose.Containers;
internal static class SemanticValidation
{
    private sealed record SourceNode(string Id, string? Binding, string? Control, string? Text, string Repeat, string[]? Images, string Family, bool Renderable);
    private static string? Optional(JsonElement value, string key) => value.TryGetProperty(key,out var field)?field.GetString():null;
    private static string Repeat(JsonElement value, string key) => value.TryGetProperty(key,out var array)
        ? string.Join("",array.EnumerateArray().Select(e=> { string id=Text(e,"nodeId"), k=Text(e,"key"); return id.Length+":"+id+k.Length+":"+k; })) : "";
    internal static void Validate(JsonElement map, JsonElement document, JsonElement resources, JsonElement renderProfile, IReadOnlyDictionary<string,string[]> objectMap,
        IReadOnlyDictionary<string,(int Page,string? Text,string? ImageDigest,string? OriginalFont)> objects, ContainerBudget budget)
    {
        string defaultFamily=Text(renderProfile.GetProperty("layout").GetProperty("defaultStyle"),"fontFamily");
        var sourceFonts=resources.GetProperty("fonts").EnumerateArray().ToArray();
        string StyledFamily(JsonElement value,string inherited)
        {
            if(!value.TryGetProperty("styleId",out var id))return inherited;
            var style=document.GetProperty("styles").GetProperty(id.GetString()!);
            return Optional(style,"fontFamily")??inherited;
        }
        var sourceImages=resources.GetProperty("images").EnumerateArray().ToDictionary(i=>Text(i,"id"),i=>Text(i,"sha256"));
        var imagePositions=new Dictionary<(string Id,string? Binding,string Repeat),int>();
        var index=new Dictionary<(string Id,string? Binding,string Repeat),List<SourceNode>>();
        void Walk(JsonElement value,string repeat,string family)
        {
            budget.Charge(32);
            if(value.ValueKind==JsonValueKind.Array) { foreach(var child in value.EnumerateArray())Walk(child,repeat,family);return; }
            if(value.ValueKind!=JsonValueKind.Object)return;
            if(value.TryGetProperty("instancePath",out _)) repeat=Repeat(value,"instancePath");
            string? kind=Optional(value,"kind"), id=Optional(value,"nodeId");
            if(kind=="paragraph")family=StyledFamily(value,defaultFamily);
            if(kind is "text" or "input-control")family=StyledFamily(value,Optional(value,"styleInheritance")=="explicit"?defaultFamily:family);
            JsonElement origin=value;
            if(kind=="text" && value.TryGetProperty("origin",out var o)) { origin=o;id=Text(o,"nodeId"); }
            if(id is not null)
            {
                string? text=kind=="text"?Text(value,"text"):null;
                if(kind=="input-control")text=value.TryGetProperty("defaultValue",out var v) ? v.ValueKind==JsonValueKind.String?v.GetString():v.GetBoolean()?"[x]":"[ ]" : Optional(value,"placeholder")??"";
                var key=(id,Optional(origin,"bindingId"),repeat);
                if(!index.TryGetValue(key,out var list)) index[key]=list=[];
                string[]? images=kind=="image-binding"?value.GetProperty("sources").EnumerateArray().Select(source=>source.ValueKind==JsonValueKind.String?SourceContainer.InlineImageDigest(source.GetString()!,budget):sourceImages[Text(source,"resourceId")]).ToArray():null;
                bool renderable=kind is "path" or "barcode-binding" or "input-control" || kind=="text" && !string.IsNullOrEmpty(text)
                    || kind=="image-binding" && images!.Length>0
                    || kind=="paragraph" && value.GetProperty("fragments").EnumerateArray().All(f=>Text(f,"kind")=="text"&&Text(f,"text").Length==0);
                list.Add(new(id,Optional(origin,"bindingId"),Optional(value,"controlId"),text,repeat,images,family,renderable));
            }
            foreach(var property in value.EnumerateObject())if(property.Name is not "origin" and not "instancePath")Walk(property.Value,repeat,family);
        }
        Walk(document.GetProperty("body"),"",defaultFamily);
        foreach(var candidates in index.Values)Need(candidates.Count(c=>c.Renderable)<=1,"SEMANTIC_SOURCE_AMBIGUOUS");
        var sourceCovered=new HashSet<SourceNode>();
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
            bool Source(JsonElement reference,bool checkText,string? originalFont=null)
            {
                string? binding=Optional(reference,"bindingId"),control=Optional(reference,"controlId");
                if(!index.TryGetValue((Text(reference,"nodeId"),binding,repeat),out var candidates))return false;
                budget.Charge(candidates.Count*32L);
                var matches=candidates.Where(c=>c.Repeat==repeat && c.Binding==binding && (control is null||control==c.Control)
                    && (!checkText || c.Text==Text(reference.GetProperty("sourceText"),"text"))
                    && (originalFont is null || sourceFonts.Any(f=>Text(f,"family")==c.Family&&Text(f,"sha256")==originalFont))).ToArray();
                foreach(var candidate in matches)if(checkText||candidate.Text is null)sourceCovered.Add(candidate);
                return matches.Length>0;
            }
            Need(Source(semantic,semantic.TryGetProperty("sourceText",out _)),"SEMANTIC_SOURCE");
            var sourceKey=(Text(semantic,"nodeId"),Optional(semantic,"bindingId"),repeat);
            var imageNodes=index[sourceKey].Where(n=>n.Images is not null).ToArray();
            if(imageNodes.Length>0)
            {
                Need(imageNodes.Length==1 && imageNodes[0].Images!.Length>0 && targets!.Length==1,"SEMANTIC_SOURCE");
                var expected=imageNodes[0].Images!;
                int position=imagePositions.GetValueOrDefault(sourceKey);
                Need(objects[targets![0]].ImageDigest==expected[position%expected.Length],"RESOURCE_IMAGE_MISMATCH");
                imagePositions[sourceKey]=position+1;
            }
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
                    Need(Source(range,true,objects[targets![0]].OriginalFont),"FONT_FAMILY_MISMATCH");
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
            else {
                Need(targets!.All(t=>objects[t].Text is null or ""),"SEMANTIC_SOURCE");
                foreach(var target in targets!)Need(Source(semantic,false,objects[target].OriginalFont),"FONT_FAMILY_MISMATCH");
            }
        }
        Need(covered.SetEquals(objectMap.Keys),"SEMANTIC_INCOMPLETE");
        Need(index.Values.SelectMany(c=>c).Where(c=>c.Renderable).All(sourceCovered.Contains),"SEMANTIC_INCOMPLETE");
        var decorationIds=map.GetProperty("decorations").EnumerateArray().Select(e=>e.GetString()!).ToHashSet();
        var watermarkIds=new HashSet<string>();
        foreach(var watermark in map.GetProperty("watermarks").EnumerateArray())
        {
            budget.Charge(128);
            string id=Text(watermark,"objectId");
            Need(watermarkIds.Add(id)&&decorationIds.Contains(id)&&objectMap.TryGetValue(id,out _),"SEMANTIC_REFERENCE");
            var origin=Pointer(document,Text(watermark,"pointer"),budget);
            Need(Text(origin,"kind")=="image"&&sourceImages.TryGetValue(Text(origin,"resourceId"),out _),"SEMANTIC_SOURCE");
            string digest=sourceImages[Text(origin,"resourceId")];
            Need(objectMap[id].Length==1&&objects[objectMap[id][0]].ImageDigest==digest,"RESOURCE_IMAGE_MISMATCH");
        }
        Need(decorationIds.Where(id=>objectMap[id].Any(target=>objects[target].ImageDigest is not null)).All(watermarkIds.Contains),"SEMANTIC_INCOMPLETE");
        // A source-bearing document cannot relabel all output as decoration.
        Need(semantics.GetArrayLength()>0 || !index.Values.SelectMany(v=>v).Any(v=>v.Text is {Length:>0}),"SEMANTIC_INCOMPLETE");
    }
    private static JsonElement Pointer(JsonElement root,string pointer,ContainerBudget budget)
    {
        Need(pointer.Length is >0 and <=2048 && pointer[0]=='/',"SEMANTIC_SOURCE");
        var value=root;
        foreach(var encoded in pointer[1..].Split('/'))
        {
            budget.Charge(encoded.Length+32);
            string key=encoded.Replace("~1","/",StringComparison.Ordinal).Replace("~0","~",StringComparison.Ordinal);
            if(value.ValueKind==JsonValueKind.Array)
            {
                Need(int.TryParse(key,System.Globalization.NumberStyles.None,System.Globalization.CultureInfo.InvariantCulture,out int index)&&index>=0&&index<value.GetArrayLength()&&key==index.ToString(System.Globalization.CultureInfo.InvariantCulture),"SEMANTIC_SOURCE");
                value=value[index];
            }
            else {Need(value.ValueKind==JsonValueKind.Object&&value.TryGetProperty(key,out _),"SEMANTIC_SOURCE");value=value.GetProperty(key);}
        }
        return value;
    }
    private static bool Boundary(string text,int offset)=>offset==0||offset==text.Length||!char.IsHighSurrogate(text[offset-1])||!char.IsLowSurrogate(text[offset]);
}
