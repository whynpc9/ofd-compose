# ADR-0005: Experimental source attachment and filled-document finalization

Status: Proposed — desktop target-reader extraction gate remains open

Issue: `.scratch/first-release/issues/17-source-attachment-protocol-and-round-trip.md`

The implementation uses one standard OFD JSON attachment as an experiment, with
four individually hashed JSON-text parts, content-addressed source-image assets,
full-font identity locks and a Semantic Map linked to fixed-writer object IDs.
This avoids nested archive inflation and allows independent readers to extract the
entire manifest. It is not the WP0.10 choice between single and multiple attachments.

The worker now offers `finalizeResolved` and `finalizeSource` without re-executing
TemplateSource expressions. Both share the existing resource budget, media preparation,
HarfBuzz layout and subset path. Reopening verifies host-authorized full-font identities;
embedded subsets are never accepted as full fonts. The native source omits unused Data
and evaluation metadata but preserves printed values and edit/source relationships.
A distribution profile contains no source parts; WP1 reports only unsigned/unverified.

Library evidence on 2026-09-20: actual Node Worker produced OFD, .NET Reader extracted
its JSON MIME attachment, extraction loaded the filled document, edited text and added
`新`, then Worker/OfdIrWriter emitted a new revision with changed source/IR/subset
identities and unchanged original file bytes. Java ofdrw Reader 2.3.7 extracted and
validated the same parts and compared 7 initial / 15 edited glyphs with zero geometry
error. Tests also cover missing/corrupt/denied/full-versus-subset font authorization,
source minimization, malformed containers, distribution and signature boundaries.
Reproduction and current test evidence are maintained in `tests/source-container/`.

Desktop target-reader evidence: **Not verified**. `/Applications` and user Applications
were inventoried. Foxit Phantom 11.3.2009 (bundle build 11320090424) is installed;
its declared types are PDF/PPDF/FDF plus a generic wildcard, which is not evidence of
OFD support. No installed 数科 or WPS target reader was found in those locations.
The Computer Use attempt to select Foxit timed out without any accessible state or
screenshot. No license/EULA was accepted and no business document was used. Installed
application presence does not establish available OFD extraction functionality or
license entitlement. No target-reader extraction or visual result is claimed.

Consequences: issue 17 cannot be marked fully accepted, nor used to freeze the issue 19
container profile, until an available licensed target reader extracts the test payload.
The exact required gate remains open even if CI and both library readers pass. HTTP
source extraction (issue 31), signature verification, foreign/signed document editing,
and formal container-profile freezing (issue 19) remain outside this change.
