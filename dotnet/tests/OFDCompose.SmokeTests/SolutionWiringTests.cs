using Xunit;

namespace OFDCompose.SmokeTests;

public class SolutionWiringTests
{
    [Fact]
    public void Solution_modules_are_referenceable_from_tests()
    {
        Assert.Equal("OFDCompose.OfdIrWriter", OfdIrWriter.Module.Name);
        Assert.Equal("OFDCompose.PdfIrWriter", PdfIrWriter.Module.Name);
    }
}
