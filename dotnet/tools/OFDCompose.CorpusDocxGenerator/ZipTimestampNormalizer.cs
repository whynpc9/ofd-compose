using System.IO.Compression;
using System.Text;
using System.Text.RegularExpressions;

namespace OFDCompose.CorpusDocxGenerator;

/// <summary>
/// Rewrites a DOCX (zip) package so generated files are byte-identical across runs:
/// fixed entry timestamps, a fixed core-properties part name (System.IO.Packaging
/// otherwise invents a GUID-named .psmdcp part), and renumbered relationship IDs.
/// Entry order and entry content are otherwise preserved.
/// </summary>
internal static class ZipTimestampNormalizer
{
    private const string CorePropertiesPrefix = "package/services/metadata/core-properties/";
    private const string CorePropertiesFixedName = CorePropertiesPrefix + "core.psmdcp";

    private static readonly DateTimeOffset FixedTimestamp = new(1980, 1, 1, 0, 0, 0, TimeSpan.Zero);
    private static readonly Regex RelationshipIdRegex = new(@" Id=""[^""]*""", RegexOptions.Compiled);

    public static void Normalize(string path)
    {
        var entries = new List<(string Name, byte[] Content)>();
        using (var source = ZipFile.OpenRead(path))
        {
            foreach (var entry in source.Entries)
            {
                using var entryStream = entry.Open();
                using var memory = new MemoryStream();
                entryStream.CopyTo(memory);
                entries.Add((entry.FullName, memory.ToArray()));
            }
        }

        var corePropertiesName = entries
            .Where(entry => entry.Name.StartsWith(CorePropertiesPrefix, StringComparison.Ordinal)
                && entry.Name.EndsWith(".psmdcp", StringComparison.Ordinal))
            .Select(static entry => entry.Name)
            .SingleOrDefault();

        using (var fileStream = File.Create(path))
        using (var archive = new ZipArchive(fileStream, ZipArchiveMode.Create))
        {
            foreach (var (name, content) in entries)
            {
                var normalizedName = name;
                var normalizedContent = content;
                if (name == corePropertiesName)
                {
                    normalizedName = CorePropertiesFixedName;
                }
                else if (name.EndsWith(".rels", StringComparison.Ordinal))
                {
                    var text = Encoding.UTF8.GetString(content);
                    if (corePropertiesName != null)
                    {
                        text = text.Replace(
                            "/" + corePropertiesName,
                            "/" + CorePropertiesFixedName,
                            StringComparison.Ordinal);
                    }

                    var nextId = 0;
                    text = RelationshipIdRegex.Replace(text, _ => $" Id=\"R{++nextId}\"");
                    normalizedContent = Encoding.UTF8.GetBytes(text);
                }

                var entry = archive.CreateEntry(normalizedName, CompressionLevel.Optimal);
                entry.LastWriteTime = FixedTimestamp;
                using var entryStream = entry.Open();
                entryStream.Write(normalizedContent);
            }
        }
    }
}
