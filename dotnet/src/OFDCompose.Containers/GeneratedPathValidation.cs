using System.Text;
using System.Text.Json;
using System.Xml.Linq;
using static OFDCompose.Containers.ContainerBudget;
using static OFDCompose.Containers.SourceValidation;

namespace OFDCompose.Containers;

// Geometry is recomputed by the existing TS Worker and fixed writer in an explicit host.
// .NET only compares bounded fixed XML payloads; a mutable attachment hash is never a proof.
internal static class GeneratedPathValidation
{
    internal static void Validate(JsonElement source,IReadOnlyDictionary<string,string[]> objectMap,
        IReadOnlyDictionary<string,RenderedObject> objects,Dictionary<string,byte[]> entries,
        GeneratedPathResolver? resolver,ContainerBudget budget)
    {
        var actual=new Dictionary<string,RenderedObject>();
        foreach(var value in source.GetProperty("semanticMap").GetProperty("decorations").EnumerateArray())
        {
            budget.Charge(64);string id=value.GetString()!;
            var paths=objectMap[id].Where(target=>objects[target].Xml.Name==SafePackage.Ns+"PathObject").ToArray();
            if(paths.Length>0){Need(paths.Length==1&&objectMap[id].Length==1,"SEMANTIC_REFERENCE");actual.Add(id,objects[paths[0]]);}
        }
        bool potential=MayGenerate(source.GetProperty("resolvedDocument"),budget)||MayGenerate(source.GetProperty("renderProfile").GetProperty("layout").GetProperty("defaultStyle"),budget);
        if(actual.Count==0&&!potential)return;
        Need(resolver is not null,"GENERATED_PATH_VERIFIER_REQUIRED");
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
        IReadOnlyList<GeneratedPathPayload>? expected;
        try { expected=resolver!(new("ofd-compose/generated-paths@0",json,assets),budget.Token); }
        catch(OperationCanceledException) { throw; }
        catch(Exception) { throw new ContainerFailure("GENERATED_PATH_VERIFICATION_FAILED"); }
        budget.Charge(0);
        Need(expected is not null&&expected.Count<=200000,"GENERATED_PATH_VERIFICATION_FAILED");
        var seen=new HashSet<string>();int count=0;
        foreach(var payload in expected!)
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
    }
    private static bool MayGenerate(JsonElement value,ContainerBudget budget)
    {
        budget.Charge(32);
        if(value.ValueKind==JsonValueKind.Array)return value.EnumerateArray().Any(child=>MayGenerate(child,budget));
        if(value.ValueKind!=JsonValueKind.Object)return false;
        foreach(var property in value.EnumerateObject())
        {
            if(property.Name is "border" or "background" or "highlight")return true;
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
