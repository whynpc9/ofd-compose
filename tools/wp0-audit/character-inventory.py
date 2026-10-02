"""Inventory only the committed issue03 corpus; not a DOCX importer or renderer.

Run from any directory. JSON goes to stdout; no original evidence is rewritten.
"""

import collections
import hashlib
import io
import json
from pathlib import Path
import re
import subprocess
import xml.etree.ElementTree as ET
import zipfile

ROOT = Path(__file__).resolve().parents[2]
BASELINE = "11e39873fc1bf4ec23cba636d3b535946c59c2ee"
CORPUS = ROOT / "tests/golden-corpus"
REPORTS = CORPUS / "scan-reports"
W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"


def sha(data):
    return hashlib.sha256(data).hexdigest()


def baseline_bytes(path):
    relative = path.relative_to(ROOT).as_posix()
    expected = subprocess.check_output(
        ["git", "show", f"{BASELINE}:{relative}"], cwd=ROOT)
    actual = path.read_bytes()
    if actual != expected:
        raise ValueError(f"Input differs from pinned baseline {BASELINE}: {relative}")
    return actual


def inventory(counts):
    return {
        "occurrences": sum(counts.values()),
        "distinctCodePoints": len(counts),
        "frequencies": {f"U+{cp:04X}": n for cp, n in sorted(counts.items())},
        "outsideCandidate": [
            f"U+{cp:04X}" for cp in sorted(counts)
            if not any(start <= cp <= end for start, end in ranges)
        ],
    }


repertoire = baseline_bytes(ROOT / "packages/typography-core/src/repertoire-data.ts").decode()
ranges = [(int(a, 16), int(b, 16)) for a, b in
          re.findall(r"\[(0x[0-9a-f]+), (0x[0-9a-f]+)\]", repertoire)]
assert sum(b - a + 1 for a, b in ranges) == 71850
repertoire_digest = sha(b"".join(cp.to_bytes(4, "big") for a, b in ranges
                                  for cp in range(a, b + 1)))
assert repertoire_digest in repertoire
migration_bytes = baseline_bytes(REPORTS / "migration-report.json")
migration = json.loads(migration_bytes)
totals = {"body": collections.Counter(), "headerFooter": collections.Counter()}
files = []
for entry in migration["templates"]:
    path = CORPUS / entry["file"]
    scan_bytes = baseline_bytes(REPORTS / entry["report"])
    scan = json.loads(scan_bytes)
    docx_bytes = baseline_bytes(path)
    digest = sha(docx_bytes)
    assert digest == scan["file"]["sha256"], path
    parts = []
    with zipfile.ZipFile(io.BytesIO(docx_bytes)) as archive:
        for name in sorted(archive.namelist()):
            if name != "word/document.xml" and not re.fullmatch(r"word/(header|footer)\d+\.xml", name):
                continue
            data = archive.read(name)
            tree = ET.fromstring(data)
            counts = collections.Counter(ord(c) for node in tree.iter(W + "t")
                                         for c in (node.text or ""))
            scope = "body" if name == "word/document.xml" else "headerFooter"
            totals[scope].update(counts)
            parts.append({"part": name, "sha256": sha(data), **inventory(counts)})
    files.append({"file": entry["file"], "sha256": digest,
                  "scanReport": entry["report"], "scanSha256": sha(scan_bytes),
                  "tagCount": scan["summary"]["tagCount"], "parts": parts})

print(json.dumps({
    "format": "ofd-compose/wp0-character-inventory@0",
    "sourceBaseline": BASELINE,
    "scope": "Raw w:t code points, including template tags; body and static header/footer separated. No expression evaluation, data values, generated labels, tabs/break elements, glyph coverage or business acceptance.",
    "migrationReportSha256": sha(migration_bytes),
    "candidateRepertoireSha256": repertoire_digest,
    "fileCount": len(files),
    "tagCount": sum(f["tagCount"] for f in files),
    "totals": {k: inventory(v) for k, v in totals.items()},
    "files": files,
}, ensure_ascii=False, indent=2) + "\n", end="")
