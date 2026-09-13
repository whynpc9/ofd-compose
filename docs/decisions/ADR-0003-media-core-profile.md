# ADR-0003: P0 media preparation profile

Status: Accepted for issue11; writer/profile acceptance remains in WP0.10.
Date: 2026-09-13

The issue11 media preparation profile uses image-size 2.0.2 for dimensions and bwip-js 4.11.4 generic drawing-context for code128/ean13. Production emits rectangles directly as local-mm IR paths; it never round-trips through SVG or bitmap. Geometry and generator version are frozen together. Test-only zxing-wasm 3.1.3 decodes independently rasterized paths in Node and Chromium.

PNG and JPEG are the only writer input formats. GIF/BMP/TIFF return `UNSUPPORTED_FEATURE` in P0. Introducing a pure-JS normalization decoder would expand the memory/CPU and color/transparency verification surface before writer validation exists. APNG and nontrivial EXIF orientation also need explicit normalization and are not silently rendered differently by each backend. Bounded header/container validation is distinct from compressed-pixel decoding; writers retain validation responsibility.

The P0 barcode label policy is bars-only (`pure=true`, the default). `pure=false` returns `UNSUPPORTED_FEATURE`. Adding labels requires Typography Core glyphs, font identity and label-area geometry; bwip's internal font measurements are not an acceptable bypass. Code128 is printable ASCII with parse/FNC interpretation disabled. EAN13 input includes its check digit, which is validated rather than silently replaced or appended. Other six linear formats remain issue27.

Width includes quiet zones. Each side uses at least 10 modules for code128 or 11 for ean13; explicit mm quiet zones cannot undercut the minimum. Media outputs preserve the requested physical size and fixed geometry; issue12 must not nonuniformly stretch or crop barcodes. The minimum module width is 0.1 mm. This is an internal P0 profile and does not assert commercial printing/GS1 certification.

The authorization boundary is an explicit byte pack and optional root/path table. No resource callback may turn Core into an implicit filesystem/network reader. Host filesystem adapters must check symlinks/realpath and supply already-authorized bytes. Duplicate external IDs or ambiguous paths fail even when contents match. External IDs are mapped to internal content handles and are never inserted into page/font/object identity space.

Raw image data records use explicit field projection: exactly one own data field `resourceId` or `path` is required; unrelated business fields are not enumerated or retained. Rejecting every extra property would require unbounded key enumeration of the host data record. The projected ResolvedDocument reference remains a strict one-field object, preserving source minimization and avoiding that allocation surface.

The implementation's hard input, pixel, command and deterministic work budgets are documented in `packages/media-core/README.md`. They do not replace Job Host worker isolation and forced wall-clock timeout. Existing typography resource stress and pagination capacities are unchanged.

Source verification used the installed locked sources: bwip `dist/bwip-js-gen.d.ts`, `src/exports.js`, `src/bwipjs.js`, `src/drawing-svg.js` (comparison of line semantics only; not called); image-size `dist/types/png.mjs` and `jpg.mjs`; zxing-wasm reader declarations and local WASM loader. Upstream references: [bwip-js v4.11.4](https://github.com/metafloor/bwip-js/tree/v4.11.4), [image-size v2.0.2](https://github.com/image-size/image-size/tree/v2.0.2), [zxing-wasm v3.1.3](https://github.com/Sec-ant/zxing-wasm/tree/v3.1.3).

WP0.10 still needs writer PNG/JPEG compressed-data handling, dual writer output decoding/physical-size checks and target reader evidence. Issue11's core tests do not constitute writer, device, business-template or production acceptance.
