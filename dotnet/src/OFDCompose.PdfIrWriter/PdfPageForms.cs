using System.Text;
namespace OFDCompose.PdfIrWriter;

internal sealed record PdfGlyphSpan(int Start,int Length,int ClusterId);
internal sealed record PdfPrimitiveSpan(string Id,string? TextGroup,int Start,int Length,List<PdfGlyphSpan>? IsolatedGlyphs,bool LeadingSpace,bool TrailingSpace);

/// <summary>Groups consecutive paint operations without changing their coordinates or order.</summary>
internal static class PdfPageForms
{
    internal static int Emit(PdfObjects pdf,int pageId,string original,int prefixLength,
        IReadOnlyList<PdfPrimitiveSpan> primitives,string bbox,int resources,List<int> forms,
        Dictionary<string,string[]> objectMap)
    {
        var page=new StringBuilder(original[..prefixLength]);var pending=new StringBuilder();
        var members=new List<(string Id,int Start,int Length)>();
        var locations=new Dictionary<string,List<(int Stream,int Start,int Length)>>();int? group=null;
        var groupIds=new int[primitives.Count];Array.Fill(groupIds,-1);var groupSizes=new Dictionary<int,int>();
        PdfPrimitiveSpan? previousText=null;int currentGroup=-1;
        for(int i=0;i<primitives.Count;i++)
        {
            pdf.CheckCancellation();var item=primitives[i];if(item.TextGroup is null)continue;
            bool connected=previousText is not null&&(previousText.TextGroup==item.TextGroup||previousText.TrailingSpace||item.LeadingSpace);
            if(!connected)currentGroup++;
            groupIds[i]=currentGroup;groupSizes[currentGroup]=groupSizes.GetValueOrDefault(currentGroup)+1;previousText=item;
        }
        void Add(string id,int stream,int start,int length)
        {
            pdf.CheckCancellation();
            if(!locations.TryGetValue(id,out var list))locations.Add(id,list=[]);
            list.Add((stream,start,length));
        }
        void Form(string text,IReadOnlyList<(string Id,int Start,int Length)> contentMembers)
        {
            pdf.CheckCancellation();
            int form=pdf.Stream(PdfObjects.Ascii(text),$" /Type /XObject /Subtype /Form /FormType 1 /BBox {bbox} /Resources {resources} 0 R");
            forms.Add(form);int start=page.Length;page.Append($"/T{form} Do\n");int length=page.Length-start;
            foreach(var member in contentMembers){Add(member.Id,0,start,length);Add(member.Id,form,member.Start,member.Length);}
        }
        void Flush()
        {
            if(pending.Length==0)return;
            Form(pending.ToString(),members);pending.Clear();members.Clear();group=null;
        }
        for(int primitiveIndex=0;primitiveIndex<primitives.Count;primitiveIndex++)
        {
            var primitive=primitives[primitiveIndex];
            pdf.CheckCancellation();
            if(primitive.IsolatedGlyphs is {Count:>0} glyphs&&groupSizes[groupIds[primitiveIndex]]==1)
            {
                Flush();
                string prefix=original.Substring(primitive.Start,glyphs[0].Start-primitive.Start);
                int end=glyphs[^1].Start+glyphs[^1].Length;
                string suffix=original.Substring(end,primitive.Start+primitive.Length-end);
                // Preserve original paint order, including noncontiguous cluster memberships.
                for(int first=0;first<glyphs.Count;)
                {
                    int last=first;
                    while(last+1<glyphs.Count&&glyphs[last+1].ClusterId==glyphs[first].ClusterId)last++;
                    string body=prefix+original.Substring(glyphs[first].Start,glyphs[last].Start+glyphs[last].Length-glyphs[first].Start)+suffix;
                    Form(body,[(primitive.Id,0,body.Length)]);first=last+1;
                }
                continue;
            }
            if(primitive.TextGroup is not null)
            {
                int next=groupIds[primitiveIndex];
                if(group is not null&&group!=next)Flush();
                group=next;
            }
            int offset=pending.Length;pending.Append(original,primitive.Start,primitive.Length);
            members.Add((primitive.Id,offset,primitive.Length));
        }
        Flush();page.Append("Q\n");int stream=pdf.Stream(PdfObjects.Ascii(page.ToString()));
        foreach(var pair in locations)
        {
            pdf.CheckCancellation();
            objectMap.Add(pair.Key,[$"page:{pageId}",..pair.Value.Select(p=>{pdf.CheckCancellation();return $"stream:{(p.Stream==0?stream:p.Stream)}:decoded-byte:{p.Start}:length:{p.Length}";})]);
        }
        return stream;
    }
}
