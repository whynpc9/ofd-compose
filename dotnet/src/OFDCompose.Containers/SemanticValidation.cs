using System.Text.Json;
using System.Xml.Linq;
using static OFDCompose.Containers.ContainerBudget;
using static OFDCompose.Containers.SourceValidation;

namespace OFDCompose.Containers;
internal sealed record RenderedObject(int Page,int Order,string? Text,string? ImageDigest,string? OriginalFont,XElement Xml);
internal static class SemanticValidation
{
    private sealed record SourceFace(string Family,int Weight,bool Italic);
    private sealed record TableMembership(string Pointer,bool Header,bool Repeat);
    private sealed record SourceSection(string Pointer,HashSet<int> Pages);
    private sealed record SourceNode(string Id, string? Binding, string? Control, string? Text, string Repeat, string[]? Images, SourceFace Face, bool Renderable, JsonElement Value, int Ordinal, int Section, TableMembership[] Tables);
    private static string? Optional(JsonElement value, string key) => value.TryGetProperty(key,out var field)?field.GetString():null;
    private static string Repeat(JsonElement value, string key) => value.TryGetProperty(key,out var array)
        ? string.Join("",array.EnumerateArray().Select(e=> { string id=Text(e,"nodeId"), k=Text(e,"key"); return id.Length+":"+id+k.Length+":"+k; })) : "";
    internal static void Validate(JsonElement map, JsonElement document, JsonElement resources, JsonElement renderProfile, IReadOnlyDictionary<string,string[]> objectMap,
        IReadOnlyDictionary<string,RenderedObject> objects, int pageCount, ContainerBudget budget, BarcodeGeometryResolver? barcodeGeometryResolver, NumberingLabelsResolver? numberingLabelsResolver,IReadOnlyDictionary<(int Page,string Pointer),string> bandLabels)
    {
        var defaultStyle=renderProfile.GetProperty("layout").GetProperty("defaultStyle");
        var defaultFace=ApplyStyle(defaultStyle,new(Text(defaultStyle,"fontFamily"),400,false));
        var sourceFonts=resources.GetProperty("fonts").EnumerateArray().ToArray();
        SourceFace ApplyStyle(JsonElement style,SourceFace inherited)=>new(Optional(style,"fontFamily")??inherited.Family,
            style.TryGetProperty("bold",out var bold)?bold.GetBoolean()?700:400:inherited.Weight,
            style.TryGetProperty("italic",out var italic)?italic.GetBoolean():inherited.Italic);
        SourceFace StyledFace(JsonElement value,SourceFace inherited)=>value.TryGetProperty("styleId",out var id)?ApplyStyle(document.GetProperty("styles").GetProperty(id.GetString()!),inherited):inherited;
        bool MatchesFace(SourceFace face,string digest)=>sourceFonts.Any(font=>Text(font,"family")==face.Family&&font.GetProperty("weight").GetInt32()==face.Weight&&font.GetProperty("italic").GetBoolean()==face.Italic&&Text(font,"sha256")==digest);
        var sourceImages=resources.GetProperty("images").EnumerateArray().ToDictionary(i=>Text(i,"id"),i=>Text(i,"sha256"));
        var paths=new SourcePathValidation(barcodeGeometryResolver,budget);
        var imagePositions=new Dictionary<(string Id,string? Binding,string Repeat),int>();
        var index=new Dictionary<(string Id,string? Binding,string Repeat),List<SourceNode>>();
        int sourceOrdinal=0;
        var sections=new List<SourceSection>{new("/settings/page",[])};
        var tablePages=new Dictionary<string,HashSet<int>>();
        var tableBodyPages=new Dictionary<string,HashSet<int>>();
        var atomicCounts=new Dictionary<SourceNode,Dictionary<int,int>>();
        var numbered=new List<(string Pointer,JsonElement Source,SourceFace Face)>();
        void Walk(JsonElement value,string repeat,SourceFace face,string pointer,int section,TableMembership[] tables)
        {
            budget.Charge(32);
            if(value.ValueKind==JsonValueKind.Array) { int i=0;foreach(var child in value.EnumerateArray())Walk(child,repeat,face,pointer+"/"+i++,section,tables);return; }
            if(value.ValueKind!=JsonValueKind.Object)return;
            if(value.TryGetProperty("instancePath",out _)) repeat=Repeat(value,"instancePath");
            string? kind=Optional(value,"kind"), id=Optional(value,"nodeId");
            if(kind=="paragraph")
            {
                var inherited=value.TryGetProperty("layout",out var layout)&&Optional(layout,"role")=="heading"?defaultFace with {Weight=700}:defaultFace;
                face=StyledFace(value,inherited);
                if(value.TryGetProperty("layout",out layout)&&layout.TryGetProperty("numbering",out _))numbered.Add((pointer,value,face));
            }
            if(kind is "text" or "input-control")face=StyledFace(value,Optional(value,"styleInheritance")=="explicit"?defaultFace:face);
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
                list.Add(new(id,Optional(origin,"bindingId"),Optional(value,"controlId"),text,repeat,images,face,renderable,value,sourceOrdinal++,section,tables));
            }
            foreach(var property in value.EnumerateObject())if(property.Name is not "origin" and not "instancePath")
            {
                string childPointer=pointer+"/"+property.Name.Replace("~","~0",StringComparison.Ordinal).Replace("/","~1",StringComparison.Ordinal);
                if(kind=="table"&&property.Name=="rows")
                {
                    int headers=value.TryGetProperty("layout",out var tableLayout)&&tableLayout.TryGetProperty("headerRows",out var h)?h.GetInt32():0;
                    bool replay=value.TryGetProperty("layout",out tableLayout)&&tableLayout.TryGetProperty("repeatHeader",out var r)&&r.GetBoolean();
                    int row=0;foreach(var child in property.Value.EnumerateArray())
                    {budget.Charge(tables.Length*32L+64);Walk(child,repeat,face,childPointer+"/"+row,section,[..tables,new(pointer,row<headers,replay)]);row++;}
                }
                else Walk(property.Value,repeat,face,childPointer,section,tables);
            }
        }
        int blockIndex=0,currentSection=0;
        foreach(var block in document.GetProperty("body").EnumerateArray())
        {
            string pointer="/body/"+blockIndex;
            if(Optional(block,"kind")=="paragraph"&&block.TryGetProperty("layout",out var layout)&&layout.TryGetProperty("section",out _))
            {
                var section=new SourceSection(pointer+"/layout/section/page",[]);
                if(blockIndex==0)sections[0]=section;else {currentSection=sections.Count;sections.Add(section);}
            }
            Walk(block,"",defaultFace,pointer,currentSection,[]);blockIndex++;
        }
        var labels=SourceNumberingValidation.Resolve(numbered.Select(n=>n.Source).ToArray(),numberingLabelsResolver,budget);
        var listLabels=numbered.Select((n,i)=>(n.Pointer,Label:labels[i],n.Face)).ToDictionary(n=>n.Pointer,n=>(Text:n.Label,n.Face));
        foreach(var candidates in index.Values)Need(candidates.Count(c=>c.Renderable)<=1,"SEMANTIC_SOURCE_AMBIGUOUS");
        var emptyAnchorCache=new Dictionary<SourceNode,bool>();
        bool EmptyAnchor(SourceNode node)
        {
            if(emptyAnchorCache.TryGetValue(node,out bool allowed))return allowed;
            budget.Charge(64);
            string? kind=Optional(node.Value,"kind");
            if(node.Text==""||kind=="paragraph"&&node.Renderable)allowed=true;
            else if(kind=="table-cell")allowed=!node.Value.GetProperty("blocks").EnumerateArray().Any(block=>Paints(block,budget));
            else if(kind=="paragraph")
            {
                var fragments=node.Value.GetProperty("fragments");
                for(int i=fragments.GetArrayLength()-1;i>=0;i--)
                {
                    budget.Charge(64);var fragment=fragments[i];var origin=fragment.TryGetProperty("origin",out var o)?o:fragment;
                    if(!index.TryGetValue((Text(origin,"nodeId"),Optional(origin,"bindingId"),node.Repeat),out var candidates))break;
                    string? text=candidates.FirstOrDefault(c=>c.Value.Equals(fragment))?.Text;
                    if(string.IsNullOrEmpty(text))continue;
                    allowed=text[^1] is '\r' or '\n' or '\u2028' or '\u2029';break;
                }
            }
            emptyAnchorCache[node]=allowed;return allowed;
        }
        var sourceCovered=new HashSet<SourceNode>();
        int lastSourceOrdinal=-1;
        void Cover(SourceNode node)
        {
            if(sourceCovered.Add(node)&&node.Renderable)
            {
                Need(node.Ordinal>lastSourceOrdinal,"SEMANTIC_ORDER");
                lastSourceOrdinal=node.Ordinal;
            }
        }
        var textCoverage=new Dictionary<SourceNode,List<(int Start,int End,int Page)>>();
        var covered=new HashSet<string>();
        var semantics=map.GetProperty("entries");
        foreach(var decoration in map.GetProperty("decorations").EnumerateArray())
        {
            budget.Charge(32);
            Need(objectMap.ContainsKey(decoration.GetString()!) && covered.Add(decoration.GetString()!),"SEMANTIC_REFERENCE");
        }
        int order=0,lastPage=-1,lastObjectOrder=-1;
        foreach(var semantic in semantics.EnumerateArray())
        {
            budget.Charge(128);
            string objectId=Text(semantic,"objectId");
            Need(objectMap.TryGetValue(objectId,out var targets) && covered.Add(objectId),"SEMANTIC_REFERENCE");
            Need(semantic.GetProperty("readingOrder").GetInt32()==order++,"SEMANTIC_REFERENCE");
            Need(semantic.TryGetProperty("pageIndex",out var page) && targets!.All(t=>objects[t].Page==page.GetInt32()),"SEMANTIC_REFERENCE");
            foreach(var target in targets!)
            {
                var actual=objects[target];
                Need(actual.Page>lastPage||actual.Page==lastPage&&actual.Order>lastObjectOrder,"SEMANTIC_ORDER");
                lastPage=actual.Page;lastObjectOrder=actual.Order;
            }
            string repeat=Repeat(semantic,"repeatInstance");
            bool Source(JsonElement reference,bool checkText,string? originalFont=null,int? start=null,int? end=null)
            {
                string? binding=Optional(reference,"bindingId"),control=Optional(semantic,"controlId");
                if(!index.TryGetValue((Text(reference,"nodeId"),binding,repeat),out var candidates))return false;
                budget.Charge(candidates.Count*32L);
                var matches=candidates.Where(c=>c.Repeat==repeat && c.Binding==binding && control==c.Control
                    && targets!.All(target=>PhysicalKind(c,objects[target]))
                    && (!checkText || c.Text==Text(reference.GetProperty("sourceText"),"text"))
                    && (originalFont is null || MatchesFace(c.Face,originalFont))).ToArray();
                foreach(var candidate in matches)
                {
                    int actualPage=page.GetInt32();sections[candidate.Section].Pages.Add(actualPage);
                    foreach(var membership in candidate.Tables)
                    {
                        budget.Charge(32);
                        if(!tablePages.TryGetValue(membership.Pointer,out var pages))tablePages[membership.Pointer]=pages=[];
                        pages.Add(actualPage);
                        if(!membership.Header)
                        {if(!tableBodyPages.TryGetValue(membership.Pointer,out var bodyPages))tableBodyPages[membership.Pointer]=bodyPages=[];bodyPages.Add(actualPage);}
                    }
                    if(candidate.Text is null)Cover(candidate);
                    if(start is not null && end is not null)
                    {
                        if(!textCoverage.TryGetValue(candidate,out var intervals))textCoverage[candidate]=intervals=[];
                        intervals.Add((start.Value,end.Value,page.GetInt32()));
                        Cover(candidate);
                    }
                }
                return matches.Length>0;
            }
            Need(Source(semantic,semantic.TryGetProperty("sourceText",out _)),"SEMANTIC_SOURCE");
            var sourceKey=(Text(semantic,"nodeId"),Optional(semantic,"bindingId"),repeat);
            foreach(var atomic in index[sourceKey].Where(n=>Optional(n.Value,"kind") is "image-binding" or "path" or "barcode-binding"))
            {
                if(!atomicCounts.TryGetValue(atomic,out var counts))atomicCounts[atomic]=counts=[];
                counts[page.GetInt32()]=counts.GetValueOrDefault(page.GetInt32())+1;
            }
            var imageNodes=index[sourceKey].Where(n=>n.Images is not null).ToArray();
            if(imageNodes.Length>0)
            {
                Need(imageNodes.Length==1 && imageNodes[0].Images!.Length>0 && targets!.Length==1,"SEMANTIC_SOURCE");
                var expected=imageNodes[0].Images!;
                int position=imagePositions.GetValueOrDefault(sourceKey);
                Need(objects[targets![0]].ImageDigest==expected[position%expected.Length],"RESOURCE_IMAGE_MISMATCH");
                imagePositions[sourceKey]=position+1;
            }
            var pathNodes=index[sourceKey].Where(n=>Optional(n.Value,"kind") is "path" or "barcode-binding").ToArray();
            foreach(var candidate in pathNodes)
            {
                Need(targets!.Length==1,"SEMANTIC_SOURCE");
                paths.Validate(candidate.Value,objects[targets[0]].Xml);
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
                    Need(Source(range,true,objects[targets![0]].OriginalFont,a,b),"SEMANTIC_SOURCE");
                }
                Need(end==logical.Length,"SEMANTIC_SOURCE");
            }
            else {
                bool atomic=imageNodes.Length>0||pathNodes.Length>0;
                Need(targets!.All(t=>atomic?objects[t].Text is null:objects[t].Text==""),"SEMANTIC_SOURCE");
                if(!atomic)
                {
                    var anchors=index[sourceKey].Where(EmptyAnchor).ToArray();
                    Need(anchors.Length==1,"SEMANTIC_SOURCE");
                    if(!atomicCounts.TryGetValue(anchors[0],out var counts))atomicCounts[anchors[0]]=counts=[];
                    counts[page.GetInt32()]=counts.GetValueOrDefault(page.GetInt32())+1;
                }
                foreach(var target in targets!)Need(Source(semantic,false,objects[target].OriginalFont),"FONT_FAMILY_MISMATCH");
            }
        }
        Need(covered.SetEquals(objectMap.Keys),"SEMANTIC_INCOMPLETE");
        Need(index.Values.SelectMany(c=>c).Where(c=>c.Renderable).All(sourceCovered.Contains),"SEMANTIC_INCOMPLETE");
        HashSet<int>? ReplayPages(SourceNode node)
        {
            var replay=node.Tables.FirstOrDefault(t=>t.Header&&t.Repeat);
            if(replay is null)return null;
            var pages=tableBodyPages.GetValueOrDefault(replay.Pointer);
            if(pages is null||pages.Count==0){pages=tablePages[replay.Pointer];Need(pages.Count==1,"SEMANTIC_CARDINALITY");}
            return pages;
        }
        foreach(var (node,counts) in atomicCounts)
        {
            int expected=node.Images?.Length??1;
            var pages=ReplayPages(node);
            if(pages is null){Need(counts.Values.Sum()>=expected,"SEMANTIC_INCOMPLETE");Need(counts.Values.Sum()==expected,"SEMANTIC_CARDINALITY");}
            else Need(counts.Keys.ToHashSet().SetEquals(pages)&&counts.Values.All(count=>count==expected),"SEMANTIC_CARDINALITY");
        }
        foreach(var node in index.Values.SelectMany(c=>c).Where(c=>c.Renderable && c.Text is not null))
        {
            Need(textCoverage.TryGetValue(node,out var intervals),"SEMANTIC_INCOMPLETE");
            budget.Charge(intervals!.Count*32L*(1+(int)Math.Log2(Math.Max(1,intervals.Count))));
            var pages=ReplayPages(node);
            if(pages is not null)Need(intervals.Select(i=>i.Page).ToHashSet().SetEquals(pages),"SEMANTIC_CARDINALITY");
            var groups=pages is null?[intervals]:intervals.GroupBy(i=>i.Page).Select(g=>g.ToList()).ToArray();
            foreach(var group in groups)
            {
                group.Sort((a,b)=>a.Start!=b.Start?a.Start.CompareTo(b.Start):a.End.CompareTo(b.End));
                int end=0;
                foreach(var interval in group)
                {Need(interval.Start>=end,"SEMANTIC_CARDINALITY");Need(interval.Start==end,"SEMANTIC_INCOMPLETE");end=interval.End;}
                Need(end==node.Text!.Length,"SEMANTIC_INCOMPLETE");
                if(node.Text.Length==0)Need(group.Count==1,"SEMANTIC_CARDINALITY");
            }
        }
        var decorationIds=map.GetProperty("decorations").EnumerateArray().Select(e=>e.GetString()!).ToHashSet();
        var generatedIds=new HashSet<string>();
        var generated=new Dictionary<(int Page,string Pointer),List<(RenderedObject Object,int SectionPage)>>();
        foreach(var witness in map.GetProperty("pageDecorations").EnumerateArray())
        {
            budget.Charge(128);
            string id=Text(witness,"objectId"),pointer=Text(witness,"pointer");
            Need(generatedIds.Add(id)&&decorationIds.Contains(id)&&objectMap.TryGetValue(id,out _)&&objectMap[id].Length==1,"SEMANTIC_REFERENCE");
            var actual=objects[objectMap[id][0]];int sectionPage=witness.GetProperty("sectionPage").GetInt32();
            Need(sectionPage>0&&sectionPage<=actual.Page+1,"SEMANTIC_SOURCE");
            var key=(actual.Page,pointer);
            if(!generated.TryGetValue(key,out var list))generated[key]=list=[];
            list.Add((actual,sectionPage));
        }
        var generatedPointers=generated.Keys.Select(key=>key.Pointer).ToHashSet();
        Need(listLabels.Keys.All(generatedPointers.Contains),"SEMANTIC_INCOMPLETE");
        var sectionStarts=new int[sections.Count];
        for(int i=1;i<sections.Count;i++)
        {Need(sections[i-1].Pages.Count>0,"SEMANTIC_SOURCE");sectionStarts[i]=sections[i-1].Pages.Max()+1;}
        var pageSections=new int[pageCount];
        for(int i=0;i<sections.Count;i++)
        {
            int start=sectionStarts[i],end=i+1<sections.Count?sectionStarts[i+1]:pageCount;
            Need(start<end&&end<=pageCount&&sections[i].Pages.All(p=>p>=start&&p<end),"SEMANTIC_SOURCE");
            for(int p=start;p<end;p++)pageSections[p]=i;
        }
        var actualBands=generated.Keys.Where(key=>key.Pointer.EndsWith("/header",StringComparison.Ordinal)||key.Pointer.EndsWith("/footer",StringComparison.Ordinal)).ToHashSet();
        Need(actualBands.SetEquals(bandLabels.Keys),"SEMANTIC_INCOMPLETE");
        for(int actualPage=0;actualPage<pageCount;actualPage++)
        {
            budget.Charge(64);string pointer=sections[pageSections[actualPage]].Pointer;
            if(pointer=="/settings/page"&&!document.GetProperty("settings").TryGetProperty("page",out _))continue;
            var settings=Pointer(document,pointer,budget);
            if(settings.TryGetProperty("watermarks",out var watermarks))
                for(int i=0;i<watermarks.GetArrayLength();i++){budget.Charge(pointer.Length*2L+64);Need(generated.ContainsKey((actualPage,pointer+"/watermarks/"+i)),"SEMANTIC_INCOMPLETE");}
        }
        foreach(var (key,list) in generated)
        {
            budget.Charge(list.Count*32L*(1+(int)Math.Log2(Math.Max(1,list.Count))));
            var origin=Pointer(document,key.Pointer,budget);
            string? kind=Optional(origin,"kind");
            int actualSection=pageSections[key.Page],derivedSectionPage=key.Page-sectionStarts[actualSection]+1;
            if(kind!="paragraph")
            {
                string settingPointer=kind is "image" or "text"?key.Pointer[..Math.Max(0,key.Pointer.LastIndexOf("/watermarks/",StringComparison.Ordinal))]:key.Pointer[..key.Pointer.LastIndexOf('/')];
                Need(settingPointer==sections[actualSection].Pointer&&list.All(item=>item.SectionPage==derivedSectionPage),"SEMANTIC_SOURCE");
            }
            if(kind is "image" or "text")
            {
                int separator=key.Pointer.LastIndexOf("/watermarks/",StringComparison.Ordinal);
                Need(separator>=0,"SEMANTIC_SOURCE");
                string settingsPath=key.Pointer[..separator];
                Need(settingsPath=="/settings/page"||settingsPath.StartsWith("/body/",StringComparison.Ordinal)&&settingsPath.EndsWith("/layout/section/page",StringComparison.Ordinal),"SEMANTIC_SOURCE");
                var watermarks=Pointer(document,settingsPath+"/watermarks",budget);
                Need(watermarks.ValueKind==JsonValueKind.Array,"SEMANTIC_SOURCE");
            }
            if(kind=="image")
            {
                Need(sourceImages.TryGetValue(Text(origin,"resourceId"),out var digest)&&list.Count==1&&list[0].Object.ImageDigest==digest,"RESOURCE_IMAGE_MISMATCH");
                continue;
            }
            Need(list.All(item=>item.Object.ImageDigest is null)&&list.Any(item=>item.Object.Text is not null),"SEMANTIC_SOURCE");
            string expected;
            if(kind=="paragraph") {Need(listLabels.TryGetValue(key.Pointer,out var label),"SEMANTIC_SOURCE");expected=label.Text;}
            else if(kind=="text")expected=Text(origin,"text");
            else
            {
                Need(key.Pointer.EndsWith("/header",StringComparison.Ordinal)||key.Pointer.EndsWith("/footer",StringComparison.Ordinal),"SEMANTIC_SOURCE");
                Need(bandLabels.TryGetValue(key,out _),"SEMANTIC_INCOMPLETE");
                expected=bandLabels[key];
            }
            budget.Charge(expected.Length*4L);
            Need(string.Concat(list.OrderBy(item=>item.Object.Order).Select(item=>item.Object.Text))==expected,"SEMANTIC_SOURCE");
            var face=kind=="paragraph"?listLabels[key.Pointer].Face:origin.TryGetProperty("style",out var style)?ApplyStyle(style,defaultFace):defaultFace;
            Need(list.Where(item=>item.Object.Text is not null).All(item=>MatchesFace(face,item.Object.OriginalFont!)),"FONT_FAMILY_MISMATCH");
        }
        Need(decorationIds.Where(id=>objectMap[id].Any(target=>objects[target].ImageDigest is not null||objects[target].Text is not null)).All(generatedIds.Contains),"SEMANTIC_INCOMPLETE");
        // A source-bearing document cannot relabel all output as decoration.
        Need(semantics.GetArrayLength()>0 || !index.Values.SelectMany(v=>v).Any(v=>v.Text is {Length:>0}),"SEMANTIC_INCOMPLETE");
    }
    private static bool PhysicalKind(SourceNode node,RenderedObject actual)=>Optional(node.Value,"kind") switch
    {
        "path" or "barcode-binding"=>actual.Xml.Name==SafePackage.Ns+"PathObject",
        "image-binding"=>actual.Xml.Name==SafePackage.Ns+"ImageObject",
        "paragraph" or "text" or "input-control" or "table-cell"=>actual.Xml.Name==SafePackage.Ns+"TextObject",
        _=>false
    };
    private static bool Paints(JsonElement block,ContainerBudget budget)
    {
        budget.Charge(32);
        return Optional(block,"kind") switch {
            "image-binding"=>block.GetProperty("sources").GetArrayLength()>0,
            "region"=>block.GetProperty("layout").TryGetProperty("background",out _)||block.GetProperty("layout").TryGetProperty("border",out _)||block.GetProperty("children").EnumerateArray().Any(child=>Paints(child,budget)),
            _=>true
        };
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
