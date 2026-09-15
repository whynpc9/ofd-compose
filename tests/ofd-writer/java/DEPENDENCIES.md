# Test-only Java Reader dependencies

The base is Maven 3.9.9 / Eclipse Temurin 21, pinned by manifest SHA-256 in
Dockerfile. Runtime JAR bytes are pinned in dependency-sha256.txt and every build
compares its complete resolved inventory with that lock (including extra JARs).
Java does not enter the production .NET dependency graph.

| JAR family (exact versions in hash lock) | License |
| --- | --- |
| ofdrw-core/pkg/reader/gm/gv 2.3.7 | Apache-2.0 |
| Apache commons-codec/compress/io/lang3 | Apache-2.0 |
| Gson, error_prone_annotations | Apache-2.0 |
| JetBrains annotations | Apache-2.0 |
| Bouncy Castle bcprov/bcpkix/bcutil | MIT |
| dom4j, jaxen | BSD-3-Clause |
| jbig2-imageio | Apache-2.0 |
| zip4j | Apache-2.0 |

Source reference for text coordinate/mapping review: ofdrw/ofdrw tag 2.3.7,
commit 792b8fe83a1efa4a6700a65399d64bcf43180f20. The tag's Maven source POM still
says 2.3.6; therefore the gate identifies the actual released 2.3.7 JARs by their
hashes instead of asserting that the tag and artifact are byte-identical.

Relevant upstream classes: CT_CGTransform (code/glyph counts), TextCode
(origin and deltas), CT_GraphicUnit/Area (Boundary, CTM and clipping),
ContentExtractor and OFDReader. ReaderGate calls these reader APIs for text and
coordinates. Geometry arithmetic applied to their returned values is test code;
this is not a rasterizer/device interoperability test.
