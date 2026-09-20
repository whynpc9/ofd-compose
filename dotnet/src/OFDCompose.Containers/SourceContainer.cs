using System.Text;
using System.Text.Json;
using System.Xml;
using System.Xml.Linq;
using static OFDCompose.Containers.ContainerBudget;
using static OFDCompose.Containers.SourceValidation;

namespace OFDCompose.Containers;

/// <summary>WP0.8 experimental single JSON attachment. Extraction never runs source or fetches resources.
/// Hashes establish internal consistency only. No signature verification is performed.</summary>
public static partial class SourceContainer
{
    public const string Protocol = "ofd-compose/source@0";
    public const string ProfileVersion = "ofd-compose/container-experimental@0";
    private const string ManifestPath = "Doc_0/Attachs/ofd-compose.json";
    private const string AttachmentsPath = "Doc_0/Attachs/Attachments.xml";
    private static readonly string[] PartNames = ["resolvedDocument", "renderProfile", "resources", "semanticMap", "irDigest"];

    public static ContainerResult Create(ReadOnlyMemory<byte> ofd, string irDigest,
        IReadOnlyDictionary<string, string[]> objectMap, ContainerProfile profile,
        ReadOnlyMemory<byte> sourceJson = default, IReadOnlyList<SourceAsset>? assets = null,
        string? parentArtifactDigest = null, ContainerLimits? limits = null, CancellationToken cancellationToken = default)
    {
        try
        {
            var budget = new ContainerBudget(limits ?? new(), cancellationToken);
            Need(IsDigest(irDigest) && (parentArtifactDigest is null || IsDigest(parentArtifactDigest)), "SCHEMA_INVALID");
            objectMap = OwnObjectMap(objectMap, budget);
            var entries = SafePackage.Read(ofd, budget);
            Need(!Signed(entries, budget), "SIGNED_INPUT_UNSUPPORTED");
            Need(entries.ContainsKey("OFD.xml") && entries.ContainsKey("Doc_0/Document.xml"), "PROTOCOL_INVALID");
            // Only a fresh fixed-writer package can be sealed. This prevents hidden sources in distribution output.
            Need(entries.Keys.All(IsWriterEntry), "UNEXPECTED_ENTRY");
            ValidateWriterPackage(entries, irDigest, budget);
            var doc = SafePackage.Xml(entries["Doc_0/Document.xml"], budget);
            Need(!doc.Descendants(SafePackage.Ns + "Attachments").Any() && !doc.Descendants(SafePackage.Ns + "Extensions").Any(), "UNEXPECTED_ENTRY");
            var maxUnit=doc.Descendants(SafePackage.Ns+"MaxUnitID").Single();
            Need(uint.TryParse(maxUnit.Value,System.Globalization.NumberStyles.None,System.Globalization.CultureInfo.InvariantCulture,out uint maxId) && maxId<uint.MaxValue,"RESOURCE_INVALID");
            string attachmentId=(maxId+1).ToString(System.Globalization.CultureInfo.InvariantCulture);
            maxUnit.Value=attachmentId;
            doc.Root!.Add(new XElement(SafePackage.Ns + "Attachments", "Attachs/Attachments.xml"));
            entries["Doc_0/Document.xml"] = SafePackage.Encode(doc);
            var parts = new List<SourcePart>();
            string modelVersion = "0";
            if (profile == ContainerProfile.NativeEditable)
            {
                using var source = Parse(sourceJson, budget);
                var root = source.RootElement;
                Need(Text(root, "irDigest") == irDigest, "DIGEST_MISMATCH");
                modelVersion = Text(root.GetProperty("resolvedDocument"), "modelVersion");
                foreach (string name in PartNames)
                {
                    var content = root.GetProperty(name);
                    parts.Add(new(name, "application/json", SafePackage.Hash(Bytes(content, budget), budget), content.GetRawText()));
                }
                AddAssets(root.GetProperty("resources"), assets ?? [], entries, budget);
                var links=Resources(root.GetProperty("resources"), root.GetProperty("resolvedDocument"), root.GetProperty("renderProfile"), entries, budget);
                SemanticMap(root, objectMap, entries, links, budget);
                SourceVersions(root);
            }
            else {
                Need(profile == ContainerProfile.Distribution && sourceJson.IsEmpty && (assets?.Count ?? 0) == 0, "DISTRIBUTION_SOURCE_FORBIDDEN");
                SafePackage.References(entries,budget,requirePageReachability:true);
                string identity=JsonSerializer.Serialize(irDigest,ContainerJsonContext.Default.String);
                parts.Add(new("irDigest","application/json",SafePackage.Hash(Encoding.UTF8.GetBytes(identity),budget),identity));
            }
            var inventory = entries.OrderBy(e => e.Key, StringComparer.Ordinal).Select(e => new EntryIdentity(e.Key, e.Value.Length, SafePackage.Hash(e.Value, budget))).ToArray();
            long manifestReservation = 4096 + inventory.Length * 1024L + sourceJson.Length * 6L;
            if(profile == ContainerProfile.NativeEditable) foreach(var (id, targets) in objectMap)
                manifestReservation += 128L + id.Length * 6L + targets.Sum(t => 16L + t.Length * 6L);
            Need(manifestReservation <= budget.Limits.JsonBytes, "SIZE_LIMIT");
            budget.Charge(manifestReservation * 4L);
            var manifest = new SourceManifest("ofd-compose", Protocol,
                profile == ContainerProfile.NativeEditable ? "native-editable" : "distribution",
                ProfileVersion, modelVersion, "ofd-compose/layout-ir@0", irDigest,
                profile == ContainerProfile.NativeEditable ? ["resolved-document", "semantic-map", "authorized-full-fonts"] : ["derived-no-source"],
                new("OFDCompose.Containers/0", parentArtifactDigest), "unsigned-or-unverified", parts, inventory,
                profile == ContainerProfile.NativeEditable ? objectMap : new Dictionary<string, string[]>());
            entries.Add(ManifestPath, JsonSerializer.SerializeToUtf8Bytes(manifest, ContainerJsonContext.Default.SourceManifest));
            Need(entries[ManifestPath].Length <= budget.Limits.JsonBytes, "SIZE_LIMIT");
            entries.Add(AttachmentsPath, SafePackage.Encode(new XDocument(new XElement(SafePackage.Ns + "Attachments",
                new XElement(SafePackage.Ns + "Attachment", new XAttribute("ID", attachmentId), new XAttribute("Name", "ofd-compose.json"),
                    new XAttribute("Format", "application/json"), new XAttribute("Visible", "true"), new XAttribute("Usage", "ofd-compose"),
                    new XElement(SafePackage.Ns + "FileLoc", "ofd-compose.json"))))));
            return new(SafePackage.Write(entries, budget), null);
        }
        catch (ContainerFailure error) { return new(null, error.Message); }
        catch (OperationCanceledException) { return new(null, "CANCELLED"); }
        catch (Exception error) when (Malformed(error)) { return new(null, "SCHEMA_INVALID"); }
    }

    public static ExtractionResult Extract(ReadOnlyMemory<byte> ofd, ContainerLimits? limits = null, CancellationToken cancellationToken = default)
    {
        try
        {
            var budget = new ContainerBudget(limits ?? new(), cancellationToken);
            var entries = SafePackage.Read(ofd, budget);
            Need(entries.TryGetValue(ManifestPath, out var manifestBytes), "SOURCE_MISSING");
            // Resource ceilings and XML/ZIP safety always precede logical protocol validation.
            using var parsed = SafePackage.Json(manifestBytes!, budget);
            var manifest = parsed.RootElement;
            Need(Text(manifest, "namespace") == "ofd-compose" && Text(manifest, "protocol") == Protocol, "PROTOCOL_INVALID");
            ValidateAttachment(entries, budget);
            Keys(manifest, "namespace", "protocol", "profile", "containerProfileVersion", "modelVersion", "irVersion", "irDigest", "capabilities", "provenance", "signaturePolicy", "parts", "entries", "objectMap");
            string profile = Text(manifest, "profile");
            Need(profile is "native-editable" or "distribution" && IsDigest(Text(manifest, "irDigest")), "SCHEMA_INVALID");
            Keys(manifest.GetProperty("provenance"), "producer", "parentArtifactDigest");
            Need(Text(manifest.GetProperty("provenance"), "producer") == "OFDCompose.Containers/0", "SCHEMA_INVALID");
            var parent = manifest.GetProperty("provenance").GetProperty("parentArtifactDigest");
            Need(parent.ValueKind == JsonValueKind.Null || IsDigest(parent.GetString()!), "SCHEMA_INVALID");
            var parts = manifest.GetProperty("parts");
            Need(parts.ValueKind == JsonValueKind.Array && parts.GetArrayLength() == (profile == "native-editable" ? 5 : 1), "SCHEMA_INVALID");
            var sourceParts = new Dictionary<string, string>();
            foreach (var part in parts.EnumerateArray())
            {
                Keys(part, "name", "mimeType", "sha256", "content");
                string name = Text(part, "name");
                Need(PartNames.Contains(name) && (profile=="native-editable"||name=="irDigest") && sourceParts.TryAdd(name, Text(part, "content")) && Text(part, "mimeType") == "application/json" && IsDigest(Text(part, "sha256")), "SCHEMA_INVALID");
            }
            string identityJson=sourceParts["irDigest"];
            Need(identityJson.Length==66 && identityJson[0]=='"' && identityJson[^1]=='"' && IsDigest(identityJson[1..^1]),"SCHEMA_INVALID");
            byte[]? sourceJson = null;
            JsonDocument? source = null;
            try
            {
                if (profile == "native-editable")
                {
                    budget.Charge(manifestBytes!.Length * 4L);
                    sourceJson = Encoding.UTF8.GetBytes("{" + string.Join(",", PartNames.Select(name => JsonSerializer.Serialize(name, ContainerJsonContext.Default.String) + ":" + sourceParts[name])) + "}");
                    source = Parse(sourceJson, budget);
                }
                var objectMap = ReadObjectMap(manifest.GetProperty("objectMap"), budget);
                ValidateInventory(manifest.GetProperty("entries"), entries, budget, schemaOnly: true);
                // Schema is validated before any digest comparison.
                foreach (var part in parts.EnumerateArray())
                    Need(SafePackage.Hash(Encoding.UTF8.GetBytes(Text(part, "content")), budget) == Text(part, "sha256"), "DIGEST_MISMATCH");
                Need(identityJson[1..^1]==Text(manifest,"irDigest"),"DIGEST_MISMATCH");
                ValidateInventory(manifest.GetProperty("entries"), entries, budget);
                var ofdXml=SafePackage.Xml(entries["OFD.xml"],budget);
                Need(ofdXml.Descendants(SafePackage.Ns+"DocID").Select(e=>e.Value).SequenceEqual([Text(manifest,"irDigest")[..32]]),"DIGEST_MISMATCH");
                var assets = new List<SourceAsset>();
                if (source is not null)
                {
                    var root = source.RootElement;
                    var links=Resources(root.GetProperty("resources"), root.GetProperty("resolvedDocument"), root.GetProperty("renderProfile"), entries, budget);
                    SemanticMap(root, objectMap, entries, links, budget);
                SourceVersions(root);
                    foreach (var image in root.GetProperty("resources").GetProperty("images").EnumerateArray())
                    {
                        string digest = Text(image, "sha256");
                        assets.Add(new(digest, entries[AssetPath(digest)]));
                    }
                    Need(Text(manifest, "modelVersion") == Text(root.GetProperty("resolvedDocument"), "modelVersion"), "VERSION_UNSUPPORTED");
                }
                else { Need(objectMap.Count == 0 && entries.Keys.All(p => IsWriterEntry(p) || p is ManifestPath or AttachmentsPath), "DISTRIBUTION_SOURCE_FORBIDDEN"); SafePackage.References(entries,budget,requirePageReachability:true); }
                Need(Text(manifest, "containerProfileVersion") == ProfileVersion && Text(manifest, "irVersion") == "ofd-compose/layout-ir@0" && Text(manifest, "modelVersion") == "0", "VERSION_UNSUPPORTED");
                string[] expected = profile == "native-editable" ? ["resolved-document", "semantic-map", "authorized-full-fonts"] : ["derived-no-source"];
                Need(manifest.GetProperty("capabilities").EnumerateArray().Select(e => e.GetString()).SequenceEqual(expected), "VERSION_UNSUPPORTED");
                Need(Text(manifest, "signaturePolicy") == "unsigned-or-unverified", "SIGNATURE_POLICY_UNSUPPORTED");
                return new(null, profile, sourceJson, assets, "internal-consistency-only", Signed(entries, budget) ? "present-unverified" : "unsigned");
            }
            finally { source?.Dispose(); }
        }
        catch (ContainerFailure error) { return new(error.Message); }
        catch (OperationCanceledException) { return new("CANCELLED"); }
        catch (Exception error) when (Malformed(error)) { return new("SCHEMA_INVALID"); }
    }
}
