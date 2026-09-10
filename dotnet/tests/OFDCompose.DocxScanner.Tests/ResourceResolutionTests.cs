using Xunit;

namespace OFDCompose.DocxScanner.Tests;

public class ResourceResolutionTests
{
    private const string SidecarJson = """
        {
          "logo": {
            "src": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO8B9pYAAAAASUVORK5CYII=",
            "width": 32,
            "height": 16
          },
          "chart": {
            "src": "assets/chart.png",
            "maxWidth": 376,
            "preserveAspectRatio": true
          },
          "base64Image": "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO8B9pYAAAAASUVORK5CYII=",
          "nothing": null,
          "gallery": ["a", "b"]
        }
        """;

    [Fact]
    public void Image_values_are_classified_from_data_sidecar_without_file_io()
    {
        var docx = DocxFixture.CreateDocx(body =>
        {
            body.Append(DocxFixture.Para("{%logo}"));
            body.Append(DocxFixture.Para("{%chart}"));
            body.Append(DocxFixture.Para("{%base64Image}"));
            body.Append(DocxFixture.Para("{%nothing}"));
            body.Append(DocxFixture.Para("{%missingThing}"));
            body.Append(DocxFixture.Para("{%gallery}"));
            body.Append(DocxFixture.Para("{%logo|first}"));
        });
        // Deliberately references assets/chart.png which does NOT exist on disk:
        // resolution must be a pure lookup, never file IO.
        var data = DocxFixture.CreateDataJson(SidecarJson);

        var report = DocxScan.ScanFile(docx, data);

        Assert.Equal(7, report.ResourceReferences.Count);

        var logo = report.ResourceReferences[0];
        Assert.Equal("logo", logo.Expression);
        Assert.Equal("image", logo.Kind);
        Assert.False(logo.Centered);
        Assert.Equal("resolved", logo.Value.State);
        Assert.Equal("object", logo.Value.ValueKind);
        Assert.Equal("src", logo.Value.SourceKey);
        Assert.Equal(["width", "height"], logo.Value.SizeKeys);
        Assert.Equal("data-uri:image/png", logo.Value.SourceForm);

        var chart = report.ResourceReferences[1];
        Assert.Equal("resolved", chart.Value.State);
        Assert.Equal("object", chart.Value.ValueKind);
        Assert.Equal("src", chart.Value.SourceKey);
        Assert.Equal(["maxWidth", "preserveAspectRatio"], chart.Value.SizeKeys);
        Assert.Equal("relative-path", chart.Value.SourceForm);

        var base64 = report.ResourceReferences[2];
        Assert.Equal("resolved", base64.Value.State);
        Assert.Equal("string", base64.Value.ValueKind);
        Assert.Equal("base64-like", base64.Value.SourceForm);

        var nothing = report.ResourceReferences[3];
        Assert.Equal("null", nothing.Value.State);
        Assert.Equal("null", nothing.Value.ValueKind);

        var missing = report.ResourceReferences[4];
        Assert.Equal("missing", missing.Value.State);
        Assert.Equal("missing", missing.Value.ValueKind);

        var gallery = report.ResourceReferences[5];
        Assert.Equal("resolved", gallery.Value.State);
        Assert.Equal("array", gallery.Value.ValueKind);
        Assert.Equal(2, gallery.Value.ItemCount);

        var piped = report.ResourceReferences[6];
        Assert.Equal("logo|first", piped.Expression);
        Assert.Equal("valueUnknown", piped.Value.State);

        Assert.Contains("file-path-image-source", report.LegacySemanticChanges);
        Assert.Equal("medium", report.Risk);
        Assert.Equal("needs-review", report.MigrationStatus);
    }

    [Fact]
    public void Image_value_is_unknown_without_data_sidecar()
    {
        var docx = DocxFixture.CreateDocx(body => body.Append(DocxFixture.Para("{%logo}")));

        var report = DocxScan.ScanFile(docx);

        var reference = Assert.Single(report.ResourceReferences);
        Assert.Equal("valueUnknown", reference.Value.State);
        Assert.Equal("low", report.Risk);
    }

    [Theory]
    [InlineData("data:image/jpeg;base64,AAAA", "data-uri:image/jpeg")]
    [InlineData("assets/chart.png", "relative-path")]
    [InlineData("images/logo", "relative-path")]
    [InlineData("C:\\media\\logo.png", "absolute-path")]
    [InlineData("/srv/media/logo.png", "absolute-path")]
    [InlineData("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO8B9pYAAAAASUVORK5CYII=", "base64-like")]
    public void Source_form_classification_never_touches_the_file_system(string source, string expected)
    {
        Assert.Equal(expected, ScanEngine.ClassifySourceForm(source));
    }
}
