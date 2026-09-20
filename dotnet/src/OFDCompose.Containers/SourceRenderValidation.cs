using System.Text;
using System.Text.Json;
using System.Xml.Linq;
using static OFDCompose.Containers.ContainerBudget;
using static OFDCompose.Containers.SourceValidation;

namespace OFDCompose.Containers;

// Geometry is recomputed by the existing TS Worker and fixed writer in an explicit host.
// .NET only compares bounded fixed XML payloads; a mutable attachment hash is never a proof.
internal static class SourceRenderValidation
{
    internal static IReadOnlyDictionary<(int Page,string Pointer),string> Validate(JsonElement source,IReadOnlyDictionary<string,string[]> objectMap,
        IReadOnlyDictionary<string,RenderedObject> objects,Dictionary<string,byte[]> entries,
        SourceRenderResolver? resolver,ContainerBudget budget)
    {
        var actual=new Dictionary<string,RenderedObject>();
        foreach(var value in source.GetProperty("semanticMap").GetProperty("decorations").EnumerateArray())
        {
            budget.Charge(64);string id=value.GetString()!;
            var paths=objectMap[id].Where(target=>objects[target].Xml.Name==SafePackage.Ns+"PathObject").ToArray();
            if(paths.Length>0){Need(paths.Length==1&&objectMap[id].Length==1,"SEMANTIC_REFERENCE");actual.Add(id,objects[paths[0]]);}
        }
        bool potential=MayGenerate(source.GetProperty("resolvedDocument"),budget)||MayGenerate(source.GetProperty("renderProfile").GetProperty("layout").GetProperty("defaultStyle"),budget);
        var semanticEntries=source.GetProperty("semanticMap").GetProperty("entries");
        Need(semanticEntries.GetArrayLength()<=200000,"SIZE_LIMIT");
        // The input string ceiling bounds all ID decoding; reserve it before any GetString allocation.
        budget.Charge(budget.Limits.StringBytes*2L);
        var semantics=new Dictionary<string,JsonElement>();bool tableMetadata=false;
        foreach(var semantic in semanticEntries.EnumerateArray())
        {
            budget.Charge(128);string id=Text(semantic,"objectId");
            Need(id.Length is >0 and <=256&&semantics.TryAdd(id,semantic),"SEMANTIC_REFERENCE");
            tableMetadata|=semantic.TryGetProperty("table",out _)||semantic.TryGetProperty("repeatedHeader",out _);
        }
        if(actual.Count==0&&!potential&&!tableMetadata)return new Dictionary<(int,string),string>();
        Need(resolver is not null,"SOURCE_RENDER_VERIFIER_REQUIRED");
        // Bound serialization/copy expansion before materializing the trusted-host request.
        budget.Charge(budget.Limits.JsonBytes*8L);
        byte[] json=Encoding.UTF8.GetBytes(source.GetRawText());Need(json.Length<=budget.Limits.JsonBytes,"SIZE_LIMIT");
        var assets=new List<SourceAsset>();var seenAssets=new HashSet<string>();
        foreach(var image in source.GetProperty("resources").GetProperty("images").EnumerateArray())
        {
            string digest=Text(image,"sha256");if(!seenAssets.Add(digest))continue;
            var bytes=entries["Doc_0/Attachs/Assets/"+digest+".bin"];budget.Charge(bytes.Length*2L+128);
            assets.Add(new(digest,bytes.ToArray()));
        }
        SourceRenderEvidence? proof;
        try { proof=resolver!(new("ofd-compose/source-render@0",json,assets),budget.Token); }
        catch(OperationCanceledException) { throw; }
        catch(Exception) { throw new ContainerFailure("SOURCE_RENDER_VERIFICATION_FAILED"); }
        budget.Charge(0);
        Need(proof is not null&&proof.Paths is not null&&proof.Tables is not null&&proof.Bands is not null&&proof.Paths.Count<=200000&&proof.Tables.Count<=200000&&proof.Bands.Count<=2000,"SOURCE_RENDER_VERIFICATION_FAILED");
        var expected=proof!.Paths;
        var seen=new HashSet<string>();int count=0;
        foreach(var payload in expected)
        {
            budget.Charge(128);
            Need(++count<=200000&&payload.ObjectId.Length is >0 and <=256&&seen.Add(payload.ObjectId),"GENERATED_PATH_MISMATCH");
            Need(actual.TryGetValue(payload.ObjectId,out var physical)&&physical.Page==payload.PageIndex&&physical.Order==payload.ObjectIndex,"GENERATED_PATH_MISMATCH");
            Need(payload.Xml.Length is >0&&payload.Xml.Length<=budget.Limits.EntryBytes,"SIZE_LIMIT");
            budget.Charge(payload.Xml.Length*2L);
            var document=SafePackage.Xml(payload.Xml.ToArray(),budget,"PathObject");
            WriterXmlGrammar.Validate(document,"generated-path.xml",budget);
            Need(XNode.DeepEquals(Canonical(document.Root!,budget,true),Canonical(physical!.Xml,budget,true)),"GENERATED_PATH_MISMATCH");
        }
        Need(seen.SetEquals(actual.Keys),"GENERATED_PATH_MISMATCH");
        var tableIds=new HashSet<string>();count=0;
        foreach(var relation in proof.Tables)
        {
            budget.Charge(128);
            Need(++count<=200000&&relation.ObjectId.Length is >0 and <=256&&tableIds.Add(relation.ObjectId)&&semantics.TryGetValue(relation.ObjectId,out _),"TABLE_RELATION_MISMATCH");
            var semantic=semantics[relation.ObjectId];
            Need(relation.TableJson.Length is >0 and <=8192&&relation.RepeatedHeaderJson.Length<=8192,"SIZE_LIMIT");
            using var table=SafePackage.Json(relation.TableJson,budget);
            Need(semantic.TryGetProperty("table",out var actualTable)&&JsonElement.DeepEquals(actualTable,table.RootElement),"TABLE_RELATION_MISMATCH");
            bool repeated=semantic.TryGetProperty("repeatedHeader",out var header);
            Need(repeated==!relation.RepeatedHeaderJson.IsEmpty,"TABLE_RELATION_MISMATCH");
            if(repeated){using var expectedHeader=SafePackage.Json(relation.RepeatedHeaderJson,budget);Need(JsonElement.DeepEquals(header,expectedHeader.RootElement),"TABLE_RELATION_MISMATCH");}
        }
        Need(tableIds.SetEquals(semantics.Values.Where(e=>e.TryGetProperty("table",out _)).Select(e=>Text(e,"objectId")))&&semantics.Values.All(e=>!e.TryGetProperty("repeatedHeader",out _)||e.TryGetProperty("table",out _)),"TABLE_RELATION_MISMATCH");
        var bands=new Dictionary<(int,string),string>();count=0;
        foreach(var band in proof.Bands)
        {
            budget.Charge(128);
            Need(++count<=2000&&band.PageIndex is >=0 and <1000&&band.Pointer.Length is >0 and <=2048&&band.Text.Length is >0 and <=100000,"SIZE_LIMIT");
            budget.Charge(band.Pointer.Length*2L+band.Text.Length*2L);
            Need(bands.TryAdd((band.PageIndex,band.Pointer),band.Text),"PAGE_BAND_MISMATCH");
        }
        var renderedBandPointers=bands.Keys.Select(key=>key.Item2).ToHashSet();
        CheckUnusedBands(source.GetProperty("resolvedDocument").GetProperty("body"),"/body",renderedBandPointers,budget);
        CheckUnusedBands(source.GetProperty("resolvedDocument").GetProperty("settings"),"/settings",renderedBandPointers,budget);
        return bands;
    }
    private static void CheckUnusedBands(JsonElement value,string pointer,HashSet<string> rendered,ContainerBudget budget)
    {
        budget.Charge(64+pointer.Length*2L);
        if(value.ValueKind==JsonValueKind.Array){int i=0;foreach(var child in value.EnumerateArray())CheckUnusedBands(child,pointer+"/"+i++,rendered,budget);return;}
        if(value.ValueKind!=JsonValueKind.Object)return;
        foreach(var property in value.EnumerateObject())
        {
            string childPointer=pointer+"/"+property.Name.Replace("~","~0",StringComparison.Ordinal).Replace("/","~1",StringComparison.Ordinal);
            if(property.Name is "header" or "footer"&&property.Value.ValueKind==JsonValueKind.Object&&property.Value.TryGetProperty("parts",out var parts)&&!rendered.Contains(childPointer))
                Need(parts.GetArrayLength()==0&&!property.Value.TryGetProperty("style",out _)&&!property.Value.TryGetProperty("alignment",out _),"SOURCE_NOT_MINIMAL");
            CheckUnusedBands(property.Value,childPointer,rendered,budget);
        }
    }
    private static bool MayGenerate(JsonElement value,ContainerBudget budget)
    {
        budget.Charge(32);
        if(value.ValueKind==JsonValueKind.Array)return value.EnumerateArray().Any(child=>MayGenerate(child,budget));
        if(value.ValueKind!=JsonValueKind.Object)return false;
        foreach(var property in value.EnumerateObject())
        {
            if(property.Name is "border" or "background" or "highlight" or "header" or "footer")return true;
            if(property.Name=="kind"&&property.Value.ValueKind==JsonValueKind.String&&property.Value.ValueEquals("table"))return true;
            if(property.Name is "underline" or "strikethrough"&&property.Value.ValueKind==JsonValueKind.True)return true;
            if(MayGenerate(property.Value,budget))return true;
        }
        return false;
    }
    private static XElement Canonical(XElement element,ContainerBudget budget,bool root=false)
    {
        budget.Charge(128+element.Attributes().Sum(a=>a.Value.Length*2L));
        return new(element.Name,
            element.Attributes().Where(a=>!a.IsNamespaceDeclaration&&!(root&&a.Name.LocalName=="ID"&&a.Name.NamespaceName=="")).OrderBy(a=>a.Name.ToString(),StringComparer.Ordinal).Select(a=>new XAttribute(a.Name,a.Value)),
            element.Nodes().Where(node=>!element.HasElements||node is not XText text||!string.IsNullOrWhiteSpace(text.Value)).Select(node=>node is XElement child?(object)Canonical(child,budget):node is XText text?new XText(text.Value):throw new ContainerFailure("GENERATED_PATH_MISMATCH")));
    }
}
