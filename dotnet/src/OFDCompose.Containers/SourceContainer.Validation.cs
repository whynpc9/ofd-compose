using System.Text.Json;
using System.Xml;
using System.Xml.Linq;
using static OFDCompose.Containers.ContainerBudget;
using static OFDCompose.Containers.SourceValidation;

namespace OFDCompose.Containers;
public static partial class SourceContainer
{
    private static Dictionary<string,string> OwnResourceMap(IReadOnlyDictionary<string,string>? input,bool required,ContainerBudget budget)
    {
        Need(!required||input is not null,"RESOURCE_MAP_MISSING");
        var result=new Dictionary<string,string>();
        if(input is null)return result;
        Need(input.Count<=128,"SIZE_LIMIT");
        foreach(var (id,target) in input)
        {
            Need(result.Count<128 && id.Length is >0 and <=256 && target.Length is >0 and <=256,"SIZE_LIMIT");
            budget.Charge(128+id.Length*6L+target.Length*6L);Need(result.TryAdd(id,target),"RESOURCE_INCOMPLETE");
        }
        return result;
    }
    private static Dictionary<string,string> ReadResourceMap(JsonElement value,ContainerBudget budget)
    {
        Need(value.ValueKind==JsonValueKind.Object,"SCHEMA_INVALID");
        var result=new Dictionary<string,string>();
        foreach(var property in value.EnumerateObject())
        {
            string target=property.Value.GetString()??throw new ContainerFailure("SCHEMA_INVALID");
            Need(result.Count<128 && property.Name.Length is >0 and <=256 && target.Length is >0 and <=256,"SIZE_LIMIT");
            budget.Charge(128+property.Name.Length*6L+target.Length*6L);result.Add(property.Name,target);
        }
        return result;
    }
    private static IReadOnlyDictionary<string,string[]> OwnObjectMap(IReadOnlyDictionary<string,string[]> input,ContainerBudget budget)
    {
        Need(input.Count is >=0 and <=200_000,"SIZE_LIMIT");
        var owned=new Dictionary<string,string[]>();
        foreach(var (id,targets) in input)
        {
            Need(owned.Count<200_000 && id.Length is >0 and <=256 && targets.Length is >0 and <=32,"SIZE_LIMIT");
            budget.Charge(128L+id.Length*6L+targets.Length*16L);
            foreach(var target in targets){Need(target is not null && target.Length is >0 and <=256,"SEMANTIC_REFERENCE");budget.Charge(target.Length*6L);}
            Need(owned.TryAdd(id,targets.ToArray()),"SEMANTIC_REFERENCE");
        }
        return owned;
    }
    private static uint ValidateWriterPackage(Dictionary<string, byte[]> entries, string irDigest, ContainerBudget budget)
    {
        uint maximum=0;
        foreach(var (path, bytes) in entries.Where(e=>e.Key.EndsWith(".xml",StringComparison.Ordinal)))
        {
            var xml=SafePackage.Xml(bytes,budget);
            WriterXmlGrammar.Validate(xml,path,budget);
            foreach(var id in xml.Descendants().Attributes("ID"))
            {
                Need(uint.TryParse(id.Value,System.Globalization.NumberStyles.None,System.Globalization.CultureInfo.InvariantCulture,out uint value)&&value>0,"PACKAGE_REFERENCE");
                maximum=Math.Max(maximum,value);
            }
            if(path=="OFD.xml")
            {
                Need(xml.Descendants(SafePackage.Ns+"DocID").Select(e=>e.Value).SequenceEqual([irDigest[..32]]),"UNEXPECTED_METADATA");
                Need(xml.Descendants(SafePackage.Ns+"DocRoot").Select(e=>e.Value).SequenceEqual(["Doc_0/Document.xml"]),"PROTOCOL_INVALID");
            }
        }
        return maximum;
    }
    private static void SourceVersions(JsonElement root)
    {
        var document = root.GetProperty("resolvedDocument");
        Need(Text(document,"format") == "ofd-compose/resolved-document@0" && Text(document,"modelVersion") == "0"
            && Text(document,"templateSchemaVersion") == "ofd-compose/document-model@0"
            && Text(document,"expressionLanguageVersion") == "expr-1"
            && Text(document,"bindingPolicyVersion") is "strict-1" or "legacy-compat-1"
            && Text(root.GetProperty("renderProfile"),"version") == "ofd-compose/render@0", "VERSION_UNSUPPORTED");
    }
    private static bool Malformed(Exception e) => e is JsonException or XmlException or InvalidDataException or InvalidOperationException or ArgumentException or KeyNotFoundException or OverflowException or FormatException or NotSupportedException;
    private static string AssetPath(string digest) => "Doc_0/Attachs/Assets/" + digest + ".bin";
    private static bool IsWriterEntry(string path) => path is "OFD.xml" or "Doc_0/Document.xml" or "Doc_0/PublicRes.xml" or "Doc_0/DocumentRes.xml"
        || System.Text.RegularExpressions.Regex.IsMatch(path, "^Doc_0/(Pages/Page_[0-9]+/Content\\.xml|Res/[a-zA-Z0-9_.-]+\\.(otf|ttf|png|jpg|jpeg))$", System.Text.RegularExpressions.RegexOptions.CultureInvariant, TimeSpan.FromSeconds(1));
    private static bool Signed(Dictionary<string, byte[]> entries, ContainerBudget budget)
    {
        if (entries.Keys.Any(p => p.StartsWith("Doc_0/Signs/", StringComparison.Ordinal))) return true;
        return entries.TryGetValue("OFD.xml", out var root) && SafePackage.Xml(root, budget).Descendants(SafePackage.Ns + "Signatures").Any();
    }
    private static void ValidateAttachment(Dictionary<string, byte[]> entries, ContainerBudget budget)
    {
        Need(entries.TryGetValue("OFD.xml", out var ofd) && entries.TryGetValue("Doc_0/Document.xml", out _), "PROTOCOL_INVALID");
        var root = SafePackage.Xml(ofd!, budget);
        Need(root.Descendants(SafePackage.Ns + "DocRoot").Select(e => e.Value).SequenceEqual(["Doc_0/Document.xml"]), "PROTOCOL_INVALID");
        var doc = SafePackage.Xml(entries["Doc_0/Document.xml"], budget);
        Need(doc.Descendants(SafePackage.Ns + "Attachments").Select(e => e.Value).SequenceEqual(["Attachs/Attachments.xml"]), "ATTACHMENT_INVALID");
        Need(entries.TryGetValue(AttachmentsPath, out var bytes), "ATTACHMENT_INVALID");
        var attachment = SafePackage.Xml(bytes!, budget);
        var nodes = attachment.Root!.Elements().ToArray();
        Need(nodes.Length == 1 && nodes[0].Name == SafePackage.Ns + "Attachment", "ATTACHMENT_INVALID");
        var node = nodes[0];
        Need(uint.TryParse((string?)node.Attribute("ID"),System.Globalization.NumberStyles.None,System.Globalization.CultureInfo.InvariantCulture,out uint attachmentId) && attachmentId>0,"ATTACHMENT_INVALID");
        Need(doc.Descendants(SafePackage.Ns+"MaxUnitID").Select(e=>e.Value).SequenceEqual([attachmentId.ToString(System.Globalization.CultureInfo.InvariantCulture)]),"ATTACHMENT_INVALID");
        foreach(var entry in entries.Where(e=>IsWriterEntry(e.Key)&&e.Key.EndsWith(".xml",StringComparison.Ordinal)))
            Need(!SafePackage.Xml(entry.Value,budget).Descendants().Attributes("ID").Any(a=>a.Value==attachmentId.ToString(System.Globalization.CultureInfo.InvariantCulture)),"ATTACHMENT_INVALID");
        Need((string?)node.Attribute("Name") == "ofd-compose.json" && (string?)node.Attribute("Format") == "application/json"
            && (string?)node.Attribute("Usage") == "ofd-compose" && (string?)node.Attribute("Visible") == "true" && node.Attribute("External") is null
            && node.Elements().Select(e => (e.Name, e.Value)).SequenceEqual([(SafePackage.Ns + "FileLoc", "ofd-compose.json")]), "ATTACHMENT_INVALID");
    }
    private static void ValidateInventory(JsonElement inventory, Dictionary<string, byte[]> entries, ContainerBudget budget, bool schemaOnly = false)
    {
        Need(inventory.ValueKind == JsonValueKind.Array && inventory.GetArrayLength() <= budget.Limits.Entries, "SCHEMA_INVALID");
        var paths = new HashSet<string>();
        foreach (var entry in inventory.EnumerateArray())
        {
            Keys(entry, "path", "byteLength", "sha256");
            string path = Text(entry, "path"); SafePackage.Path(path);
            Need(IsWriterEntry(path) || System.Text.RegularExpressions.Regex.IsMatch(path, "^Doc_0/Attachs/Assets/[a-f0-9]{64}\\.bin$"), "UNEXPECTED_ENTRY");
            Need(paths.Add(path) && path is not ManifestPath and not AttachmentsPath && IsDigest(Text(entry, "sha256"))
                && entry.GetProperty("byteLength").TryGetInt32(out int size) && size >= 0 && size <= budget.Limits.EntryBytes, "SCHEMA_INVALID");
        }
        if (schemaOnly) return;
        foreach (var entry in inventory.EnumerateArray())
        {
            Need(entries.TryGetValue(Text(entry, "path"), out var bytes), "RESOURCE_MISSING");
            Need(bytes!.Length == entry.GetProperty("byteLength").GetInt32() && SafePackage.Hash(bytes, budget) == Text(entry, "sha256"), "DIGEST_MISMATCH");
        }
        // Signature sidecars may be observed but are never considered verified or part of the editing source.
        Need(entries.Keys.All(p => paths.Contains(p) || p is ManifestPath or AttachmentsPath || p.StartsWith("Doc_0/Signs/", StringComparison.Ordinal)), "UNEXPECTED_ENTRY");
    }
    private static void AddAssets(JsonElement resources, IReadOnlyList<SourceAsset> assets, Dictionary<string, byte[]> entries, ContainerBudget budget)
    {
        Need(assets.Count <= 64, "SIZE_LIMIT");
        var declared = resources.GetProperty("images").EnumerateArray().GroupBy(r => Text(r, "sha256")).ToDictionary(g => g.Key, g => g.First().GetProperty("byteLength").GetInt32());
        var seen = new HashSet<string>();
        int count=0;
        foreach (var asset in assets)
        {
            Need(++count<=64,"SIZE_LIMIT");
            Need(IsDigest(asset.Sha256) && declared.TryGetValue(asset.Sha256, out int size) && size == asset.Bytes.Length, "RESOURCE_INVALID");
            Need(asset.Bytes.Length <= budget.Limits.EntryBytes, "SIZE_LIMIT");
            budget.Charge(asset.Bytes.Length * 2L);
            var bytes = asset.Bytes.ToArray();
            Need(SafePackage.Hash(bytes, budget) == asset.Sha256, "DIGEST_MISMATCH");
            if (seen.Add(asset.Sha256)) entries.Add(AssetPath(asset.Sha256), bytes);
        }
        Need(seen.Count == declared.Count, "RESOURCE_MISSING");
    }
    private static Dictionary<string,(string Kind,string Digest)> Resources(JsonElement resources, JsonElement resolved, JsonElement renderProfile, Dictionary<string, byte[]> entries, IReadOnlyDictionary<string,string> resourceMap, ContainerBudget budget)
    {
        SafePackage.References(entries,budget,requirePageReachability:true);
        var fonts = resources.GetProperty("fonts").EnumerateArray().ToArray();
        var images = resources.GetProperty("images").EnumerateArray().ToArray();
        var layout = resources.GetProperty("layout").EnumerateArray().ToArray();
        var renderedImageDigests=layout.Where(r=>Text(r,"kind")=="image").Select(r=>Text(r,"digest")).ToHashSet();
        Need(fonts.Length <= 64 && images.Length <= 64 && layout.Length <= 128, "SIZE_LIMIT");
        Need(fonts.Select(f => (Text(f,"family"),f.GetProperty("weight").GetInt32(),f.GetProperty("italic").GetBoolean())).Distinct().Count() == fonts.Length && images.Select(f => Text(f, "id")).Distinct().Count() == images.Length, "RESOURCE_INVALID");
        var resourceEntries = entries.Where(e => e.Key.StartsWith("Doc_0/Res/", StringComparison.Ordinal)).Select(e => (e.Key, Bytes: e.Value, Hash: SafePackage.Hash(e.Value, budget))).ToArray();
        var declared = new Dictionary<string, (string Kind, string Digest)>();
        foreach(var resourceXml in entries.Where(e=>e.Key is "Doc_0/PublicRes.xml" or "Doc_0/DocumentRes.xml"))
        {
            var xml=SafePackage.Xml(resourceXml.Value,budget);
            Need((string?)xml.Root!.Attribute("BaseLoc")=="Res","RESOURCE_INVALID");
            foreach(var node in xml.Descendants().Where(e=>e.Name.LocalName is "Font" or "MultiMedia"))
            {
                var location=node.Element(SafePackage.Ns+(node.Name.LocalName=="Font"?"FontFile":"MediaFile"));
                Need(location is not null,"RESOURCE_MISSING");
                string path="Doc_0/Res/"+location!.Value;SafePackage.Path(path);
                Need(entries.TryGetValue(path,out var bytes),"RESOURCE_MISSING");
                string id=(string?)node.Attribute("ID")??"";
                Need(declared.TryAdd(id,(node.Name.LocalName=="Font"?"font":"image",SafePackage.Hash(bytes!,budget))),"RESOURCE_INVALID");
            }
        }
        var declaredSet=declared.Values.ToHashSet();
        var layoutSet=layout.Select(r=>(Text(r,"kind"),Text(r,Text(r,"kind")=="font"?"subsetDigest":"digest"))).ToHashSet();
        Need(declaredSet.SetEquals(layoutSet),"RESOURCE_INCOMPLETE");
        Need(resourceMap.Count==layout.Length && resourceMap.Values.ToHashSet().SetEquals(declared.Keys),"RESOURCE_INCOMPLETE");
        foreach(var item in layout)
        {
            Need(resourceMap.TryGetValue(Text(item,"id"),out var target),"RESOURCE_INCOMPLETE");
            Need(declared.TryGetValue(target,out var physical),"RESOURCE_INCOMPLETE");
            Need(physical.Kind==Text(item,"kind") && physical.Digest==Text(item,physical.Kind=="font"?"subsetDigest":"digest"),"RESOURCE_INCOMPLETE");
        }
        foreach(var page in entries.Where(e=>e.Key.StartsWith("Doc_0/Pages/",StringComparison.Ordinal)))
            foreach(var node in SafePackage.Xml(page.Value,budget).Descendants().Where(e=>e.Name.LocalName is "TextObject" or "ImageObject"))
            {
                bool font=node.Name.LocalName=="TextObject";
                string id=(string?)node.Attribute(font?"Font":"ResourceID")??"";
                Need(declared.TryGetValue(id,out var resource) && resource.Kind==(font?"font":"image"),"RESOURCE_MISSING");
            }
        var sourceImageIds=new HashSet<string>();
        var families=new HashSet<string>();
        void ImageReferences(JsonElement value)
        {
            budget.Charge(32);
            if(value.ValueKind==JsonValueKind.Array)foreach(var child in value.EnumerateArray())ImageReferences(child);
            if(value.ValueKind!=JsonValueKind.Object)return;
            if(value.TryGetProperty("resourceId",out var id))sourceImageIds.Add(id.GetString()!);
            if(value.TryGetProperty("fontFamily",out var family))families.Add(family.GetString()!);
            if(value.TryGetProperty("kind",out var kind) && kind.GetString()=="image-binding")
                foreach(var source in value.GetProperty("sources").EnumerateArray())
                    if(source.ValueKind==JsonValueKind.String)Need(renderedImageDigests.Contains(InlineImageDigest(source.GetString()!,budget)),"RESOURCE_IMAGE_MISMATCH");
            foreach(var property in value.EnumerateObject())ImageReferences(property.Value);
        }
        ImageReferences(resolved);
        ImageReferences(renderProfile);
        Need(fonts.All(f=>families.Contains(Text(f,"family"))),"FONT_FACE_MISMATCH");
        Need(sourceImageIds.SetEquals(images.Select(i=>Text(i,"id"))),"RESOURCE_INCOMPLETE");
        var ids = new HashSet<string>();
        foreach (var resource in layout)
        {
            budget.Charge(64);
            Need(ids.Add(Text(resource, "id")), "RESOURCE_INVALID");
            string kind = Text(resource, "kind");
            string digest = Text(resource, kind == "font" ? "subsetDigest" : "digest");
            Need(resourceEntries.Any(e => e.Hash == digest), "RESOURCE_MISSING");
            if (kind == "font")
            {
                Need(fonts.Any(f => Text(f, "sha256") == Text(resource, "originalDigest")), "FONT_IDENTITY_MISSING");
                Need(resource.GetProperty("faceIndex").GetInt32()==0 && fonts.Any(f=>FaceMatches(f,resource)),"FONT_FACE_MISMATCH");
                Need(Text(resource, "originalDigest") != digest, "FONT_SUBSET_IS_NOT_FULL");
            }
        }
        Need(fonts.All(f => layout.Any(r => Text(r, "kind") == "font" && FaceMatches(f,r))), "RESOURCE_INVALID");
        foreach (var image in images)
        {
            Need(renderedImageDigests.Contains(Text(image,"sha256")),"RESOURCE_IMAGE_MISMATCH");
            Need(entries.TryGetValue(AssetPath(Text(image, "sha256")), out var bytes), "RESOURCE_MISSING");
            Need(bytes!.Length == image.GetProperty("byteLength").GetInt32() && SafePackage.Hash(bytes, budget) == Text(image, "sha256"), "DIGEST_MISMATCH");
            bool png=bytes.AsSpan().StartsWith(new byte[] {137,80,78,71,13,10,26,10});
            bool jpeg=bytes.AsSpan().StartsWith(new byte[] {255,216,255});
            Need(png||jpeg,"RESOURCE_INVALID");
            if(image.TryGetProperty("mimeType",out var mime))Need(mime.GetString()==(png?"image/png":"image/jpeg"),"RESOURCE_INVALID");
        }
        return declared;
    }
    private static bool FaceMatches(JsonElement font,JsonElement layout)=>Text(font,"sha256")==Text(layout,"originalDigest")
        && font.GetProperty("weight").GetInt32()==layout.GetProperty("weight").GetDouble()
        && Text(layout,"style")== (font.GetProperty("italic").GetBoolean()?"italic":"normal");
    internal static string InlineImageDigest(string text,ContainerBudget budget)
    {
        budget.Charge(text.Length*4L);
        string encoded=text;string? mime=null;
        if(text.StartsWith("data:",StringComparison.Ordinal))
        {
            int comma=text.IndexOf(',');Need(comma is >0 and <=64,"RESOURCE_INVALID");
            string header=text[..comma];
            Need(header is "data:image/png;base64" or "data:image/jpeg;base64","RESOURCE_INVALID");
            mime=header[5..^7];encoded=text[(comma+1)..];
        }
        Need(encoded.Length>0 && encoded.Length%4==0 && encoded.Length/4L*3<=8_000_002,"SIZE_LIMIT");
        budget.Charge(encoded.Length*4L);
        byte[] bytes=Convert.FromBase64String(encoded);
        Need(bytes.Length<=8_000_000 && Convert.ToBase64String(bytes)==encoded,"RESOURCE_INVALID");
        bool png=bytes.AsSpan().StartsWith(new byte[]{137,80,78,71,13,10,26,10});
        bool jpeg=bytes.AsSpan().StartsWith(new byte[]{255,216,255});
        Need(png||jpeg,"RESOURCE_INVALID");
        Need(mime is null || mime==(png?"image/png":"image/jpeg"),"RESOURCE_INVALID");
        return SafePackage.Hash(bytes,budget);
    }
    private static Dictionary<string, string[]> ReadObjectMap(JsonElement value, ContainerBudget budget)
    {
        Need(value.ValueKind == JsonValueKind.Object, "SCHEMA_INVALID");
        var result = new Dictionary<string, string[]>();
        foreach (var property in value.EnumerateObject())
        {
            budget.Charge(64);
            Need(property.Name.Length <= 256 && property.Value.ValueKind == JsonValueKind.Array && property.Value.GetArrayLength() is > 0 and <= 32, "SCHEMA_INVALID");
            var values = property.Value.EnumerateArray().Select(e => e.GetString()!).ToArray();
            Need(values.All(v => v is not null && v.Length is > 0 and <= 256), "SCHEMA_INVALID");
            result.Add(property.Name, values);
        }
        return result;
    }
    private static Dictionary<string,RenderedObject> SemanticMap(JsonElement root, IReadOnlyDictionary<string, string[]> objectMap, Dictionary<string, byte[]> entries, Dictionary<string,(string Kind,string Digest)> links, IReadOnlyDictionary<string,string> resourceMap, ContainerBudget budget, BarcodeGeometryResolver? barcodeGeometryResolver, NumberingLabelsResolver? numberingLabelsResolver,SourceRenderResolver? sourceRenderResolver,out SourceReplayIdentity replayIdentity)
    {
        Need(objectMap.Count <= 200_000, "SIZE_LIMIT");
        var physical = new HashSet<string>();
        var objects = new Dictionary<string,RenderedObject>();
        var originalFonts=root.GetProperty("resources").GetProperty("layout").EnumerateArray().Where(r=>Text(r,"kind")=="font").ToDictionary(r=>resourceMap[Text(r,"id")],r=>Text(r,"originalDigest"));
        foreach (var entry in entries.Where(e => e.Key.StartsWith("Doc_0/Pages/", StringComparison.Ordinal) && e.Key.EndsWith("/Content.xml", StringComparison.Ordinal)))
        {
            var xml = SafePackage.Xml(entry.Value, budget);
            int pageIndex=int.Parse(entry.Key.Split('/')[2][5..],System.Globalization.CultureInfo.InvariantCulture),objectIndex=0;
            foreach (var element in xml.Descendants().Where(e => e.Name.LocalName is "TextObject" or "ImageObject" or "PathObject"))
            {
                string id=(string?)element.Attribute("ID")??"";
                Need(physical.Add(id), "SEMANTIC_REFERENCE");
                objects.Add(id,new(pageIndex,objectIndex++,element.Name.LocalName=="TextObject"?string.Concat(element.Elements(SafePackage.Ns+"TextCode").Select(e=>e.Value)):null,element.Name.LocalName=="ImageObject"?links[(string)element.Attribute("ResourceID")!].Digest:null,element.Name.LocalName=="TextObject"?originalFonts[(string)element.Attribute("Font")!]:null,element));
            }
        }
        var mapped = new HashSet<string>();
        foreach (var (id, targets) in objectMap)
        {
            budget.Charge(64);
            Need(id.Length is > 0 and <= 256 && targets.Length is > 0 and <= 32, "SEMANTIC_REFERENCE");
            foreach (var target in targets) Need(physical.Contains(target) && mapped.Add(target), "SEMANTIC_REFERENCE");
        }
        Need(mapped.SetEquals(physical), "SEMANTIC_REFERENCE");
        SourceVersions(root);
        var bands=SourceRenderValidation.Validate(root,objectMap,objects,entries,sourceRenderResolver,budget,out var renderProof);
        SemanticValidation.Validate(root.GetProperty("semanticMap"),root.GetProperty("resolvedDocument"),root.GetProperty("resources"),root.GetProperty("renderProfile"),objectMap,objects,entries.Keys.Count(path=>path.StartsWith("Doc_0/Pages/",StringComparison.Ordinal)&&path.EndsWith("/Content.xml",StringComparison.Ordinal)),budget,barcodeGeometryResolver,numberingLabelsResolver,bands);
        replayIdentity=SourceRenderValidation.ValidatePages(root,entries,links.ToDictionary(item=>item.Key,item=>item.Value.Digest),sourceRenderResolver,renderProof,budget);
        return objects;
    }
}
