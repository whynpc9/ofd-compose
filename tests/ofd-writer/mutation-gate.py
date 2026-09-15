"""Prove the independent Reader gate rejects corrupted geometry, using owned temp copies."""
import pathlib
import shutil
import subprocess
import sys
import tempfile
import xml.etree.ElementTree as ET
import zipfile

image, fixtures, artifacts = sys.argv[1:]
artifacts = pathlib.Path(artifacts).resolve()
fixtures = pathlib.Path(fixtures).resolve()
with tempfile.TemporaryDirectory(prefix="ofd-reader-mutations-") as temporary:
    for mutation in ("path-vertex", "clip-rule"):
        output = pathlib.Path(temporary) / mutation
        output.mkdir()
        for source in artifacts.glob("*.ofd"):
            shutil.copyfile(source, output / source.name)
        target = output / "geometry.ofd"
        with zipfile.ZipFile(target) as archive:
            entries = [(entry.filename, archive.read(entry)) for entry in archive.infolist()]
        changed = False
        with zipfile.ZipFile(target, "w") as archive:
            for name, data in entries:
                if name.endswith("/Content.xml") and not changed:
                    text = data.decode("utf-8")
                    root = ET.fromstring(text)
                    if mutation == "path-vertex":
                        path = root.find(".//{*}PathObject/{*}AbbreviatedData")
                        if path is not None:
                            original = path.text
                            tokens = original.split()
                            tokens[1] = str(float(tokens[1]) + 1)
                            text = text.replace(original, " ".join(tokens), 1)
                            changed = True
                    elif 'Rule="Even-Odd"' in text:
                        text = text.replace('Rule="Even-Odd"', 'Rule="NonZero"', 1)
                        changed = True
                    data = text.encode("utf-8")
                archive.writestr(name, data)
        assert changed, f"No applicable {mutation} target"
        result = subprocess.run(
            ["docker", "run", "--rm", "--network", "none", "--memory", "512m", "--cpus", "2",
             "-v", f"{fixtures}:/fixtures:ro", "-v", f"{output}:/input:ro", image, "/fixtures", "/input"],
            text=True, capture_output=True, check=False,
        )
        expected = "geometry mismatch" if mutation == "path-vertex" else "path/clip fill rule"
        if result.returncode == 0 or expected not in result.stderr:
            raise RuntimeError(f"Mutation gate did not reject {mutation} for the expected reason: {result.stderr}")
        print(f"{mutation}: rejected by Java Reader geometry assertions")
