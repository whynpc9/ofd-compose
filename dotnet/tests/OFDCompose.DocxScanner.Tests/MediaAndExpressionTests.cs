using Xunit;

namespace OFDCompose.DocxScanner.Tests;

public class MediaAndExpressionTests
{
    [Fact]
    public void Image_tags_distinguish_inline_and_centered_block()
    {
        var path = DocxFixture.CreateDocx(body =>
        {
            body.Append(DocxFixture.Para("Report logo {%logo} inline"));
            body.Append(DocxFixture.Para("{%icon}"));
            body.Append(DocxFixture.Para("{%%cover}"));
        });

        var report = DocxScan.ScanFile(path);

        Assert.Equal(3, report.Summary.Images);
        var inline = report.Tags[0];
        Assert.Equal("image", inline.Kind);
        Assert.False(inline.BlockLevel);
        Assert.False(inline.Image?.Centered);
        Assert.Contains(report.Diagnostics, d => d.Code == "INLINE_IMAGE_TOKEN");

        var block = report.Tags[1];
        Assert.True(block.BlockLevel);
        Assert.False(block.Image?.Centered);

        var centered = report.Tags[2];
        Assert.True(centered.BlockLevel);
        Assert.True(centered.Image?.Centered);
        Assert.Equal("cover", centered.Image?.ValueExpression);
    }

    [Fact]
    public void Barcode_parameters_parse_with_defaults_and_alias_keys()
    {
        var path = DocxFixture.CreateDocx(body =>
        {
            body.Append(DocxFixture.Para("{%barcode:barcodes.code128}"));
            body.Append(
                DocxFixture.Para("{%%barcode:barcodes.ean13;format=EAN-13;widthpx=280;heightpx=100;margin=4;purebarcode=false}"));
        });

        var report = DocxScan.ScanFile(path);

        var defaults = report.Tags[0].Barcode!;
        Assert.Equal("barcodes.code128", defaults.ValueExpression);
        Assert.Equal("code128", defaults.Symbology);
        Assert.Equal(new BarcodeParameters(320, 96, 2, true), defaults.Parameters);
        Assert.False(defaults.Centered);

        var aliased = report.Tags[1].Barcode!;
        Assert.Equal("ean13", aliased.Symbology);
        Assert.Equal(new BarcodeParameters(280, 100, 4, false), aliased.Parameters);
        Assert.True(aliased.Centered);
        Assert.Equal(["code128", "ean13"], report.Summary.Symbologies);
        Assert.DoesNotContain(report.Diagnostics, d => d.Severity is "error" or "warning");
    }

    [Fact]
    public void Barcode_unknown_key_and_type_are_warnings()
    {
        var path = DocxFixture.CreateDocx(body =>
        {
            body.Append(DocxFixture.Para("{%barcode:v;rotation=90}"));
            body.Append(DocxFixture.Para("{%barcode:v;type=qr}"));
        });

        var report = DocxScan.ScanFile(path);

        Assert.Contains(report.Diagnostics, d => d.Code == "UNSUPPORTED_BARCODE_PARAMETER" && d.Severity == "warning");
        Assert.Contains(report.Diagnostics, d => d.Code == "UNSUPPORTED_BARCODE_TYPE" && d.Severity == "warning");
        Assert.Equal("needs-review", report.MigrationStatus);
    }

    [Fact]
    public void Upca_and_itf_symbologies_raise_semantic_changes()
    {
        var path = DocxFixture.CreateDocx(body =>
        {
            body.Append(DocxFixture.Para("{%barcode:barcodes.upca;type=upca}"));
            body.Append(DocxFixture.Para("{%barcode:barcodes.itf;type=interleaved2of5}"));
        });

        var report = DocxScan.ScanFile(path);

        Assert.Contains("upca-to-ean13", report.LegacySemanticChanges);
        Assert.Contains("itf-pad-left-zero", report.LegacySemanticChanges);
        Assert.Equal("itf", report.Tags[1].Barcode?.Symbology);
        Assert.Equal("medium", report.Risk);
    }

    [Fact]
    public void At_negative_index_and_path_negative_index_are_semantic_changes()
    {
        var path = DocxFixture.CreateDocx(body =>
        {
            body.Append(DocxFixture.Para("last: {institutions|at:-1}"));
            body.Append(DocxFixture.Para("path: {items[-1]}"));
        });

        var report = DocxScan.ScanFile(path);

        Assert.Contains("at-negative-index", report.LegacySemanticChanges);
        Assert.Contains("path-negative-index", report.LegacySemanticChanges);
        Assert.Equal("needs-review", report.MigrationStatus);
    }

    [Fact]
    public void Format_aliases_report_raw_and_canonical_kind()
    {
        var path = DocxFixture.CreateDocx(body =>
        {
            body.Append(DocxFixture.Para("{amount|format:numeric:0.00}"));
            body.Append(DocxFixture.Para("{rate|format:percentage}"));
            body.Append(DocxFixture.Para("{created|format:datetime:yyyy-MM-dd}"));
        });

        var report = DocxScan.ScanFile(path);

        Assert.Equal(3, report.Summary.FormatPatterns.Count);
        Assert.Contains(report.Summary.FormatPatterns, p => p.Kind == "number" && p.Pattern == "0.00" && p.Alias == "numeric");
        Assert.Contains(report.Summary.FormatPatterns, p => p.Kind == "percent" && p.Pattern == null && p.Alias == "percentage");
        Assert.Contains(report.Summary.FormatPatterns, p => p.Kind == "date" && p.Pattern == "yyyy-MM-dd" && p.Alias == "datetime");
        Assert.Contains("format-alias", report.LegacySemanticChanges);
    }

    [Fact]
    public void Unknown_operator_is_a_warning()
    {
        var path = DocxFixture.CreateDocx(body =>
            body.Append(DocxFixture.Para("{orders|bogus:1}")));

        var report = DocxScan.ScanFile(path);

        Assert.Contains(report.Diagnostics, d => d.Code == "UNKNOWN_OPERATOR" && d.Severity == "warning");
        Assert.Contains("bogus", report.Summary.Functions);
        Assert.Equal("needs-review", report.MigrationStatus);
    }

    [Fact]
    public void Inline_control_token_is_erased_by_legacy_and_recorded()
    {
        var path = DocxFixture.CreateDocx(body =>
            body.Append(DocxFixture.Para("prefix {#orders} suffix")));

        var report = DocxScan.ScanFile(path);

        var tag = Assert.Single(report.Tags);
        Assert.Equal("loop-start", tag.Kind);
        Assert.False(tag.BlockLevel);
        Assert.Empty(report.ControlBlocks);
        Assert.Contains(report.Diagnostics, d => d.Code == "INLINE_CONTROL_TOKEN");
    }
}
