# Owned reader probes

`ascii`, `nbsp`, `newline`, `double-space` are small synthetic Layout IR inputs based on the committed `tests/ofd-writer/fixtures/truetype` subset. Their original PDFs preserve the input Unicode in ToUnicode. The matching r0 font bytes are that fixture's `r0.bin` (no user document data).

`worker-double/` is stronger normal-input evidence: public Render Worker, original combined-input profile, a paragraph with node p/text node t and text `o  f`, real LXGW font manifest entry 2 and the pinned hb-subset WASM. It produces logical/display `o  f` and four glyphs. `worker.pdf` comes from the semantic-Form writer without modifying that IR/subset.

Observed stock pdf.js 5.4.149 results with disableNormalization=true:

| Input logical text | showText Unicode | getTextContent |
| --- | --- | --- |
| `A B` | `A B` | `A B` |
| `A\u00A0B` | `A\u00A0B` | `A B` |
| `A\nB` | `A\nB` | `A B` |
| `A  B` | `A  B` | `A B` |
| real Worker `o  f` | `o  f` | `o f` |

NBSP/LF inputs are retained as writer negatives. On 2026-09-19 the user accepted only the verified real Worker `o  f` high-level `o f` difference at pdf.js 5.4.149. The separate `accepted-whitespace.json` contract pins that case; synthetic probes do not authorize generic normalization or further exceptions. Source text remains unchanged.
