using System.Text.Json.Serialization;

namespace OFDCompose.Containers;
internal sealed record SourcePart(string Name, string MimeType, string Sha256, string Content);
internal sealed record EntryIdentity(string Path, int ByteLength, string Sha256);
internal sealed record SourceProvenance(string Producer, string? ParentArtifactDigest);
internal sealed record SourceManifest(
    [property: JsonPropertyName("namespace")] string Namespace,
    string Protocol, string Profile, string ContainerProfileVersion, string ModelVersion,
    string IrVersion, string IrDigest, string[] Capabilities, SourceProvenance Provenance,
    string SignaturePolicy, List<SourcePart> Parts, EntryIdentity[] Entries,
    IReadOnlyDictionary<string, string[]> ObjectMap);
[JsonSourceGenerationOptions(PropertyNamingPolicy = JsonKnownNamingPolicy.CamelCase)]
[JsonSerializable(typeof(SourceManifest))]
[JsonSerializable(typeof(string))]
internal partial class ContainerJsonContext : JsonSerializerContext;
