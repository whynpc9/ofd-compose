using System.IO.Compression;
using ICSharpCode.SharpZipLib;
using ICSharpCode.SharpZipLib.Checksum;
using ICSharpCode.SharpZipLib.Zip.Compression;
using System.Buffers.Binary;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Xml;
using System.Xml.Linq;
using static OFDCompose.Containers.ContainerBudget;

namespace OFDCompose.Containers;

internal static class SafePackage
{
    internal static readonly XNamespace Ns = "http://www.ofdspec.org/2016";
    // Experimental native profile: only ordinary, explicit ASCII OFD entries. No normalization aliases.
    internal static void Path(string path)
    {
        Need(path.Length is > 0 and <= 256 && path.All(c => char.IsAsciiLetterOrDigit(c) || c is '_' or '-' or '.' or '/')
            && path.Split('/').All(p => p.Length > 0 && p is not "." and not ".."), "PACKAGE_PATH");
    }
    private static bool ProfilePath(string path) => System.Text.RegularExpressions.Regex.IsMatch(path,
        "^(OFD\\.xml|Doc_0/(Document\\.xml|PublicRes\\.xml|DocumentRes\\.xml|Pages/Page_[0-9]+/Content\\.xml|Res/[a-zA-Z0-9_.-]+\\.(otf|ttf|png|jpg|jpeg)|Attachs/(Attachments\\.xml|ofd-compose\\.json|Assets/[a-f0-9]{64}\\.bin)|Signs/[a-zA-Z0-9_/.-]+\\.(xml|dat|esl)))$",
        System.Text.RegularExpressions.RegexOptions.CultureInvariant, TimeSpan.FromSeconds(1));
    internal static Dictionary<string, byte[]> Read(ReadOnlyMemory<byte> input, ContainerBudget budget)
    {
        Need(input.Length <= budget.Limits.PackageBytes, "SIZE_LIMIT");
        budget.Charge(input.Length);
        var owned=input.ToArray();
        var payloads=PreflightDirectory(owned, budget);
        using var stream = new MemoryStream(owned, false);
        using var zip = new ZipArchive(stream, ZipArchiveMode.Read);
        // BCL ZIP metadata is bounded by the compressed package ceiling; entry payloads remain unopened.
        Need(zip.Entries.Count <= budget.Limits.Entries, "SIZE_LIMIT");
        Need(zip.Entries.Count==payloads.Count,"PACKAGE_INVALID");
        var names = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        long expanded = 0;
        foreach (var entry in zip.Entries)
        {
            budget.Charge(256);
            Path(entry.FullName);
            Need(names.Add(entry.FullName), "PACKAGE_DUPLICATE");
            Need(ProfilePath(entry.FullName), "UNEXPECTED_ENTRY");
            Need(entry.Length <= budget.Limits.EntryBytes && entry.Length <= budget.Limits.ExpandedBytes - expanded, "SIZE_LIMIT");
            expanded += entry.Length;
            // Reject extreme compression before inflation, including false zero-size declarations.
            Need(entry.Length <= Math.Max(1, entry.CompressedLength) * 200, "SIZE_LIMIT");
        }
        budget.Charge(expanded);
        var result = new Dictionary<string, byte[]>(StringComparer.Ordinal);
        for(int i=0;i<zip.Entries.Count;i++)
        {
            var entry=zip.Entries[i];var payload=payloads[i];
            Need(entry.FullName==payload.Name&&entry.Length==payload.Expanded&&entry.CompressedLength==payload.Compressed&&entry.Crc32==payload.Crc,"PACKAGE_INVALID");
            var bytes=DecodePayload(owned,payload,budget);
            if (entry.FullName.EndsWith(".xml", StringComparison.Ordinal)) Xml(bytes, budget, ExpectedRoot(entry.FullName));
            result.Add(entry.FullName, bytes);
        }
        return result;
    }
    private sealed record ZipPayload(string Name,int Offset,int Compressed,int Expanded,int Method,uint Crc);
    private static byte[] DecodePayload(byte[] archive,ZipPayload payload,ContainerBudget budget)
    {
        if(payload.Method==0)Need(payload.Compressed==payload.Expanded,"PACKAGE_SIZE");
        budget.Charge(payload.Expanded);var bytes=new byte[payload.Expanded];
        if(payload.Method==0)
        {
            for(int copied=0;copied<bytes.Length;)
            {budget.Charge(0);int count=Math.Min(65536,bytes.Length-copied);archive.AsSpan(payload.Offset+copied,count).CopyTo(bytes.AsSpan(copied,count));copied+=count;}
        }
        else
        {
            budget.Charge(256*1024);var inflater=new Inflater(true);var overflow=new byte[1];int fed=0,written=0;
            try
            {
                while(!inflater.IsFinished)
                {
                    budget.Charge(0);
                    if(inflater.IsNeedingInput&&fed<payload.Compressed)
                    {int count=Math.Min(65536,payload.Compressed-fed);budget.Charge(count);inflater.SetInput(archive,payload.Offset+fed,count);fed+=count;}
                    int available=Math.Min(65536,bytes.Length-written);
                    int produced=available>0?inflater.Inflate(bytes,written,available):inflater.Inflate(overflow,0,1);
                    budget.Charge(0);
                    if(available==0)Need(produced==0,"PACKAGE_SIZE");else written+=produced;
                    if(produced==0&&!inflater.IsFinished)Need(inflater.IsNeedingInput&&fed<payload.Compressed,"PACKAGE_INVALID");
                }
                Need(written==bytes.Length,"PACKAGE_SIZE");
                Need(fed==payload.Compressed&&inflater.RemainingInput==0,"PACKAGE_INVALID");
            }
            catch(SharpZipBaseException){throw new ContainerFailure("PACKAGE_INVALID");}
        }
        var crc=new Crc32();
        for(int offset=0;offset<bytes.Length;)
        {int count=Math.Min(65536,bytes.Length-offset);budget.Charge(count);crc.Update(new ArraySegment<byte>(bytes,offset,count));offset+=count;}
        Need((uint)crc.Value==payload.Crc,"PACKAGE_CRC_MISMATCH");
        return bytes;
    }
    internal static void References(Dictionary<string,byte[]> entries,ContainerBudget budget,bool requirePageReachability=false)
    {
        Need(entries.TryGetValue("OFD.xml",out var rootBytes) && entries.TryGetValue("Doc_0/Document.xml",out _),"PACKAGE_REFERENCE");
        var root=Xml(rootBytes!,budget,"OFD");
        Need(root.Descendants(Ns+"DocRoot").Select(e=>e.Value).SequenceEqual(["Doc_0/Document.xml"]),"PACKAGE_REFERENCE");
        var document=Xml(entries["Doc_0/Document.xml"],budget,"Document");
        foreach(string resourceName in new[]{"PublicRes","DocumentRes"})
        {
            string path="Doc_0/"+resourceName+".xml";
            Need(document.Descendants(Ns+resourceName).Select(e=>e.Value).SequenceEqual(entries.ContainsKey(path)?[resourceName+".xml"]:Array.Empty<string>()),"PACKAGE_REFERENCE");
        }
        var pages=document.Descendants(Ns+"Page").ToArray();
        Need(pages.Length is >0 and <=1000,"PACKAGE_REFERENCE");
        var pageEntries=entries.Keys.Where(p=>p.StartsWith("Doc_0/Pages/",StringComparison.Ordinal)).ToHashSet();
        for(int i=0;i<pages.Length;i++)
        {
            string path=$"Pages/Page_{i}/Content.xml";
            Need((string?)pages[i].Attribute("BaseLoc")==path && pageEntries.Remove("Doc_0/"+path),"PACKAGE_REFERENCE");
        }
        Need(pageEntries.Count==0,"PACKAGE_REFERENCE");
        var ids=new HashSet<string>();var resources=new HashSet<string>();var references=new List<string>();
        var resourcePaths=new HashSet<string>();var mediaFormats=new List<(string Format,byte[] Bytes)>();
        var fontDescriptors=new List<(string File,string? Name,string? Family,byte[] Bytes)>();
        foreach(var (path,bytes) in entries.Where(e=>e.Key.EndsWith(".xml",StringComparison.Ordinal)&&!e.Key.StartsWith("Doc_0/Signs/",StringComparison.Ordinal)))
        {
            var xml=Xml(bytes,budget);
            WriterXmlGrammar.Validate(xml,path,budget);
            foreach(var id in xml.Descendants().Attributes("ID"))
            {
                budget.Charge(32);Need(uint.TryParse(id.Value,System.Globalization.NumberStyles.None,System.Globalization.CultureInfo.InvariantCulture,out uint value)&&value>0&&id.Value==value.ToString(System.Globalization.CultureInfo.InvariantCulture)&&ids.Add(id.Value),"PACKAGE_REFERENCE");
            }
            if(path is "Doc_0/PublicRes.xml" or "Doc_0/DocumentRes.xml")
            {
                Need((string?)xml.Root!.Attribute("BaseLoc")=="Res","PACKAGE_REFERENCE");
                foreach(var location in xml.Descendants().Where(e=>e.Name.LocalName is "FontFile" or "MediaFile"))
                {
                    Path(location.Value);Need(!location.Value.Contains('/') && entries.ContainsKey("Doc_0/Res/"+location.Value),"RESOURCE_MISSING");resourcePaths.Add("Doc_0/Res/"+location.Value);
                    if(location.Name==Ns+"MediaFile")
                    {
                        budget.Charge(64);mediaFormats.Add(((string?)location.Parent!.Attribute("Format")??"",entries["Doc_0/Res/"+location.Value]));
                    }
                    else
                    {
                        budget.Charge(256);fontDescriptors.Add((location.Value,(string?)location.Parent!.Attribute("FontName"),(string?)location.Parent!.Attribute("FamilyName"),entries["Doc_0/Res/"+location.Value]));
                    }
                }
                foreach(var resource in xml.Descendants().Where(e=>e.Name.LocalName is "Font" or "MultiMedia"))resources.Add((string?)resource.Attribute("ID")??"");
            }
            if(path.StartsWith("Doc_0/Pages/",StringComparison.Ordinal))
                foreach(var element in xml.Root!.Elements(Ns+"Content").Elements(Ns+"Layer").Elements().Where(e=>e.Name.LocalName is "TextObject" or "ImageObject"))
                    references.Add((string?)element.Attribute(element.Name.LocalName=="TextObject"?"Font":"ResourceID")??"");
        }
        Need(uint.TryParse(document.Descendants(Ns+"MaxUnitID").Single().Value,System.Globalization.NumberStyles.None,System.Globalization.CultureInfo.InvariantCulture,out uint maximum),"PACKAGE_REFERENCE");
        Need(ids.All(id=>uint.Parse(id,System.Globalization.CultureInfo.InvariantCulture)<=maximum),"PACKAGE_REFERENCE");
        Need(references.All(resources.Contains),"RESOURCE_MISSING");
        if(requirePageReachability)Need(resources.SetEquals(references),"RESOURCE_ORPHAN");
        Need(resourcePaths.SetEquals(entries.Keys.Where(p=>p.StartsWith("Doc_0/Res/",StringComparison.Ordinal))),"RESOURCE_ORPHAN");
        foreach(var (file,name,family,font) in fontDescriptors)
        {
            budget.Charge(256);bool cff=font.AsSpan().StartsWith("OTTO"u8);
            // Match the fixed writer's admitted static SFNT flavors and naming convention.
            Need(font.Length>=12&&(cff||BinaryPrimitives.ReadUInt32BigEndian(font)==0x00010000),"RESOURCE_FONT_DESCRIPTOR_MISMATCH");
            string expected="Subset-"+Hash(font,budget);
            Need(name==expected&&family==expected&&file.EndsWith(cff?".otf":".ttf",StringComparison.Ordinal),"RESOURCE_FONT_DESCRIPTOR_MISMATCH");
        }
        foreach(var (format,image) in mediaFormats)
        {
            budget.Charge(32);
            bool png=format.Equals("PNG",StringComparison.OrdinalIgnoreCase),jpeg=format.Equals("JPEG",StringComparison.OrdinalIgnoreCase)||format.Equals("JPG",StringComparison.OrdinalIgnoreCase);
            Need(png&&image.AsSpan().StartsWith(new byte[]{137,80,78,71,13,10,26,10})||jpeg&&image.AsSpan().StartsWith(new byte[]{255,216,255}),"RESOURCE_FORMAT_MISMATCH");
        }
    }
    private static List<ZipPayload> PreflightDirectory(ReadOnlySpan<byte> bytes, ContainerBudget budget)
    {
        // Locate the non-ZIP64 EOCD before BCL can allocate central-directory objects.
        int end = -1;
        for (int i = bytes.Length - 22; i >= Math.Max(0, bytes.Length - 65557); i--)
            if (BinaryPrimitives.ReadUInt32LittleEndian(bytes[i..]) == 0x06054b50 && i + 22 + BinaryPrimitives.ReadUInt16LittleEndian(bytes[(i + 20)..]) == bytes.Length) { end = i; break; }
        Need(end >= 0, "PACKAGE_INVALID");
        var record = bytes[end..];
        Need(BinaryPrimitives.ReadUInt16LittleEndian(record[20..]) == 0, "PACKAGE_INVALID");
        int count = BinaryPrimitives.ReadUInt16LittleEndian(record[10..]);
        uint offset = BinaryPrimitives.ReadUInt32LittleEndian(record[16..]);
        uint length = BinaryPrimitives.ReadUInt32LittleEndian(record[12..]);
        Need(BinaryPrimitives.ReadUInt32LittleEndian(record[4..]) == 0 && count == BinaryPrimitives.ReadUInt16LittleEndian(record[8..]) && count < 65535, "PACKAGE_INVALID");
        Need(count <= budget.Limits.Entries, "SIZE_LIMIT");
        Need((long)offset + length == end, "PACKAGE_INVALID");
        int position = checked((int)offset);
        var ranges = new List<(int Start,int PayloadEnd,int Central,bool Descriptor)>();
        var payloads=new List<ZipPayload>();
        for (int n = 0; n < count; n++)
        {
            budget.Charge(46);
            Need(position + 46 <= end && BinaryPrimitives.ReadUInt32LittleEndian(bytes[position..]) == 0x02014b50, "PACKAGE_INVALID");
            int name = BinaryPrimitives.ReadUInt16LittleEndian(bytes[(position + 28)..]);
            int extra = BinaryPrimitives.ReadUInt16LittleEndian(bytes[(position + 30)..]);
            int comment = BinaryPrimitives.ReadUInt16LittleEndian(bytes[(position + 32)..]);
            Need(name is > 0 and <= 256 && position + 46L + name + extra + comment <= end, "PACKAGE_PATH");
            Need(extra == 0 && comment == 0, "PACKAGE_INVALID");
            Need(BinaryPrimitives.ReadUInt16LittleEndian(bytes[(position+34)..])==0,"PACKAGE_INVALID");
            uint local = BinaryPrimitives.ReadUInt32LittleEndian(bytes[(position + 42)..]);
            Need(local + 30L <= offset, "PACKAGE_INVALID");
            int start = checked((int)local);
            Need(BinaryPrimitives.ReadUInt32LittleEndian(bytes[start..]) == 0x04034b50, "PACKAGE_INVALID");
            int localName = BinaryPrimitives.ReadUInt16LittleEndian(bytes[(start + 26)..]);
            int localExtra = BinaryPrimitives.ReadUInt16LittleEndian(bytes[(start + 28)..]);
            Need(localName == name && localExtra == 0 && start + 30L + name <= offset, "PACKAGE_INVALID");
            Need(bytes.Slice(start + 30, name).SequenceEqual(bytes.Slice(position + 46, name)), "PACKAGE_PATH");
            uint compressed = BinaryPrimitives.ReadUInt32LittleEndian(bytes[(position + 20)..]);
            long payloadEnd = start + 30L + name + compressed;
            budget.Charge(64);
            Need(payloadEnd <= offset, "PACKAGE_INVALID");
            Need((BinaryPrimitives.ReadUInt16LittleEndian(bytes[(position + 8)..]) & 1) == 0, "PACKAGE_INVALID");
            ushort flags=BinaryPrimitives.ReadUInt16LittleEndian(bytes[(position+8)..]);
            Need(flags==BinaryPrimitives.ReadUInt16LittleEndian(bytes[(start+6)..]),"PACKAGE_INVALID");
            int method = BinaryPrimitives.ReadUInt16LittleEndian(bytes[(position + 10)..]);
            Need(method==BinaryPrimitives.ReadUInt16LittleEndian(bytes[(start+8)..]),"PACKAGE_INVALID");
            if((flags&8)==0)Need(bytes.Slice(start+14,12).SequenceEqual(bytes.Slice(position+16,12)),"PACKAGE_SIZE");
            else for(int field=0;field<3;field++)
            {
                uint localValue=BinaryPrimitives.ReadUInt32LittleEndian(bytes[(start+14+field*4)..]);
                Need(localValue==0||localValue==BinaryPrimitives.ReadUInt32LittleEndian(bytes[(position+16+field*4)..]),"PACKAGE_SIZE");
            }
            ranges.Add((start,checked((int)payloadEnd),position,(flags&8)!=0));
            Need(method is 0 or 8, "PACKAGE_INVALID");
            uint expanded = BinaryPrimitives.ReadUInt32LittleEndian(bytes[(position + 24)..]);
            Need(expanded <= budget.Limits.EntryBytes, "SIZE_LIMIT");
            budget.Charge(name*2L+128);string entryName=Encoding.ASCII.GetString(bytes.Slice(position+46,name));Path(entryName);
            payloads.Add(new(entryName,start+30+name,checked((int)compressed),checked((int)expanded),method,BinaryPrimitives.ReadUInt32LittleEndian(bytes[(position+16)..])));
            position += 46 + name + extra + comment;
        }
        Need(position == end, "PACKAGE_INVALID");
        budget.Charge(ranges.Count*64L);
        ranges.Sort((left,right)=>left.Start.CompareTo(right.Start));
        Need(ranges.Count==0?offset==0:ranges[0].Start==0,"PACKAGE_INVALID");
        for(int i=0;i<ranges.Count;i++)
        {
            budget.Charge(64);var range=ranges[i];int next=i+1<ranges.Count?ranges[i+1].Start:checked((int)offset);
            Need(range.PayloadEnd<=next,"PACKAGE_INVALID");int trailing=next-range.PayloadEnd;
            if(!range.Descriptor){Need(trailing==0,"PACKAGE_INVALID");continue;}
            // APPNOTE 4.3.9 permits a 12-byte descriptor, optionally preceded by its 4-byte signature.
            // The physical boundary disambiguates an unsigned descriptor whose CRC equals that signature.
            Need(trailing is 12 or 16,"PACKAGE_INVALID");int descriptor=range.PayloadEnd;
            if(trailing==16){Need(BinaryPrimitives.ReadUInt32LittleEndian(bytes[descriptor..])==0x08074b50,"PACKAGE_INVALID");descriptor+=4;}
            Need(bytes.Slice(descriptor,12).SequenceEqual(bytes.Slice(range.Central+16,12)),"PACKAGE_SIZE");
        }
        return payloads;
    }
    private static string? ExpectedRoot(string path) => path switch
    {
        "OFD.xml" => "OFD", "Doc_0/Document.xml" => "Document",
        "Doc_0/PublicRes.xml" or "Doc_0/DocumentRes.xml" => "Res",
        "Doc_0/Attachs/Attachments.xml" => "Attachments",
        _ when path.StartsWith("Doc_0/Pages/",StringComparison.Ordinal) && path.EndsWith("/Content.xml",StringComparison.Ordinal) => "Page",
        _ => null
    };
    internal static XDocument Xml(byte[] bytes, ContainerBudget budget, string? expectedRoot = null)
    {
        budget.Charge(bytes.Length * 4L);
        using var stream = new MemoryStream(bytes, false);
        using var reader = XmlReader.Create(stream, new XmlReaderSettings {
            DtdProcessing = DtdProcessing.Prohibit, XmlResolver = null,
            MaxCharactersInDocument = budget.Limits.EntryBytes, MaxCharactersFromEntities = 1 });
        int nodes = 0;
        while (reader.Read())
        {
            budget.Charge(32);
            Need(reader.Depth <= 64 && ++nodes <= 200_000, "SIZE_LIMIT");
        }
        stream.Position = 0;
        using var parsedReader = XmlReader.Create(stream, new XmlReaderSettings { DtdProcessing = DtdProcessing.Prohibit, XmlResolver = null, MaxCharactersInDocument = budget.Limits.EntryBytes });
        var result = XDocument.Load(parsedReader);
        Need(result.Root?.Name.Namespace == Ns && (expectedRoot is null || result.Root.Name.LocalName == expectedRoot), "PACKAGE_XML");
        return result;
    }
    internal static JsonDocument Json(ReadOnlyMemory<byte> bytes, ContainerBudget budget)
    {
        Need(bytes.Length <= budget.Limits.JsonBytes, "SIZE_LIMIT");
        budget.Charge(bytes.Length * 8L);
        bytes = bytes.ToArray();
        var scan = new Utf8JsonReader(bytes.Span, new JsonReaderOptions { MaxDepth = 64 });
        int tokens = 0, strings = 0;
        var scopes = new Stack<HashSet<string>>();
        while (scan.Read())
        {
            budget.Charge(1);
            Need(++tokens <= budget.Limits.JsonTokens, "SIZE_LIMIT");
            if (scan.TokenType == JsonTokenType.StartObject) scopes.Push(new(StringComparer.Ordinal));
            if (scan.TokenType == JsonTokenType.EndObject) scopes.Pop();
            if (scan.TokenType is JsonTokenType.String or JsonTokenType.PropertyName)
            {
                strings = checked(strings + scan.ValueSpan.Length);
                Need(strings <= budget.Limits.StringBytes, "SIZE_LIMIT");
                if (scan.TokenType == JsonTokenType.PropertyName) Need(scopes.Peek().Add(scan.GetString()!), "SCHEMA_INVALID");
            }
        }
        return JsonDocument.Parse(bytes, new JsonDocumentOptions { MaxDepth = 64 });
    }
    internal static string Hash(ReadOnlySpan<byte> bytes, ContainerBudget budget)
    { budget.Charge(bytes.Length); return Convert.ToHexStringLower(SHA256.HashData(bytes)); }
    internal static byte[] Write(Dictionary<string, byte[]> entries, ContainerBudget budget)
    {
        Need(entries.Count <= budget.Limits.Entries, "SIZE_LIMIT");
        Need(entries.Values.All(bytes => bytes.Length <= budget.Limits.EntryBytes), "SIZE_LIMIT");
        Need(entries.Values.Sum(bytes => (long)bytes.Length) <= budget.Limits.ExpandedBytes, "SIZE_LIMIT");
        long size = entries.Sum(e => (long)e.Value.Length + e.Key.Length * 2 + 256);
        Need(size <= budget.Limits.PackageBytes, "SIZE_LIMIT"); budget.Charge(size * 2);
        using var output = new MemoryStream();
        using (var zip = new ZipArchive(output, ZipArchiveMode.Create, true))
            foreach (var (name, bytes) in entries.OrderBy(e => e.Key, StringComparer.Ordinal))
            {
                budget.Charge(0);
                var entry = zip.CreateEntry(name, CompressionLevel.NoCompression);
                entry.LastWriteTime = new(1980, 1, 1, 0, 0, 0, TimeSpan.Zero);
                using var sink = entry.Open(); sink.Write(bytes);
            }
        Need(output.Length <= budget.Limits.PackageBytes, "SIZE_LIMIT");
        return output.ToArray();
    }
    internal static byte[] Encode(XDocument xml) => Encoding.UTF8.GetBytes(xml.ToString(SaveOptions.DisableFormatting));
}
