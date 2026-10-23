# Linear barcode admission (issue27, experimental v0)

The production path uses pinned bwip-js 4.11.4's drawing context directly to local-mm IR rectangles. Neither SVG nor bitmap conversion nor a decoder is used in production. The reusable capability source is [`barcodeCapabilities`](../../packages/media-core/src/capabilities.ts); `availableBarcodeSymbologies` includes only `passed` entries, and generation rejects entries without that status. Issue21 can consume these exports; no HTTP service or v1 contract is introduced.

| Symbology | Admission | Strict input | Checksum |
| --- | --- | --- | --- |
| code39 | Passed | Basic uppercase A–Z, digits, space and `-.$/+%`; no `*` guards or extended mode | Optional Mod43 not enabled |
| code93 | Passed | Same basic alphabet; no extended shifts | Generator emits both C/K checks; input is payload |
| codabar | Passed | Uppercase A–D start/end guards, at least two payload characters from digits and `-$:/.+` | No optional checksum |
| ean8 | Passed | Exactly eight digits | Supplied final digit validated |
| upca | Passed | Exactly twelve digits | Supplied final digit validated |
| itf | Passed | Even number of digits, at least two | No optional checksum |
| code128 / ean13 | Existing behavior preserved; double-decoder regression passed | Printable ASCII / thirteen digits | Existing generator / supplied check digit |

All inputs and encoded values remain within the shared 256-character cap. Width includes symmetric quiet zones: 10 narrow modules for Code128/39/93/Codabar/ITF, 11 for EAN13, 7 for EAN8, 9 for UPC-A. Minimum module width is 0.1 mm; height is at least 1 mm; dimensions are at most 1000 mm. Explicit quiet zones cannot undercut the minimum. Region scaling retains quiet zones and the physical minimum; unsafe scaling and cropping fail. Shared preparation work/path/binding budgets remain in force.

`pure=true` (including ITF) means bars only. `pure=false` returns `UNSUPPORTED_FEATURE`; it does not draw fake text or use the generator's internal fonts. Human-readable labels require the separate Typography profile. BarcodeBinding still binds one string; lists use RepeatBlock, preserving per-item semantics. Direct array values produce `BARCODE_VALUE_INVALID`.

## Strict and legacy values

Omitted `normalizationPolicy`, or `strict-1`, preserves the declared symbology/value and rejects invalid lengths/check digits. `bindingPolicyVersion=legacy-compat-1` does not implicitly enable barcode normalization.

- `legacy-upca-to-ean13-1` is valid only for declared UPC-A: validate its twelve digits, prepend `0`, then encode EAN13.
- `legacy-itf-pad-left-1` is valid only for declared ITF: prepend `0` to an odd digit count. Even input remains unchanged.

Actual changes produce a located `BARCODE_NORMALIZED` warning with `inputValue`, `encodedValue`, `normalizationPolicy`, `declaredSymbology` and `encodedSymbology`. Prepared geometry preserves the same provenance. Budget checks apply after normalization too. Mismatched policy/type pairs fail `MODEL_INVALID`.

## Independent evidence

[`cases.json`](cases.json) contains nineteen input cases, including alphabet/punctuation, short Code39/Code93/ITF/Codabar, checksummed retail values, explicit legacy policies and Code128/EAN13 regressions. [`generate-barcode-fixtures.mjs`](../../packages/render-worker/tests/generate-barcode-fixtures.mjs) invokes the real built Render Worker and exports twenty-seven actual IR paths: those cases plus eight centered, region-scaled cases. It applies each IR graphics-state transform to the exported local rectangles and asserts physical bounds. CI regenerates this file before tests so archived geometry cannot stand in for the current implementation.

- Node and Chromium use test-only zxing-wasm 3.1.3 on an independent CPU rasterization of the rectangles. The same generator-digest and repeated Worker IR snapshots establish Node/browser equality for the tested inputs. Negative tests cover invalid values, dimensions, quiet zones, unsupported labels, normalization policy and budgets.
- .NET tests independently rasterize the same Worker geometry and use ZXing.Net 0.16.11 (Apache-2.0). They assert exact text and format, with separate UPC-A/EAN13 alias assertions. White images must produce no barcode in both decoders.
- **Observed UPC-A alias:** zxing-wasm returns format `UPCA` with the leading-zero thirteen-digit EAN representation, in Plain as well as default HRI mode. Tests retain that raw result and separately compare the twelve-digit payload. ZXing.Net returns twelve digits with `UPC_A`; forcing its `EAN_13` reader returns the prefixed representation. An explicit legacy policy really declares EAN13 as the encoded format; decoder aliases do not trigger a product normalization warning.
- **Observed Codabar sampling limitation:** ZXing.Net's per-character threshold misclassifies punctuation when nominally equal narrow spaces differ by one raster pixel. A fixed 30 or 60 px/mm raster failed the full punctuation case. The independent .NET rasterizer therefore derives a pitch of eight pixels per narrow bar from the actual IR widths and rounds rectangle coordinates. It neither reconstructs barcode patterns nor reads payload text to draw pixels. This is bounded decoder evidence, not a claim of all-DPI scanner acceptance.

Local validation on 2026-10-23 uses Node 24.19.0, pnpm 11.20.0, Chromium 153.0.8010.12 / Playwright 1.63.0. The .NET harness passed 28/28 using SDK **10.0.401**, runtime **10.0.12**, arm64; the repository's **10.0.302** pin is unchanged and was not available locally. CI's pinned SDK execution is separate evidence on the PR.

Reproduce after installing locked dependencies and building:

```sh
node packages/render-worker/tests/generate-barcode-fixtures.mjs
pnpm --filter @ofd-compose/media-core test
pnpm --filter @ofd-compose/render-worker test
pnpm --filter @ofd-compose/media-core test:browser
pnpm --filter @ofd-compose/render-worker test:browser
```

For sandboxed .NET verification, set writable `DOTNET_CLI_HOME`, `DOTNET_SKIP_FIRST_TIME_EXPERIENCE=1`, `DOTNET_CLI_TELEMETRY_OPTOUT=1`; restore locked packages, build the barcode test project with `-m:1 /nodeReuse:false /p:UseSharedCompilation=false --disable-build-servers /p:UseMicrosoftTestingPlatformRunner=true`, then run its built DLL with `--progress off`. Local SDK override is an explicit executable invocation, not a repository configuration change.

This admission is limited to the tested vector preparation/Worker profile. It does not certify commercial GS1 printing, physical scanners, OFD desktop readers, business samples, OS IME, production font decisions, or WP0 acceptance. QR/DataMatrix remain outside scope. Issue19's No-Go and issues17/18/35's missing human gates remain unchanged.
