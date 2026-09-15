using OFDCompose.FixedWriting;
using System.IO.Compression;
using System.Text;
using System.Xml;
using System.Xml.Linq;
using static OFDCompose.OfdIrWriter.J;

namespace OFDCompose.OfdIrWriter;

/// <summary>Narrow envelope adaptation for pinned Packaging, which omits required DocID.</summary>
internal static class PackageFinalizer
{
    internal static byte[] Complete(byte[] generated, string digest, IReadOnlyDictionary<string, string[]> objectMap, IReadOnlyDictionary<string, string> preciseMatrices, IReadOnlyDictionary<string, string> logicalTexts, WriterLimits limits)
    {
        using var input = new ZipArchive(new MemoryStream(generated, false), ZipArchiveMode.Read);
        Require(input.Entries.Count <= limits.ZipEntries, "RESOURCE_LIMIT", "output", "ZIP entry budget exceeded");
        long total = 0;
        var names = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var entry in input.Entries)
        {
            total += entry.Length;
            Require(total <= limits.OutputBytes && entry.Length <= limits.OutputBytes, "RESOURCE_LIMIT", "output", "Expanded output budget exceeded");
            Require(entry.FullName.Length <= 256 && entry.FullName.Split('/').All(s => s.Length > 0 && s != "." && s != "..") && !entry.FullName.Contains('\\') && !entry.FullName.Contains(':') && names.Add(entry.FullName), "IR_RESOURCE", "output", "Unsafe or duplicate output path");
        }
        using var output = new MemoryStream();
        var ids = new HashSet<string>(); var refs = new List<string>();
        using (var zip = new ZipArchive(output, ZipArchiveMode.Create, true))
        foreach (var entry in input.Entries.OrderBy(e => e.FullName, StringComparer.Ordinal))
        {
            using var source = entry.Open();
            byte[] bytes;
            if (entry.FullName.EndsWith(".xml", StringComparison.Ordinal))
            {
                using var reader = XmlReader.Create(source, new XmlReaderSettings { DtdProcessing = DtdProcessing.Prohibit, XmlResolver = null, MaxCharactersInDocument = limits.OutputBytes });
                var xml = XDocument.Load(reader, LoadOptions.PreserveWhitespace);
                if (entry.FullName == "OFD.xml")
                {
                    var info = xml.Descendants().Single(e => e.Name.LocalName == "DocInfo");
                    info.AddFirst(new XElement(info.Name.Namespace + "DocID", digest[..32]));
                }
                foreach(var element in xml.Descendants())
                    if(element.Attribute("ID") is {} id && preciseMatrices.TryGetValue(id.Value,out var matrix)) element.SetAttributeValue("CTM",matrix);
                foreach(var element in xml.Descendants())
                    if(element.Attribute("ID") is {} id && logicalTexts.TryGetValue(id.Value,out var text))
                        element.Elements().Single(e => e.Name.LocalName == "TextCode").Value = text;
                foreach (var attr in xml.Descendants().Attributes("ID")) Require(ids.Add(attr.Value), "IR_RESOURCE", "output", "Duplicate output ID");
                string directory=entry.FullName.Contains('/') ? entry.FullName[..(entry.FullName.LastIndexOf('/')+1)] : "";
                foreach(var location in xml.Descendants().Where(e => e.Name.LocalName is "DocRoot" or "PublicRes" or "DocumentRes" or "FontFile" or "MediaFile"))
                {
                    string resourceBase=location.Name.LocalName is "FontFile" or "MediaFile" ? (xml.Root?.Attribute("BaseLoc")?.Value ?? "") : "";
                    string targetPath=directory+(resourceBase.Length==0?"":resourceBase+"/")+location.Value;
                    Require(names.Contains(targetPath),"IR_REFERENCE","output","Dangling package resource path");
                }
                foreach(var page in xml.Descendants().Where(e => e.Name.LocalName=="Page" && e.Attribute("BaseLoc") is not null))
                    Require(names.Contains(directory+page.Attribute("BaseLoc")!.Value),"IR_REFERENCE","output","Dangling page path");
                refs.AddRange(xml.Descendants().Attributes().Where(a => a.Name.LocalName is "Font" or "ResourceID").Select(a => a.Value));
                using var serialized = new MemoryStream();
                using(var writer = XmlWriter.Create(serialized, new XmlWriterSettings { Encoding = new UTF8Encoding(false), NewLineHandling = NewLineHandling.Entitize, Indent = false })) xml.Save(writer);
                bytes = serialized.ToArray();
            }
            else { using var memory = new MemoryStream(); source.CopyTo(memory); bytes = memory.ToArray(); }
            Require(output.Length + bytes.Length + 4096 <= limits.OutputBytes, "RESOURCE_LIMIT", "output", "Final output budget exceeded");
            var target = zip.CreateEntry(entry.FullName, CompressionLevel.NoCompression);
            target.LastWriteTime = new DateTimeOffset(1980, 1, 1, 0, 0, 0, TimeSpan.Zero);
            using var sink = target.Open(); sink.Write(bytes);
        }
        Require(refs.All(ids.Contains) && objectMap.Values.SelectMany(x => x).All(ids.Contains), "IR_REFERENCE", "output", "Dangling output reference");
        Require(output.Length <= limits.OutputBytes, "RESOURCE_LIMIT", "output", "Final ZIP budget exceeded");
        return output.ToArray();
    }
}
