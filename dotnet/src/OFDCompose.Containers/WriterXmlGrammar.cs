using System.Xml.Linq;
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
                "OFD"=>"DocBody", "DocBody"=>"DocInfo DocRoot Signatures", "DocInfo"=>"DocID Creator",
                "Document"=>"CommonData Pages Attachments", "CommonData"=>"MaxUnitID PageArea PublicRes DocumentRes",
                "PageArea"=>"PhysicalBox", "Pages"=>"Page", "Page" when node==root=>"Area Content", "Page"=>"",
                "Area" when node.Parent?.Name.LocalName=="Clip"=>"Path", "Area"=>"PhysicalBox",
                "Content"=>"Layer", "Layer"=>"TextObject PathObject ImageObject",
                "Res"=>"Fonts MultiMedias", "Fonts"=>"Font", "Font"=>"FontFile", "MultiMedias"=>"MultiMedia", "MultiMedia"=>"MediaFile",
                "TextObject"=>"FillColor StrokeColor Clips CGTransform TextCode", "PathObject"=>"FillColor StrokeColor Clips AbbreviatedData",
                "ImageObject"=>"Clips", "Clips"=>"Clip", "Clip"=>"Area", "Path"=>"AbbreviatedData", "CGTransform"=>"Glyphs",
                "Attachments" when node==root=>"Attachment", "Attachment"=>"FileLoc",
                "DocID" or "Creator" or "DocRoot" or "MaxUnitID" or "PhysicalBox" or "PublicRes" or "DocumentRes" or "FontFile" or "MediaFile" or "Glyphs" or "TextCode" or "AbbreviatedData" or "FillColor" or "StrokeColor" or "FileLoc" or "Attachments" or "Signatures"=>"",
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
            var allowedAttributes=attributes.Split(' ',StringSplitOptions.RemoveEmptyEntries);
            foreach(var attribute in node.Attributes())
                Need(attribute.IsNamespaceDeclaration ? attribute.Value==SafePackage.Ns.NamespaceName
                    : attribute.Name.Namespace==XNamespace.Xml && attribute.Name.LocalName=="space" && name=="TextCode" ? attribute.Value=="preserve"
                    : attribute.Name.NamespaceName=="" && allowedAttributes.Contains(attribute.Name.LocalName),"UNEXPECTED_METADATA");
            bool text=name is "DocID" or "Creator" or "DocRoot" or "MaxUnitID" or "PhysicalBox" or "PublicRes" or "DocumentRes" or "FontFile" or "MediaFile" or "Glyphs" or "TextCode" or "AbbreviatedData" or "FileLoc" or "Signatures" || name=="Attachments"&&node!=root;
            Need(text||node.Nodes().OfType<XText>().All(t=>string.IsNullOrWhiteSpace(t.Value)),"UNEXPECTED_METADATA");
        }
        Need(!document.DescendantNodes().Any(n=>n is XComment or XProcessingInstruction),"UNEXPECTED_METADATA");
        if(path=="OFD.xml")
        {
            Need((string?)root.Attribute("Version")=="1.0"&&(string?)root.Attribute("DocType")=="OFD","UNEXPECTED_METADATA");
            Need(root.Descendants(SafePackage.Ns+"Creator").Select(e=>e.Value).SequenceEqual(["OFDCompose.OfdIrWriter/0"]),"UNEXPECTED_METADATA");
        }
    }
}
