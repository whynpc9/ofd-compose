using OFDCompose.FixedWriting;
using System.Text;
using System.Text.Json;
using BigGustave;
using JpegLibrary;
using static OFDCompose.PdfIrWriter.J;
namespace OFDCompose.PdfIrWriter;

/// <summary>Serializes frozen primitives and owned Worker resources; never shapes or subsets.</summary>
public sealed class PdfIrWriter
{
    private const double Pt = 72d/25400;
    private static string F(double n)=>IrValidation.Number(n);
    private static string Matrix(JsonElement m)=>$"{F(m.N("a"))} {F(m.N("b"))} {F(m.N("c"))} {F(m.N("d"))} {F(m.N("e"))} {F(m.N("f"))} cm\n";
    public Task<PdfWriteResult> WriteAsync(ReadOnlyMemory<byte> canonicalIr,string irDigest,IReadOnlyList<WriterResource> resources,WriterLimits? limits=null,CancellationToken cancellationToken=default)
    {
        limits??=new();
        try
        {
            limits.Validate();cancellationToken.ThrowIfCancellationRequested();
            Require(resources.Count<=limits.Resources,"RESOURCE_LIMIT","resources","Resource count exceeded");
            using var document=IrValidation.Parse(canonicalIr,irDigest,limits,cancellationToken);var ir=document.RootElement;
            long estimate=canonicalIr.Length*12L+resources.Sum(r=>(long)r.Bytes.Length)*3+65536;
            cancellationToken.ThrowIfCancellationRequested();Require(estimate<=limits.OutputBytes,"RESOURCE_LIMIT","output","Output allocation reservation exceeded");
            foreach(var page in ir.A("pages"))
            {
                cancellationToken.ThrowIfCancellationRequested();
                Require(page.N("width")<=5080000&&page.N("height")<=5080000,"UNSUPPORTED_FEATURE",page.S("id"),"PDF page dimensions exceed 14400 default user units; UserUnit scaling is not supported");
            }
            var states=ir.A("graphicsStates").ToDictionary(s=>s.S("id"));
            var stateSizes=states.ToDictionary(p=>p.Key,p=>p.Value.GetRawText().Length);
            var semantics=ir.A("semantics").ToDictionary(s=>s.S("objectId"));
            double previousReadingOrder=-1;
            foreach(var page in ir.A("pages"))foreach(var obj in page.A("objects"))
            {
                cancellationToken.ThrowIfCancellationRequested();
                if(obj.S("kind")!="text"||obj.S("logicalText").Length==0||!semantics.TryGetValue(obj.S("id"),out var semantic))continue;
                double readingOrder=semantic.N("readingOrder");
                Require(readingOrder>previousReadingOrder,"UNSUPPORTED_FEATURE",obj.S("id"),"Text semantic reading order conflicts with page/paint order in the untagged PDF profile");
                previousReadingOrder=readingOrder;
            }
            bool Isolated(JsonElement obj)
            {
                if(obj.S("kind")!="text"||semantics.ContainsKey(obj.S("id"))||obj.S("logicalText").Any(PdfJsWhitespace))return false;
                int previous=-1;
                foreach(var glyph in obj.A("glyphs")){cancellationToken.ThrowIfCancellationRequested();int cluster=glyph.I("clusterId");if(cluster<previous)return false;previous=cluster;}
                return true;
            }
            long expandedClips=ir.A("graphicsStates").Where(state=>state.Has("clip")).Sum(state=>(long)state.P("clip").P("commands").GetArrayLength());
            foreach(var page in ir.A("pages"))foreach(var obj in page.A("objects"))
            {
                cancellationToken.ThrowIfCancellationRequested();long repetitions=Isolated(obj)?Math.Max(1,obj.P("glyphs").GetArrayLength()):1;
                if(obj.Has("commands"))expandedClips+=obj.P("commands").GetArrayLength();
                if(obj.Has("clip"))expandedClips+=obj.P("clip").P("commands").GetArrayLength();
                var state=states[obj.S("stateId")];
                estimate+=repetitions*(2048L+stateSizes[obj.S("stateId")]*12L);
                Require(estimate<=limits.OutputBytes,"RESOURCE_LIMIT","output","Output allocation reservation exceeded");
                if(state.Has("clip"))expandedClips+=repetitions*state.P("clip").P("commands").GetArrayLength();
            }
            Require(expandedClips<=limits.Commands,"RESOURCE_LIMIT","clips","Form clip expansion budget exceeded");
            foreach(var resource in ir.A("resources"))if(resource.S("kind")=="image")estimate+=(long)resource.I("pixelWidth")*resource.I("pixelHeight")*8;
            Require(estimate<=limits.OutputBytes,"RESOURCE_LIMIT","output","Output allocation reservation exceeded");
            var owned=ResourceValidation.Validate(ir,resources,limits,cancellationToken);cancellationToken.ThrowIfCancellationRequested();
            var pdf=new PdfObjects(limits.OutputBytes,cancellationToken);int catalog=pdf.Reserve(),tree=pdf.Reserve(),pageResources=pdf.Reserve(),formResources=pdf.Reserve();
            var fonts=new Dictionary<string,PdfFont>();var images=new Dictionary<string,int>();
            var descriptors=ir.A("resources").ToDictionary(r=>r.S("id"));
            foreach(var r in descriptors.Values)
                if(r.S("kind")=="font")fonts.Add(r.S("id"),new(pdf,r,owned[r.S("id")]));else images.Add(r.S("id"),Image(pdf,r,owned[r.S("id")],cancellationToken));
            var alphas=new Dictionary<string,int>();
            foreach(var s in states.Values)alphas.Add(s.S("id"),pdf.Add($"<< /Type /ExtGState /ca {F(s.N("opacity"))} /CA {F(s.N("opacity"))} >>"));
            var map=new Dictionary<string,string[]>();var pages=new List<int>();var forms=new List<int>();
            foreach(var page in ir.A("pages"))
            {
                cancellationToken.ThrowIfCancellationRequested();int pageId=pdf.Reserve();pages.Add(pageId);
                var content=new StringBuilder($"q\n{F(Pt)} 0 0 {F(-Pt)} 0 {F(page.N("height")*Pt)} cm\n");
                int prefixLength=content.Length;var spans=new List<PdfPrimitiveSpan>();
                foreach(var obj in page.A("objects"))
                {
                    cancellationToken.ThrowIfCancellationRequested();
                    int start=content.Length;var state=states[obj.S("stateId")];content.Append("q\n");
                    List<PdfGlyphSpan>? glyphSpans=Isolated(obj)?[]:null;var boundary=(LeadingSpace:false,TrailingSpace:false);
                    // Install a local clip under its transform, then restore the CTM without restoring the clip.
                    // A nested q/Q would also restore the clip. Instead emit transformed clip coordinates.
                    if(state.Has("clip")){Commands(content,state.P("clip").A("commands"),cancellationToken,state.P("transform"));content.Append(state.P("clip").S("fillRule")=="evenodd"?"W* n\n":"W n\n");}
                    bool pagePath=obj.S("kind")=="path"&&obj.S("coordinateSpace")=="page";
                    if(!pagePath)content.Append(Matrix(state.P("transform")));
                    content.Append($"/G{alphas[state.S("id")]} gs\n");
                    Color(content,state.P("fillColor"),"rg");Color(content,state.P("strokeColor"),"RG");
                    content.Append($"{F(state.N("lineWidth"))} w\n{(state.S("lineCap")=="round"?1:state.S("lineCap")=="square"?2:0)} J\n{(state.S("lineJoin")=="round"?1:state.S("lineJoin")=="bevel"?2:0)} j\n{F(state.N("miterLimit"))} M\n[{string.Join(" ",state.A("dash").Select(n=>F(n.GetDouble())))}] {F(state.N("dashOffset"))} d\n");
                    switch(obj.S("kind"))
                    {
                        case "text":boundary=Text(content,obj,fonts[obj.S("fontId")],cancellationToken,glyphSpans);break;
                        case "path":Commands(content,obj.A("commands"),cancellationToken);bool fill=obj.P("fill").GetBoolean(),stroke=obj.P("stroke").GetBoolean();content.Append(fill?(stroke?"B":"f")+(obj.S("fillRule")=="evenodd"?"*":""):stroke?"S":"n").Append('\n');break;
                        case "image":
                            content.Append(Matrix(obj.P("transform")));
                            if(obj.Has("clip")){Commands(content,obj.P("clip").A("commands"),cancellationToken);content.Append(obj.P("clip").S("fillRule")=="evenodd"?"W* n\n":"W n\n");}
                            var r=descriptors[obj.S("resourceId")];
                            // Linear image coefficients stay mm/pixel in canonical IR, while translations
                            // and local clip coordinates are canonical um. Scale the unit-image extents only.
                            content.Append($"{F(1000d*r.I("pixelWidth"))} 0 0 {F(-1000d*r.I("pixelHeight"))} 0 {F(1000d*r.I("pixelHeight"))} cm\n/I{images[r.S("id")]} Do\n");break;
                    }
                    content.Append("Q\n");
                    string? group=null;
                    if(obj.S("kind")=="text")group=semantics.TryGetValue(obj.S("id"),out var semantic)
                        ?"semantic:"+string.Join("|",new[]{"nodeId","repeatInstance","table","sectionId"}.Select(k=>semantic.Has(k)?semantic.P(k).GetRawText():"null")):"fallback:"+obj.S("id");
                    spans.Add(new(obj.S("id"),group,start,content.Length-start,glyphSpans,boundary.LeadingSpace,boundary.TrailingSpace));
                }
                int stream=PdfPageForms.Emit(pdf,pageId,content.ToString(),prefixLength,spans,
                    $"[0 0 {F(page.N("width"))} {F(page.N("height"))}]",formResources,forms,map);
                pdf.Set(pageId,PdfObjects.Ascii($"<< /Type /Page /Parent {tree} 0 R /MediaBox [0 0 {F(page.N("width")*Pt)} {F(page.N("height")*Pt)}] /Resources {pageResources} 0 R /Contents {stream} 0 R >>"));
            }
            var fontRefs=fonts.Values.SelectMany(f=>f.Complete()).ToArray();
            string fontDictionary=$"/Font << {string.Join(" ",fontRefs)} >>";
            string imageDictionary=string.Join(" ",images.Values.Select(id=>$"/I{id} {id} 0 R"));
            string graphicsDictionary=$"/ExtGState << {string.Join(" ",alphas.Values.Select(id=>$"/G{id} {id} 0 R"))} >>";
            pdf.Set(formResources,PdfObjects.Ascii($"<< {fontDictionary} /XObject << {imageDictionary} >> {graphicsDictionary} >>"));
            pdf.Set(pageResources,PdfObjects.Ascii($"<< /XObject << {string.Join(" ",forms.Select(id=>$"/T{id} {id} 0 R"))} >> >>"));
            pdf.Set(tree,PdfObjects.Ascii($"<< /Type /Pages /Count {pages.Count} /Kids [{string.Join(" ",pages.Select(id=>$"{id} 0 R"))}] >>"));
            pdf.Set(catalog,PdfObjects.Ascii($"<< /Type /Catalog /Pages {tree} 0 R >>"));
            var output=pdf.Finish(catalog,irDigest);cancellationToken.ThrowIfCancellationRequested();
            return Task.FromResult(new PdfWriteResult(output,map,[]));
        }
        catch(WriterFailure f){cancellationToken.ThrowIfCancellationRequested();return Task.FromResult(new PdfWriteResult(null,null,[f.Diagnostic]));}
        catch(Exception e)when(e is JsonException or InvalidOperationException or ArgumentException or InvalidDataException or OverflowException or FormatException or EndOfStreamException or IndexOutOfRangeException or NotSupportedException)
        {cancellationToken.ThrowIfCancellationRequested();return Task.FromResult(new PdfWriteResult(null,null,[new("IR_RESOURCE","input",e.GetType().Name)]));}
    }
    private static (bool LeadingSpace,bool TrailingSpace) Text(StringBuilder b,JsonElement obj,PdfFont font,CancellationToken cancellationToken,List<PdfGlyphSpan>? glyphSpans=null)
    {
        var glyphs=obj.A("glyphs").ToArray();string logical=obj.S("logicalText");int end=0;
        Require(glyphs.Length>0||logical.Length==0,"UNSUPPORTED_FEATURE",obj.S("id"),"Nonempty logical text without painted glyphs cannot be represented by ToUnicode");
        var texts=new string[glyphs.Length];
        foreach(var cluster in obj.A("clusters"))
        {
            cancellationToken.ThrowIfCancellationRequested();
            var range=cluster.P("logicalRange");int start=range.I("start"),stop=range.I("end");
            Require(start==end&&stop>start,"UNSUPPORTED_FEATURE",obj.S("id"),"ToUnicode requires an exact nonoverlapping logical cluster partition");end=stop;
            var indices=cluster.A("glyphIndices").Select(x=>x.GetInt32()).ToArray();
            Require(indices.Length>0,"UNSUPPORTED_FEATURE",obj.S("id"),"Nonempty cluster has no glyph");
            int cursor=start;
            for(int i=0;i<indices.Length;i++)
            {
                if((i&255)==0)cancellationToken.ThrowIfCancellationRequested();
                Require(cursor<stop,"UNSUPPORTED_FEATURE",obj.S("id"),"Cluster has more glyphs than Unicode scalars; no lossless per-glyph ToUnicode partition");
                int next=i==indices.Length-1?stop:cursor+(char.IsHighSurrogate(logical[cursor])?2:1);
                Require(next-cursor<=256,"RESOURCE_LIMIT",obj.S("id"),"ToUnicode destination exceeds 512-byte mapping budget");
                string mapped=logical[cursor..next];
                Require(!PdfJsDropsMapping(mapped),"UNSUPPORTED_FEATURE",obj.S("id"),
                    "Glyph mapping is omitted or loses printable text in the pinned pdf.js extraction profile");
                texts[indices[i]]=mapped;cursor=next;
            }
        }
        Require(end==logical.Length,"UNSUPPORTED_FEATURE",obj.S("id"),"Incomplete logical partition");
        // Array order may be the shaper's visual order. Keep the original glyph identities
        // and absolute geometry, while encoding this text primitive in logical cluster order.
        var order=obj.A("clusters").SelectMany(c=>c.A("glyphIndices").Select(i=>i.GetInt32())).ToArray();
        Require(string.Concat(order.Select(i=>texts[i]))==logical,"UNSUPPORTED_FEATURE",obj.S("id"),"Clusters do not preserve logical text");
        b.Append("/Span BMC\nBT\n");
        for(int emitted=0;emitted<order.Length;emitted++)
        {
            int i=order[emitted];if((emitted&255)==0)cancellationToken.ThrowIfCancellationRequested();
            var g=glyphs[i];double size=obj.N("fontSize");var code=font.Code(g.P("glyphId").GetUInt32(),texts[i],g.P("advance").N("x")/size*1000);
            int start=b.Length;
            b.Append($"/{code.Font} {F(size)} Tf\n1 0 0 -1 {F(g.P("position").N("x")+g.P("offset").N("x"))} {F(g.P("position").N("y")+g.P("offset").N("y"))} Tm\n<{code.Code:X4}> Tj\n");
            glyphSpans?.Add(new(start,b.Length-start));
        }
        b.Append("ET\nEMC\n");
        return order.Length==0?(false,false):(texts[order[0]].All(c=>c==' '),texts[order[^1]].All(c=>c==' '));
    }
    private static int Image(PdfObjects pdf,JsonElement r,byte[] bytes,CancellationToken cancellationToken)
    {
        string common=$" /Type /XObject /Subtype /Image /Width {r.I("pixelWidth")} /Height {r.I("pixelHeight")} /BitsPerComponent 8";
        if(r.S("mimeType")=="image/jpeg")
        {
            var jpeg=new JpegDecoder();jpeg.SetInput(bytes);jpeg.Identify();
            return pdf.Stream(bytes,common+$" /ColorSpace /{(jpeg.NumberOfComponents==1?"DeviceGray":"DeviceRGB")} /Filter /DCTDecode",false);
        }
        using var stream=new CancellationMemoryStream(bytes,cancellationToken);var png=Png.Open(stream);cancellationToken.ThrowIfCancellationRequested();
        byte[] rgb=new byte[png.Width*png.Height*3],alpha=new byte[png.Width*png.Height];bool transparent=false;
        for(int y=0;y<png.Height;y++)for(int x=0;x<png.Width;x++)
        {int i=y*png.Width+x;if((i&1023)==0)cancellationToken.ThrowIfCancellationRequested();var pixel=png.GetPixel(x,y);rgb[i*3]=pixel.R;rgb[i*3+1]=pixel.G;rgb[i*3+2]=pixel.B;alpha[i]=pixel.A;transparent|=pixel.A!=255;}
        string mask=transparent?$" /SMask {pdf.Stream(alpha,common+" /ColorSpace /DeviceGray")} 0 R":"";
        return pdf.Stream(rgb,common+" /ColorSpace /DeviceRGB"+mask);
    }
    private static bool PdfJsDropsMapping(string text)
    {
        bool printable=false,nonspacingMark=false;System.Globalization.UnicodeCategory last=default;
        foreach(var rune in text.EnumerateRunes())
        {
            last=Rune.GetUnicodeCategory(rune);
            nonspacingMark|=last==System.Globalization.UnicodeCategory.NonSpacingMark;
            printable|=last is not (System.Globalization.UnicodeCategory.Control or System.Globalization.UnicodeCategory.Format
                or System.Globalization.UnicodeCategory.SpaceSeparator or System.Globalization.UnicodeCategory.LineSeparator or System.Globalization.UnicodeCategory.ParagraphSeparator);
        }
        // Match the categorizer's alternative precedence: a preceding Mn match wins over final Cf.
        if(PdfJsWhitespace(text[0]))return printable||text.Any(c=>c!=' ');
        return !nonspacingMark&&last==System.Globalization.UnicodeCategory.Format;
    }
    // ECMAScript WhiteSpace + LineTerminator set used by pdf.js 5.4.149's /^\s/ category.
    // U+0085 is deliberately absent; Char.IsWhiteSpace is not an equivalent predicate.
    private static bool PdfJsWhitespace(char c)=>c is >= '\u0009' and <= '\u000d' or '\u0020' or '\u00a0' or '\u1680'
        or >= '\u2000' and <= '\u200a' or '\u2028' or '\u2029' or '\u202f' or '\u205f' or '\u3000' or '\ufeff';
    private static void Color(StringBuilder b,JsonElement color,string op)=>b.Append($"{F(color.N("r"))} {F(color.N("g"))} {F(color.N("b"))} {op}\n");
    internal static void Commands(StringBuilder b,IEnumerable<JsonElement> commands,CancellationToken cancellationToken,JsonElement? transform=null)
    {
        string Point(JsonElement c,string x,string y)
        {
            double px=c.N(x),py=c.N(y);
            return transform is {} m?$"{F(m.N("a")*px+m.N("c")*py+m.N("e"))} {F(m.N("b")*px+m.N("d")*py+m.N("f"))}":$"{F(px)} {F(py)}";
        }
        int index=0;foreach(var c in commands){if((index++&255)==0)cancellationToken.ThrowIfCancellationRequested();b.Append(c.S("op") switch
        {"move"=>Point(c,"x","y")+" m\n","line"=>Point(c,"x","y")+" l\n","cubic"=>Point(c,"x1","y1")+" "+Point(c,"x2","y2")+" "+Point(c,"x","y")+" c\n","close"=>"h\n",_=>throw new InvalidDataException()});}
        cancellationToken.ThrowIfCancellationRequested();
    }
}
