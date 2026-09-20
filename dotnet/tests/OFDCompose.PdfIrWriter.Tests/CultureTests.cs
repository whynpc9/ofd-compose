using System.Globalization;
using Xunit;
namespace OFDCompose.PdfIrWriter.Tests;
public sealed class CultureTests
{
    [Theory][InlineData("visible-image")][InlineData("jpeg")]
    public async Task Image_matrices_are_independent_of_current_number_format(string fixture)
    {
        var f=await WriterTests.Fixture(fixture);var previous=CultureInfo.CurrentCulture;
        try
        {
            CultureInfo.CurrentCulture=CultureInfo.InvariantCulture;
            var expected=await new PdfIrWriter().WriteAsync(f.Ir,WriterTests.Digest(f.Ir),f.Resources,cancellationToken:TestContext.Current.CancellationToken);
            var unusual=(CultureInfo)CultureInfo.InvariantCulture.Clone();unusual.NumberFormat.NegativeSign="\u2212";unusual.NumberFormat.NumberDecimalSeparator=",";
            CultureInfo.CurrentCulture=unusual;
            var actual=await new PdfIrWriter().WriteAsync(f.Ir,WriterTests.Digest(f.Ir),f.Resources,cancellationToken:TestContext.Current.CancellationToken);
            Assert.True(expected.Ok);Assert.True(actual.Ok);Assert.Equal(expected.Bytes,actual.Bytes);
        }
        finally { CultureInfo.CurrentCulture=previous; }
    }
}
