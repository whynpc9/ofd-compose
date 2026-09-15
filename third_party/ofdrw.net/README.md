# ofdrw.net source pin

MIT source from https://github.com/whynpc9/ofdrw.net at
`b0df084060b2b7cd619c865e014cec90bec609c3` (upstream version 0.1.0-preview.5).
Only Core, Packaging, Layout and Reader are included. No Converter code is included
or referenced. Source files and project files are unchanged from `git archive`.
The local Directory.Build files compile those sources for net10.0 and enable locks;
these are product integration files, not upstream modifications.

The OfdIrWriter adapter uses Packaging's SourceXml preservation seam for precise
CGTransform, clipping and graphics state. It never invokes flowing Layout APIs.
The original repository is only read, never modified or published by this task.
