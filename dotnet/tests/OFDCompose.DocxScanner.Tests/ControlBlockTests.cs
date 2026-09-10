using Xunit;

namespace OFDCompose.DocxScanner.Tests;

public class ControlBlockTests
{
    [Fact]
    public void Table_row_loop_markers_are_block_and_row_level_and_pair()
    {
        var path = DocxFixture.CreateDocx(body =>
            body.Append(
                DocxFixture.Table(
                    DocxFixture.Row("Item", "Qty"),
                    DocxFixture.Row("{#invoice.lines}", ""),
                    DocxFixture.Row("{name}", "{qty}"),
                    DocxFixture.Row("{/invoice.lines}", ""))));

        var report = DocxScan.ScanFile(path);

        var loopStart = report.Tags.Single(tag => tag.Kind == "loop-start");
        var loopEnd = report.Tags.Single(tag => tag.Kind == "loop-end");
        Assert.True(loopStart.BlockLevel);
        Assert.True(loopStart.RowLevel);
        Assert.Equal("table-row", loopStart.Location.Scope);
        Assert.Equal(0, loopStart.Location.TableIndex);
        Assert.Equal(1, loopStart.Location.RowIndex);
        Assert.Null(loopStart.Location.CellIndex);
        Assert.Equal("invoice.lines", loopStart.Expression);

        var nameTag = report.Tags.Single(tag => tag.RawText == "{name}");
        Assert.Equal("table-cell", nameTag.Location.Scope);
        Assert.Equal(2, nameTag.Location.RowIndex);

        var block = Assert.Single(report.ControlBlocks);
        Assert.Equal("loop", block.Kind);
        Assert.Equal("invoice.lines", block.Expression);
        Assert.True(block.Paired);
        Assert.Equal(0, block.Depth);
        Assert.Equal("table-row", block.Scope);
        Assert.Empty(report.Diagnostics);
        Assert.Equal("auto", report.MigrationStatus);
    }

    [Fact]
    public void Unpaired_block_start_is_error_and_flags_review()
    {
        var path = DocxFixture.CreateDocx(body =>
        {
            body.Append(DocxFixture.Para("{#orders}"));
            body.Append(DocxFixture.Para("{id}"));
        });

        var report = DocxScan.ScanFile(path);

        Assert.Contains(report.Diagnostics, d => d.Code == "UNPAIRED_BLOCK_START" && d.Severity == "error");
        Assert.Equal("high", report.Risk);
        Assert.Equal("needs-review", report.MigrationStatus);
        var block = Assert.Single(report.ControlBlocks);
        Assert.False(block.Paired);
    }

    [Fact]
    public void Mismatched_block_end_is_an_error()
    {
        var path = DocxFixture.CreateDocx(body =>
        {
            body.Append(DocxFixture.Para("{#orders|take:2}"));
            body.Append(DocxFixture.Para("{/orders}"));
        });

        var report = DocxScan.ScanFile(path);

        Assert.Contains(report.Diagnostics, d => d.Code == "MISMATCHED_BLOCK_END" && d.Severity == "error");
        Assert.Equal("high", report.Risk);
    }

    [Fact]
    public void Orphaned_block_end_is_warning_and_semantic_change()
    {
        var path = DocxFixture.CreateDocx(body =>
        {
            body.Append(DocxFixture.Para("plain text"));
            body.Append(DocxFixture.Para("{/orders}"));
        });

        var report = DocxScan.ScanFile(path);

        Assert.Contains(report.Diagnostics, d => d.Code == "ORPHANED_BLOCK_END" && d.Severity == "warning");
        Assert.Contains("orphaned-block-end", report.LegacySemanticChanges);
        Assert.Equal("medium", report.Risk);
        Assert.Equal("needs-review", report.MigrationStatus);
        Assert.Empty(report.ControlBlocks);
    }

    [Fact]
    public void End_in_different_scope_is_unpaired_and_cross_container()
    {
        var path = DocxFixture.CreateDocx(body =>
        {
            body.Append(DocxFixture.Para("{#orders}"));
            // Second cell keeps the row from becoming a row-level marker, so the end
            // marker lives in the cell's paragraph scope.
            body.Append(DocxFixture.Table(DocxFixture.Row("{/orders}", "x")));
        });

        var report = DocxScan.ScanFile(path);

        Assert.Contains(report.Diagnostics, d => d.Code == "UNPAIRED_BLOCK_START" && d.Severity == "error");
        var cross = Assert.Single(report.Diagnostics, d => d.Code == "CROSS_CONTAINER_PAIRING");
        Assert.Equal("error", cross.Severity);
        Assert.Equal("table-cell", cross.Location?.Scope);
        Assert.DoesNotContain(report.Diagnostics, d => d.Code == "ORPHANED_BLOCK_END");
        Assert.Equal("high", report.Risk);
    }

    [Fact]
    public void Cross_type_interleaving_is_an_error()
    {
        var path = DocxFixture.CreateDocx(body =>
        {
            body.Append(DocxFixture.Para("{#a}"));
            body.Append(DocxFixture.Para("{?b}"));
            body.Append(DocxFixture.Para("{/a}"));
            body.Append(DocxFixture.Para("{/?b}"));
        });

        var report = DocxScan.ScanFile(path);

        Assert.Contains(report.Diagnostics, d => d.Code == "INTERLEAVED_BLOCKS" && d.Severity == "error");
        Assert.Equal("high", report.Risk);
    }

    [Fact]
    public void Truthy_non_array_loop_value_is_a_legacy_semantic_change()
    {
        var path = DocxFixture.CreateDocx(body =>
        {
            body.Append(DocxFixture.Para("{#value}"));
            body.Append(DocxFixture.Para("{value}"));
            body.Append(DocxFixture.Para("{/value}"));
        });
        var dataPath = DocxFixture.CreateDataJson("{\"value\":1}");

        var report = DocxScan.ScanFile(path, dataPath);

        var diagnostic = Assert.Single(report.Diagnostics, d => d.Code == "NON_ARRAY_LOOP");
        Assert.Equal("warning", diagnostic.Severity);
        Assert.Contains("non-array-loop", report.LegacySemanticChanges);
        Assert.Equal("medium", report.Risk);
        Assert.Equal("needs-review", report.MigrationStatus);
    }

    [Fact]
    public void Legacy_truthy_string_zero_loop_value_is_flagged()
    {
        var path = DocxFixture.CreateDocx(body =>
        {
            body.Append(DocxFixture.Para("{#value}"));
            body.Append(DocxFixture.Para("{/value}"));
        });
        // Legacy truthiness: the string "0" is truthy, so legacy renders the block once.
        var dataPath = DocxFixture.CreateDataJson("{\"value\":\"0\"}");

        var report = DocxScan.ScanFile(path, dataPath);

        Assert.Contains(report.Diagnostics, d => d.Code == "NON_ARRAY_LOOP");
        Assert.Contains("non-array-loop", report.LegacySemanticChanges);
    }

    [Fact]
    public void Array_and_falsy_loop_values_are_not_semantic_changes()
    {
        var path = DocxFixture.CreateDocx(body =>
        {
            body.Append(DocxFixture.Para("{#items}"));
            body.Append(DocxFixture.Para("{/items}"));
            body.Append(DocxFixture.Para("{#count}"));
            body.Append(DocxFixture.Para("{/count}"));
            body.Append(DocxFixture.Para("{#missing}"));
            body.Append(DocxFixture.Para("{/missing}"));
        });
        var dataPath = DocxFixture.CreateDataJson("{\"items\":[1,2],\"count\":0}");

        var report = DocxScan.ScanFile(path, dataPath);

        Assert.DoesNotContain(report.Diagnostics, d => d.Code == "NON_ARRAY_LOOP");
        Assert.DoesNotContain("non-array-loop", report.LegacySemanticChanges);
        Assert.Equal("auto", report.MigrationStatus);
    }

    [Fact]
    public void Non_array_loop_requires_a_data_sidecar()
    {
        var path = DocxFixture.CreateDocx(body =>
        {
            body.Append(DocxFixture.Para("{#value}"));
            body.Append(DocxFixture.Para("{/value}"));
        });

        var report = DocxScan.ScanFile(path);

        Assert.DoesNotContain(report.Diagnostics, d => d.Code == "NON_ARRAY_LOOP");
        Assert.Equal("auto", report.MigrationStatus);
    }

    [Fact]
    public void Properly_nested_loops_pair_with_nesting_info()
    {
        var path = DocxFixture.CreateDocx(body =>
        {
            body.Append(DocxFixture.Para("{#a}"));
            body.Append(DocxFixture.Para("{#b}"));
            body.Append(DocxFixture.Para("{/b}"));
            body.Append(DocxFixture.Para("{/a}"));
        });

        var report = DocxScan.ScanFile(path);

        Assert.DoesNotContain(report.Diagnostics, d => d.Severity == "error" || d.Severity == "warning");
        Assert.Contains(report.Diagnostics, d => d.Code == "NESTED_BLOCK" && d.Severity == "info");
        Assert.Equal(2, report.ControlBlocks.Count);
        Assert.Equal(0, report.ControlBlocks[0].Depth);
        Assert.Equal(1, report.ControlBlocks[1].Depth);
        Assert.All(report.ControlBlocks, block => Assert.True(block.Paired));
        Assert.Equal("auto", report.MigrationStatus);
    }
}
