using System.Buffers.Binary;
#if PDF_WRITER
using OFDCompose.PdfIrWriter;
using static OFDCompose.PdfIrWriter.J;
#else
using OFDCompose.OfdIrWriter;
using static OFDCompose.OfdIrWriter.J;
#endif

namespace OFDCompose.FixedWriting;

/// <summary>Bounded static SFNT envelope and outline-index validation; no font execution or measurement.</summary>
internal static class FontStructure
{
    internal static void Validate(byte[] bytes, Dictionary<string, (int Offset, int Length)> tables, int glyphs,CancellationToken cancellationToken=default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        ReadOnlySpan<byte> Table(string name, int minimum)
        {
            Require(tables.TryGetValue(name, out var table) && table.Length >= minimum, "IR_RESOURCE", "font", "Missing/truncated font table " + name);
            return bytes.AsSpan(table.Offset, table.Length);
        }
        var head = Table("head", 54); var hhea = Table("hhea", 36);
        Require(U32(head,12)==0x5f0f3cf5 && U16(head,18) is >= 16 and <= 16384, "IR_RESOURCE", "font", "Invalid font header");
        int metrics = U16(hhea,34);
        Require(metrics > 0 && metrics <= glyphs, "IR_RESOURCE", "font", "Invalid horizontal metrics count");
        Table("hmtx", metrics*4+(glyphs-metrics)*2);
        // Check table checksums (head.checkSumAdjustment is zero for its table checksum).
        foreach (var t in tables)
        {
            cancellationToken.ThrowIfCancellationRequested();
            uint sum=Checksum(bytes.AsSpan(t.Value.Offset,t.Value.Length),t.Key=="head",cancellationToken);
            int directory=12;
            while(System.Text.Encoding.ASCII.GetString(bytes,directory,4)!=t.Key) directory+=16;
            Require(sum==U32(bytes,directory+4), "IR_RESOURCE", "font", "SFNT checksum mismatch");
        }
        Require(Checksum(bytes,false,cancellationToken)==0xb1b0afbAu,"IR_RESOURCE","font","SFNT whole-font checksum mismatch");
        if(tables.ContainsKey("CFF ")) { Cff(Table("CFF ",4),glyphs,cancellationToken); return; }
        int format=I16(head,50); Require(format is 0 or 1,"IR_RESOURCE","font","Invalid loca format");
        var loca=Table("loca",(glyphs+1)*(format==0?2:4)); var glyf=Table("glyf",0);
        var starts=new int[glyphs+1];
        for(int i=0;i<=glyphs;i++)
        {
            cancellationToken.ThrowIfCancellationRequested();
            long offset=format==0?U16(loca,i*2)*2L:U32(loca,i*4);
            Require(offset<=glyf.Length && (i==0 || offset>=starts[i-1]),"IR_RESOURCE","font","Invalid loca offsets");starts[i]=(int)offset;
        }
        var children=new List<int>[glyphs];
        long points=0;
        for(int g=0;g<glyphs;g++)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var record=glyf.Slice(starts[g],starts[g+1]-starts[g]); if(record.Length==0)continue;
            Require(record.Length>=10,"IR_RESOURCE","font","Truncated glyph"); int contours=I16(record,0),at=10;
            if(contours>=0)
            {
                Require(record.Length>=at+contours*2+2,"IR_RESOURCE","font","Truncated contour endpoints");
                int count=contours==0?0:U16(record,at+(contours-1)*2)+1;
                for(int c=1;c<contours;c++){if((c&255)==0)cancellationToken.ThrowIfCancellationRequested();Require(U16(record,at+c*2)>U16(record,at+(c-1)*2),"IR_RESOURCE","font","Invalid contour endpoints");}
                points+=count;Require(points<=2_000_000,"RESOURCE_LIMIT","font","Outline point budget exceeded");
                at+=contours*2;int instructions=U16(record,at);at+=2+instructions;
                Require(at<=record.Length,"IR_RESOURCE","font","Truncated glyph instructions");
                int coordinates=0;
                for(int p=0;p<count;)
                {
                    cancellationToken.ThrowIfCancellationRequested();
                    Require(at<record.Length,"IR_RESOURCE","font","Truncated glyph flags");int flags=record[at++],repeat=1;
                    if((flags&8)!=0){Require(at<record.Length,"IR_RESOURCE","font","Truncated flag repeat");repeat+=record[at++];}
                    Require(p+repeat<=count,"IR_RESOURCE","font","Glyph flag overflow");
                    coordinates+=repeat*(((flags&2)!=0?1:(flags&16)!=0?0:2)+((flags&4)!=0?1:(flags&32)!=0?0:2));p+=repeat;
                }
                Require(at+coordinates<=record.Length,"IR_RESOURCE","font","Truncated glyph coordinates");
            }
            else
            {
                Require(contours==-1,"IR_RESOURCE","font","Invalid composite contour marker");
                int flags; children[g]=[];
                do
                {
                    Require(at+4<=record.Length,"IR_RESOURCE","font","Truncated composite");flags=U16(record,at);int child=U16(record,at+2);at+=4;
                    Require(child<glyphs && children[g].Count<256,"IR_RESOURCE","font","Invalid composite reference");children[g].Add(child);
                    at+=(flags&1)!=0?4:2;at+=(flags&8)!=0?2:(flags&64)!=0?4:(flags&128)!=0?8:0;
                    Require(at<=record.Length,"IR_RESOURCE","font","Truncated composite transform");
                }while((flags&32)!=0);
                if((flags&256)!=0){Require(at+2<=record.Length,"IR_RESOURCE","font","Truncated composite instructions");Require(at+2+U16(record,at)<=record.Length,"IR_RESOURCE","font","Truncated composite instructions");}
            }
        }
        var visited=new byte[glyphs];
        void Visit(int glyph,int depth)
        {
            cancellationToken.ThrowIfCancellationRequested();
            Require(depth<=64 && visited[glyph]!=1,"IR_RESOURCE","font","Composite cycle/depth exceeded");if(visited[glyph]==2)return;
            visited[glyph]=1;if(children[glyph] is {} list)foreach(int child in list)Visit(child,depth+1);visited[glyph]=2;
        }
        for(int g=0;g<glyphs;g++)Visit(g,0);
    }
    private static void Cff(ReadOnlySpan<byte> cff,int glyphs,CancellationToken cancellationToken)
    {
        Require(cff[0]==1 && cff[2]>=4 && cff[2]<=cff.Length && cff[3] is >=1 and <=4,"IR_RESOURCE","font","Invalid CFF header");
        int at=cff[2]; var names=Index(cff,ref at,cancellationToken);var top=Index(cff,ref at,cancellationToken);Index(cff,ref at,cancellationToken);Index(cff,ref at,cancellationToken);
        Require(names.Count==1 && top.Count==1,"IR_RESOURCE","font","Expected one static CFF face");
        var dict=Dict(cff.Slice(top[0].Start,top[0].Length),cancellationToken);
        int Offset(int key) { Require(dict.TryGetValue(key,out var values) && values.Length==1,"IR_RESOURCE","font","Missing CFF offset");return values![0]; }
        int charStrings=Offset(17);
        Require(charStrings>=0 && charStrings<cff.Length,"IR_RESOURCE","font","Missing CharStrings index");
        var strings=Index(cff,ref charStrings,cancellationToken);Require(strings.Count==glyphs,"IR_RESOURCE","font","CFF glyph count mismatch");
        foreach(var item in strings)Require(item.Length>0,"IR_RESOURCE","font","Empty CFF charstring");
        Require(!dict.TryGetValue(15,out var charsetValues) || charsetValues.Length==1,"IR_RESOURCE","font","CFF charset operand");
        int charset=charsetValues is null?0:charsetValues[0];
        if(charset>2)
        {
            Require(charset<cff.Length,"IR_RESOURCE","font","CFF charset bounds");int format=cff[charset++],covered=1;
            Require(format<=2,"IR_RESOURCE","font","CFF charset format");
            while(covered<glyphs)
            {
            cancellationToken.ThrowIfCancellationRequested();
                int size=format==0?2:format==1?3:4;
                Require(charset+size<=cff.Length,"IR_RESOURCE","font","Truncated CFF charset");
                int left=format==0?0:format==1?cff[charset+2]:U16(cff,charset+2);
                Require((long)U16(cff,charset)+left<=65535,"IR_RESOURCE","font","CFF charset range overflow");
                covered+=left+1;charset+=size;
            }
            Require(covered==glyphs,"IR_RESOURCE","font","CFF charset coverage");
        }
        else
        {
            Require(charset>=0 && !dict.ContainsKey(1230),"IR_RESOURCE","font","CID CFF requires explicit charset");
            int coverage=charset switch {0=>229,1=>166,_=>87};
            Require(glyphs<=coverage,"IR_RESOURCE","font","Glyph count exceeds predefined CFF charset coverage");
        }
        Private(cff,dict,cancellationToken);
        if(dict.ContainsKey(1230))
        {
            int fdAt=Offset(1236);var fonts=Index(cff,ref fdAt,cancellationToken);
            Require(fonts.Count is >0 and <=256,"IR_RESOURCE","font","CFF FDArray count");
            foreach(var font in fonts)Private(cff,Dict(cff.Slice(font.Start,font.Length),cancellationToken),cancellationToken);
            int select=Offset(1237);Require(select>=0&&select<cff.Length,"IR_RESOURCE","font","CFF FDSelect offset");int format=cff[select++];
            if(format==0)
            {
                Require(select+glyphs<=cff.Length,"IR_RESOURCE","font","Truncated FDSelect");
                for(int g=0;g<glyphs;g++){if((g&255)==0)cancellationToken.ThrowIfCancellationRequested();Require(cff[select+g]<fonts.Count,"IR_RESOURCE","font","CFF FD reference");}
            }
            else
            {
                Require(format==3&&select+2<=cff.Length,"IR_RESOURCE","font","CFF FDSelect format");int ranges=U16(cff,select);select+=2;
                Require(ranges>0&&select+ranges*3+2<=cff.Length,"IR_RESOURCE","font","CFF FDSelect ranges");int previous=-1;
                for(int r=0;r<ranges;r++)
                {
            cancellationToken.ThrowIfCancellationRequested();
                    int first=U16(cff,select);Require(first>previous&&first<glyphs&&(r!=0||first==0)&&cff[select+2]<fonts.Count,"IR_RESOURCE","font","CFF FDSelect coverage");previous=first;select+=3;
                }
                Require(U16(cff,select)==glyphs,"IR_RESOURCE","font","CFF FDSelect sentinel");
            }
        }
    }
    private static void Private(ReadOnlySpan<byte> cff,Dictionary<int,int[]> dict,CancellationToken cancellationToken)
    {
        if(!dict.TryGetValue(18,out var values))return;
        Require(values.Length==2&&values[0]>=0&&values[1]>=0&&(long)values[0]+values[1]<=cff.Length,"IR_RESOURCE","font","CFF Private bounds");
        var privateDict=Dict(cff.Slice(values[1],values[0]),cancellationToken);
        if(privateDict.TryGetValue(19,out var subrs))
        {
            Require(subrs.Length==1&&subrs[0]>=0&&(long)values[1]+subrs[0]<cff.Length,"IR_RESOURCE","font","CFF Subrs bounds");int at=values[1]+subrs[0];Index(cff,ref at,cancellationToken);
        }
    }
    internal static Dictionary<int,int[]> Dict(ReadOnlySpan<byte> dict,CancellationToken cancellationToken=default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        var result=new Dictionary<int,int[]>();var operands=new List<int>();
        for(int i=0;i<dict.Length;)
        {
            cancellationToken.ThrowIfCancellationRequested();
            int b=dict[i++];
            if(b>=32 && b<=246)operands.Add(b-139);
            else if(b>=247 && b<=254){Require(i<dict.Length,"IR_RESOURCE","font","CFF DICT number");operands.Add(b<=250?(b-247)*256+dict[i++]+108:-(b-251)*256-dict[i++]-108);}
            else if(b==28){Require(i+2<=dict.Length,"IR_RESOURCE","font","CFF DICT number");operands.Add(I16(dict,i));i+=2;}
            else if(b==29){Require(i+4<=dict.Length,"IR_RESOURCE","font","CFF DICT number");operands.Add(BinaryPrimitives.ReadInt32BigEndian(dict[i..]));i+=4;}
            else if(b==30){bool end=false;while(i<dict.Length&&!end){if((i&4095)==0)cancellationToken.ThrowIfCancellationRequested();int pair=dict[i++];end=(pair&15)==15||(pair>>4)==15;}Require(end,"IR_RESOURCE","font","CFF real number");operands.Add(0);}
            else
            {
                Require(b<=21,"IR_RESOURCE","font","CFF DICT operator");
                if(b==12){Require(i<dict.Length,"IR_RESOURCE","font","CFF escaped operator");b=1200+dict[i++];}
                Require(!result.ContainsKey(b),"IR_RESOURCE","font","Duplicate CFF DICT operator");result.Add(b,operands.ToArray());operands.Clear();
            }
            Require(operands.Count<=48,"IR_RESOURCE","font","CFF operand stack exceeded");
        }
        Require(operands.Count==0,"IR_RESOURCE","font","Unterminated CFF DICT");return result;
    }
    internal static List<(int Start,int Length)> Index(ReadOnlySpan<byte> data,ref int at,CancellationToken cancellationToken=default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        Require(at>=0&&at+2<=data.Length,"IR_RESOURCE","font","Truncated CFF INDEX");int count=U16(data,at);at+=2;var result=new List<(int,int)>();if(count==0)return result;
        Require(at<data.Length,"IR_RESOURCE","font","Truncated CFF INDEX");int size=data[at++];Require(size is >=1 and <=4 && (long)at+(count+1)*size<=data.Length,"IR_RESOURCE","font","Invalid CFF INDEX offsets");
        int start=at+(count+1)*size,previous=1;
        for(int i=0;i<=count;i++)
        {
            cancellationToken.ThrowIfCancellationRequested();
            long offset=0;for(int b=0;b<size;b++)offset=(offset<<8)|data[at++];
            Require(offset>=previous && start+offset-1<=data.Length && (i!=0||offset==1),"IR_RESOURCE","font","CFF INDEX bounds");
            if(i>0)result.Add((start+previous-1,(int)offset-previous));previous=(int)offset;
        }
        at=start+previous-1;return result;
    }
    private static uint Checksum(ReadOnlySpan<byte> bytes,bool zeroAdjustment=false,CancellationToken cancellationToken=default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        uint sum=0;
        for(int i=0;i<bytes.Length;i+=4)
        {
            if((i&4095)==0)cancellationToken.ThrowIfCancellationRequested();
            uint word=0;for(int b=0;b<4;b++)word=(word<<8)|(i+b<bytes.Length?bytes[i+b]:0u);
            if(zeroAdjustment&&i==8)word=0;
            sum=unchecked(sum+word);
        }
        return sum;
    }
    private static ushort U16(ReadOnlySpan<byte> b,int at)=>BinaryPrimitives.ReadUInt16BigEndian(b[at..]);
    private static short I16(ReadOnlySpan<byte> b,int at)=>BinaryPrimitives.ReadInt16BigEndian(b[at..]);
    private static uint U32(ReadOnlySpan<byte> b,int at)=>BinaryPrimitives.ReadUInt32BigEndian(b[at..]);
}
