using OFDCompose.FixedWriting;
using System.Buffers.Binary;
using System.Text;
using System.Text.Json;
using static OFDCompose.PdfIrWriter.J;
namespace OFDCompose.PdfIrWriter;

internal sealed class PdfFont
{
    private readonly PdfObjects pdf;
    private readonly int descriptor;
    private readonly string name;
    private readonly bool cff;
    private string cidSystemInfo="/Registry (Adobe) /Ordering (Identity) /Supplement 0";
    private readonly Dictionary<int,int> glyphCids = [];
    private readonly Dictionary<uint,int>? subsetMap;
    private readonly List<Variant> variants = [];
    private sealed class Variant(int objectId, string name)
    {
        internal int ObjectId = objectId;
        internal string Name = name;
        internal Dictionary<int,(int Gid,string Text,double Width)> Codes = [];
    }
    internal PdfFont(PdfObjects pdf, JsonElement resource, byte[] bytes)
    {
        this.pdf=pdf; cff=bytes.AsSpan().StartsWith("OTTO"u8);
        name="OFC"+resource.S("subsetDigest")[..16];
        subsetMap=resource.Has("glyphIdMap")?resource.A("glyphIdMap").ToDictionary(g=>g.P("original").GetUInt32(),g=>g.I("subset")):null;
        var tables=new Dictionary<string,(int Offset,int Length)>();
        int U16(int at)=>BinaryPrimitives.ReadUInt16BigEndian(bytes.AsSpan(at));
        int I16(int at)=>BinaryPrimitives.ReadInt16BigEndian(bytes.AsSpan(at));
        for(int i=0;i<U16(4);i++){int at=12+i*16;tables.Add(Encoding.ASCII.GetString(bytes,at,4),((int)BinaryPrimitives.ReadUInt32BigEndian(bytes.AsSpan(at+8)),(int)BinaryPrimitives.ReadUInt32BigEndian(bytes.AsSpan(at+12))));}
        if(tables.TryGetValue("name",out var names))
        {
            int n=names.Offset;
            Require(names.Length>=6 && 6L+U16(n+2)*12<=names.Length,"IR_RESOURCE","font","Invalid name records");
            for(int i=0;i<U16(n+2);i++)
            {
                int at=n+6+i*12;
                if(U16(at+6)!=6 || U16(at)!=3)continue;
                int start=U16(n+4)+U16(at+10),length=U16(at+8);
                Require((long)start+length<=names.Length && length<=256,"IR_RESOURCE","font","Invalid PostScript name");
                string ps=Encoding.BigEndianUnicode.GetString(bytes,n+start,length);
                Require(ps.Length>0 && ps.All(c=>c>32&&c<127&&!"()<>[]{}/%#".Contains(c)),"IR_RESOURCE","font","Invalid PostScript name characters");
                name=ps;break;
            }
        }
        // Canonical resource ordinals are unique within this PDF: collision-free six-letter subset tags.
        int ordinal=int.Parse(resource.S("id")[1..],System.Globalization.CultureInfo.InvariantCulture);
        var tag=new char[6];for(int i=5;i>=0;i--){tag[i]=(char)('A'+ordinal%26);ordinal/=26;}
        name=new string(tag)+"+"+name;
        int head=tables["head"].Offset, hhea=tables["hhea"].Offset, os2=tables["OS/2"].Offset;
        double scale=1000d/U16(head+18);
        string Metric(int value)=>IrValidation.Number(value*scale);
        int count=U16(tables["maxp"].Offset+4);
        if(cff)
        {
            var data=bytes.AsSpan(tables["CFF "].Offset,tables["CFF "].Length);
            int at=data[2];FontStructure.Index(data,ref at);var top=FontStructure.Index(data,ref at);
            var strings=FontStructure.Index(data,ref at);
            var dict=FontStructure.Dict(data.Slice(top[0].Start,top[0].Length));
            if(dict.ContainsKey(1230))
            {
                var ros=dict[1230];
                Require(ros.Length==3 && ros[2]>=0,"IR_RESOURCE","font","Invalid CFF ROS");
                var encoded=new string[2];
                for(int i=0;i<2;i++)
                {
                    Require(ros[i]>=391 && ros[i]-391<strings.Count,"UNSUPPORTED_FEATURE","font","CFF ROS must use explicit registry/ordering strings in this profile");
                    var entry=strings[ros[i]-391];
                    Require(entry.Length<=128,"RESOURCE_LIMIT","font","CFF ROS string budget exceeded");
                    encoded[i]=Convert.ToHexString(data.Slice(entry.Start,entry.Length));
                }
                cidSystemInfo=$"/Registry <{encoded[0]}> /Ordering <{encoded[1]}> /Supplement {ros[2]}";
                int cursor=dict[15][0];int format=data[cursor++],gid=1;glyphCids.Add(0,0);
                var seen=new HashSet<int>{0};
                while(gid<count)
                {
                    int first=BinaryPrimitives.ReadUInt16BigEndian(data[cursor..]);cursor+=2;
                    int left=format==0?0:format==1?data[cursor++]:BinaryPrimitives.ReadUInt16BigEndian(data[cursor..]);if(format==2)cursor+=2;
                    for(int j=0;j<=left;j++){Require(seen.Add(first+j),"IR_RESOURCE","font","Duplicate CFF CID");glyphCids.Add(gid++,first+j);}
                }
            }
            else for(int gid=0;gid<count;gid++)glyphCids.Add(gid,gid);
        }
        int file=pdf.Stream(bytes,cff?" /Subtype /OpenType":$" /Length1 {bytes.Length}");
        double angle=0;bool fixedPitch=false;
        if(tables.TryGetValue("post",out var post))
        {
            Require(post.Length>=16,"IR_RESOURCE","font","Truncated post table");
            angle=BinaryPrimitives.ReadInt32BigEndian(bytes.AsSpan(post.Offset+4))/65536d;
            fixedPitch=BinaryPrimitives.ReadUInt32BigEndian(bytes.AsSpan(post.Offset+12))!=0;
        }
        int cap=tables["OS/2"].Length>=90 && U16(os2)>=2?I16(os2+88):I16(hhea+4);
        int flags=4+(fixedPitch?1:0)+(angle!=0?64:0);
        descriptor=pdf.Add($"<< /Type /FontDescriptor /FontName /{name} /Flags {flags} /FontBBox [{Metric(I16(head+36))} {Metric(I16(head+38))} {Metric(I16(head+40))} {Metric(I16(head+42))}] /ItalicAngle {IrValidation.Number(angle)} /Ascent {Metric(I16(hhea+4))} /Descent {Metric(I16(hhea+6))} /CapHeight {Metric(cap)} /StemV 80 /{(cff?"FontFile3":"FontFile2")} {file} 0 R >>");
    }
    internal (string Font,int Code) Code(uint original, string text, double width)
    {
        Require(text.Length<=256,"RESOURCE_LIMIT","font","ToUnicode destination exceeds 512-byte mapping budget");
        int gid=subsetMap is null?checked((int)original):subsetMap[original];
        foreach(var variant in variants)
        {
            if(cff)
            {
                int cid=glyphCids[gid];
                if(!variant.Codes.TryGetValue(cid,out var prior)){variant.Codes.Add(cid,(gid,text,width));return(variant.Name,cid);}
                if(prior==(gid,text,width))return(variant.Name,cid);
            }
            else
            {
                // Stable lookup, avoiding a per-glyph scan of all prior codes.
                if(codeLookup.TryGetValue((gid,text,width),out var found))return found;
                if(variant.Codes.Count<65535){int cid=variant.Codes.Count+1;variant.Codes.Add(cid,(gid,text,width));var result=(variant.Name,cid);codeLookup.Add((gid,text,width),result);return result;}
            }
        }
        Require(variants.Count<256,"RESOURCE_LIMIT","font","Font mapping variant budget exceeded");
        int id=pdf.Reserve();var added=new Variant(id,"F"+id);variants.Add(added);
        int code=cff?glyphCids[gid]:1;added.Codes.Add(code,(gid,text,width));
        if(!cff)codeLookup.Add((gid,text,width),(added.Name,code));
        return(added.Name,code);
    }
    private readonly Dictionary<(int,string,double),(string,int)> codeLookup=[];
    internal IEnumerable<string> Complete()
    {
        foreach(var v in variants)
        {
            var sorted=v.Codes.OrderBy(p=>p.Key).ToArray();
            var cmap=new StringBuilder("/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n/CMapName /OFCUnicode def\n/CMapType 2 def\n1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n");
            foreach(var batch in sorted.Chunk(100))
            {
                cmap.Append(batch.Length).Append(" beginbfchar\n");
                foreach(var p in batch)cmap.Append('<').Append(p.Key.ToString("X4")).Append("> <").Append(Convert.ToHexString(Encoding.BigEndianUnicode.GetBytes(p.Value.Text))).Append(">\n");
                cmap.Append("endbfchar\n");
            }
            cmap.Append("endcmap\nCMapName currentdict /CMap defineresource pop\nend\nend\n");
            int unicode=pdf.Stream(PdfObjects.Ascii(cmap.ToString()));
            string mapping="";
            if(!cff)
            {
                byte[] gids=new byte[(sorted[^1].Key+1)*2];
                foreach(var p in sorted)BinaryPrimitives.WriteUInt16BigEndian(gids.AsSpan(p.Key*2),(ushort)p.Value.Gid);
                mapping=$" /CIDToGIDMap {pdf.Stream(gids)} 0 R";
            }
            string widths=string.Join(" ",sorted.Select(p=>$"{p.Key} [{IrValidation.Number(p.Value.Width)}]"));
            int descendant=pdf.Add($"<< /Type /Font /Subtype /{(cff?"CIDFontType0":"CIDFontType2")} /BaseFont /{name} /CIDSystemInfo << {cidSystemInfo} >> /FontDescriptor {descriptor} 0 R /DW 0 /W [{widths}]{mapping} >>");
            pdf.Set(v.ObjectId,PdfObjects.Ascii($"<< /Type /Font /Subtype /Type0 /BaseFont /{name} /Encoding /Identity-H /DescendantFonts [{descendant} 0 R] /ToUnicode {unicode} 0 R >>"));
            yield return $"/{v.Name} {v.ObjectId} 0 R";
        }
    }
}
