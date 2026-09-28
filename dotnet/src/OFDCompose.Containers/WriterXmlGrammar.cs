using System.Xml.Linq;
using System.Globalization;
using static OFDCompose.Containers.ContainerBudget;

namespace OFDCompose.Containers;
/// <summary>Closed grammar of the fixed writer's XML, including container attachment metadata.</summary>
internal static class WriterXmlGrammar
{
    internal static void Validate(XDocument document, string path, ContainerBudget budget)
    {
        var root=document.Root!;
        foreach(var node in root.DescendantsAndSelf())
        {
            budget.Charge(64);
            string name=node.Name.LocalName;
            string children=name switch {
                "OFD"=>"DocBody", "DocBody"=>"DocInfo DocRoot Signatures", "DocInfo"=>"DocID Creator Keywords",
                "Document"=>"CommonData Pages Attachments", "CommonData"=>"MaxUnitID PageArea PublicRes DocumentRes",
                "PageArea"=>"PhysicalBox", "Pages"=>"Page", "Page" when node==root=>"Area Content", "Page"=>"",
                "Area" when node.Parent?.Name.LocalName=="Clip"=>"Path", "Area"=>"PhysicalBox",
                "Content"=>"Layer", "Layer"=>"TextObject PathObject ImageObject",
                "Res"=>"Fonts MultiMedias", "Fonts"=>"Font", "Font"=>"FontFile", "MultiMedias"=>"MultiMedia", "MultiMedia"=>"MediaFile",
                "TextObject"=>"FillColor StrokeColor Clips CGTransform TextCode", "PathObject"=>"FillColor StrokeColor Clips AbbreviatedData",
                "ImageObject"=>"Clips", "Clips"=>"Clip", "Clip"=>"Area", "Path"=>"AbbreviatedData", "CGTransform"=>"Glyphs",
                "Attachments" when node==root=>"Attachment", "Attachment"=>"FileLoc",
                "Keywords" or "DocID" or "Creator" or "DocRoot" or "MaxUnitID" or "PhysicalBox" or "PublicRes" or "DocumentRes" or "FontFile" or "MediaFile" or "Glyphs" or "TextCode" or "AbbreviatedData" or "FillColor" or "StrokeColor" or "FileLoc" or "Attachments" or "Signatures"=>"",
                _=>throw new ContainerFailure("UNEXPECTED_METADATA")
            };
            string attributes=name switch {
                "OFD"=>"Version DocType", "Page" when node!=root=>"ID BaseLoc", "Res"=>"BaseLoc", "Font"=>"ID FontName FamilyName", "MultiMedia"=>"ID Type Format", "Layer"=>"ID Type",
                "TextObject"=>"ID Boundary CTM Alpha LineWidth Cap Join MiterLimit DashPattern DashOffset Font Size HScale ReadDirection CharDirection Weight Italic Fill Stroke",
                "PathObject"=>"ID Boundary CTM Alpha LineWidth Cap Join MiterLimit DashPattern DashOffset Fill Stroke Rule",
                "ImageObject"=>"ID Boundary CTM Alpha ResourceID", "FillColor" or "StrokeColor"=>"Value",
                "CGTransform"=>"CodePosition CodeCount GlyphCount", "TextCode"=>"X Y DeltaX DeltaY",
                "Area" when node.Parent?.Name.LocalName=="Clip"=>"CTM", "Path"=>"Stroke Fill Rule",
                "Attachment"=>"ID Name Format Visible Usage", _=>""
            };
            Need(node.Name.Namespace==SafePackage.Ns,"UNEXPECTED_METADATA");
            var allowedChildren=children.Split(' ',StringSplitOptions.RemoveEmptyEntries);
            Need(node.Elements().All(e=>allowedChildren.Contains(e.Name.LocalName)),"UNEXPECTED_METADATA");
            Cardinality(node,root);
            var allowedAttributes=attributes.Split(' ',StringSplitOptions.RemoveEmptyEntries);
            foreach(var attribute in node.Attributes())
                Need(attribute.IsNamespaceDeclaration ? attribute.Value==SafePackage.Ns.NamespaceName
                    : attribute.Name.Namespace==XNamespace.Xml && attribute.Name.LocalName=="space" && name=="TextCode" ? attribute.Value=="preserve"
                    : attribute.Name.NamespaceName=="" && allowedAttributes.Contains(attribute.Name.LocalName),"UNEXPECTED_METADATA");
            ValidateValues(node,budget);
            bool text=name is "Keywords" or "DocID" or "Creator" or "DocRoot" or "MaxUnitID" or "PhysicalBox" or "PublicRes" or "DocumentRes" or "FontFile" or "MediaFile" or "Glyphs" or "TextCode" or "AbbreviatedData" or "FileLoc" or "Signatures" || name=="Attachments"&&node!=root;
            Need(text||node.Nodes().OfType<XText>().All(t=>string.IsNullOrWhiteSpace(t.Value)),"UNEXPECTED_METADATA");
        }
        Need(!document.DescendantNodes().Any(n=>n is XComment or XProcessingInstruction),"UNEXPECTED_METADATA");
        if(path=="OFD.xml")
        {
            Need((string?)root.Attribute("Version")=="1.0"&&(string?)root.Attribute("DocType")=="OFD","UNEXPECTED_METADATA");
            Need(root.Descendants(SafePackage.Ns+"Creator").Select(e=>e.Value).SequenceEqual(["OFDCompose.OfdIrWriter/0"]),"UNEXPECTED_METADATA");
        }
    }
    private static void Cardinality(XElement node,XElement root)
    {
        string name=node.Name.LocalName;
        string repeated=name switch {
            "Pages"=>"Page", "Layer"=>"TextObject PathObject ImageObject", "Fonts"=>"Font", "MultiMedias"=>"MultiMedia",
            "TextObject"=>"CGTransform", "Clips"=>"Clip", _=>""
        };
        var many=repeated.Split(' ',StringSplitOptions.RemoveEmptyEntries);
        foreach(var group in node.Elements().GroupBy(e=>e.Name.LocalName))
            Need(many.Contains(group.Key)||group.Count()==1,"UNEXPECTED_METADATA");
        string required=name switch {
            "OFD"=>"DocBody", "DocBody"=>"DocInfo DocRoot", "DocInfo"=>"DocID Creator", "Document"=>"CommonData Pages",
            "CommonData"=>"MaxUnitID PageArea", "PageArea"=>"PhysicalBox", "Page" when node==root=>"Area Content",
            "Area" when node.Parent?.Name.LocalName=="Clip"=>"Path", "Area"=>"PhysicalBox",
            "Font"=>"FontFile", "MultiMedia"=>"MediaFile", "TextObject"=>"FillColor StrokeColor TextCode",
            "PathObject"=>"AbbreviatedData", "Path"=>"AbbreviatedData", "Clip"=>"Area",
            "CGTransform"=>"Glyphs", "Attachment"=>"FileLoc", "Attachments" when node==root=>"Attachment", _=>""
        };
        foreach(string child in required.Split(' ',StringSplitOptions.RemoveEmptyEntries))
            Need(node.Elements(SafePackage.Ns+child).Count()==1,"UNEXPECTED_METADATA");
        if(name=="Clips")Need(node.Elements().Count() is >=1 and <=2,"UNEXPECTED_METADATA");
    }
    private static void ValidateValues(XElement node,ContainerBudget budget)
    {
        string name=node.Name.LocalName,value=node.HasElements?"":node.Value;
        budget.Charge(value.Length*2L+node.Attributes().Sum(a=>a.Value.Length*2L));
        bool Integer(string text)=>uint.TryParse(text,NumberStyles.None,CultureInfo.InvariantCulture,out _);
        bool Number(string text)=>double.TryParse(text,NumberStyles.Float,CultureInfo.InvariantCulture,out double n)&&double.IsFinite(n);
        bool Numbers(string text,int? count=null,bool integers=false)
        {
            var tokens=text.Split(' ',StringSplitOptions.RemoveEmptyEntries);
            return tokens.Length>0 && (count is null||tokens.Length==count) && tokens.All(integers?Integer:Number);
        }
        bool Hex(string text,int length)=>text.Length==length&&text.All(c=>c is >= '0' and <= '9' or >= 'a' and <= 'f');
        bool PathCommands(string text)
        {
            var tokens=text.Split(' ',StringSplitOptions.RemoveEmptyEntries);
            for(int i=0;i<tokens.Length;)
            {
                int count=tokens[i++] switch {"M" or "L"=>2,"B"=>6,"C"=>0,_=>-1};
                if(count<0||count>tokens.Length-i)return false;
                for(int j=0;j<count;j++)if(!Number(tokens[i++]))return false;
            }
            return true;
        }
        bool scalar=name switch {
            "Keywords"=>value.StartsWith("ofd-compose:ir-sha256:",StringComparison.Ordinal)&&Hex(value["ofd-compose:ir-sha256:".Length..],64), "DocID"=>Hex(value,32), "Creator"=>value=="OFDCompose.OfdIrWriter/0", "MaxUnitID"=>Integer(value),
            "PhysicalBox"=>Numbers(value,4), "Glyphs"=>Numbers(value,integers:true), "AbbreviatedData"=>PathCommands(value), _=>true
        };
        Need(scalar,"UNEXPECTED_METADATA");
        if(name is "DocRoot" or "PublicRes" or "DocumentRes" or "FontFile" or "MediaFile" or "FileLoc" or "Signatures" || name=="Attachments"&&node.Parent is not null)SafePackage.Path(value);
        foreach(var attribute in node.Attributes().Where(a=>!a.IsNamespaceDeclaration&&a.Name.NamespaceName==""))
        {
            string key=attribute.Name.LocalName,text=attribute.Value;
            bool valid=key switch {
                "ID" or "ResourceID" or "Font" or "CodePosition" or "CodeCount" or "GlyphCount" or "Alpha"=>Integer(text),
                "Boundary"=>Numbers(text,4), "CTM"=>Numbers(text,6), "Value"=>Numbers(text,3,integers:true),
                "DeltaX" or "DeltaY" or "DashPattern"=>Numbers(text),
                "X" or "Y" or "Size" or "HScale" or "ReadDirection" or "CharDirection" or "Weight" or "LineWidth" or "MiterLimit" or "DashOffset"=>Number(text),
                "Fill" or "Stroke" or "Italic" or "Visible"=>text is "true" or "false",
                "Cap"=>text is "Butt" or "Round" or "Square", "Join"=>text is "Miter" or "Round" or "Bevel", "Rule"=>text is "NonZero" or "Even-Odd",
                "Type"=>name=="Layer"?text=="Body":text=="Image",
                "FontName" or "FamilyName"=>text.StartsWith("Subset-",StringComparison.Ordinal)&&Hex(text[7..],64),
                "Format"=>name=="Attachment"?text=="application/json":text is "PNG" or "JPEG" or "JPG" or "png" or "jpeg" or "jpg",
                "Name"=>text=="ofd-compose.json", "Usage"=>text=="ofd-compose", "Version"=>text=="1.0", "DocType"=>text=="OFD", _=>true
            };
            Need(valid,"UNEXPECTED_METADATA");
            if(key=="BaseLoc")SafePackage.Path(text);
        }
    }

}
