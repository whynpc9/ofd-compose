"""Mutate real delivered PDFs, rebuild xref, then use Poppler (not writer code)."""
import os
import pathlib
import re
import subprocess
import tempfile
import zlib

def run(command, **kwargs):
    image = os.environ.get('PDF_READER_IMAGE')
    if image:
        command = ['docker', 'run', '--rm', '--network', 'none', '--memory', '256m',
                   '-v', f'{ROOT}:{ROOT}:ro', '-v', f'{temp}:{temp}',
                   '--entrypoint', command[0], image, *command[1:]]
    return subprocess.run(command, **kwargs)


ROOT = pathlib.Path(__file__).resolve().parents[2]
OUTPUT = ROOT / '.scratch/issue16-output'


def mutate(data, kind):
    xref = int(re.search(rb'startxref\s+(\d+)', data).group(1))
    lines = data[xref:].splitlines()
    count = int(lines[1].split()[1])
    offsets = [int(line.split()[0]) for line in lines[3:count + 2]]
    objects = [data[offsets[i]:offsets[i + 1] if i + 1 < len(offsets) else xref]
               for i in range(len(offsets))]
    changed = False
    for i, obj in enumerate(objects):
        if kind in ['formbbox', 'formresources'] and b'/Subtype /Form ' in obj:
            if kind == 'formbbox':
                modified = re.sub(rb'/BBox \[[^\]]+\]', b'/BBox [0 0 1 1]', obj, count=1)
            else:
                fonts = sorted(set(re.findall(rb'/(F\d+) \d+ 0 R', data)))
                invalid = b'/Resources << /Font << ' + b' '.join(b'/' + name + b' << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>' for name in fonts) + b' >> >>'
                modified = re.sub(rb'/Resources \d+ 0 R', lambda _: invalid, obj, count=1)
            assert modified != obj
            objects[i] = modified
            changed = True
            break
        match = re.search(rb'/Length (\d+)', obj)
        if not match or b'/FlateDecode' not in obj:
            continue
        start = obj.index(b'stream\n') + 7
        end = start + int(match.group(1))
        raw = zlib.decompress(obj[start:end])
        modified = raw
        if kind == 'cmap' and b'beginbfchar' in raw:
            prefix, body = raw.split(b'beginbfchar', 1)
            modified = prefix + b'beginbfchar' + re.sub(rb'(<[0-9A-F]{4}> <)[0-9A-F]+(>)', rb'\g<1>0058\2', body, count=1)
        elif kind == 'cid' and len(raw) >= 4:
            # Recognize this stream by a referencing CIDToGIDMap entry, not by binary content.
            object_id = int(obj.split()[0])
            if f'/CIDToGIDMap {object_id} 0 R'.encode() in data:
                modified = raw[:2] + b'\0\0' + raw[4:]
        elif kind == 'ctm' and b' Tm\n' in raw:
            modified = re.sub(rb'1 0 0 -1 ([\d.]+) ', lambda m: b'1 0 0 -1 ' + str(float(m[1]) + 5000).encode() + b' ', raw, count=1)
        elif kind == 'clip' and b'W* n\n' in raw:
            modified = raw.replace(b'W* n\n', b'n\n')
        elif kind == 'imageclip' and b'W n\n' in raw:
            modified = raw.replace(b'W n\n', b'n\n', 1)
        elif kind == 'imagescale' and b'2000 0 0 -2000 0 2000 cm\n' in raw:
            modified = raw.replace(b'2000 0 0 -2000 0 2000 cm\n', b'1 0 0 -1 0 1 cm\n')
        elif kind == 'path' and b' c\n' in raw:
            modified = raw.replace(b'20000 5000 25000 30000 40000 30000 c', b'20000 5000 25000 30000 140000 130000 c')
        if modified == raw:
            continue
        encoded = zlib.compress(modified)
        header = re.sub(rb'/Length \d+', f'/Length {len(encoded)}'.encode(), obj[:start])
        objects[i] = header + encoded + obj[end:]
        changed = True
        # Glyph Forms repeat the same clip; corrupt every copy of that state.
        if kind != 'clip':
            break
    assert changed, f'{kind}: mutation did not change a target stream'
    result = bytearray(data[:offsets[0]])
    new_offsets = []
    for obj in objects:
        new_offsets.append(len(result))
        result.extend(obj)
    new_xref = len(result)
    result.extend(f'xref\n0 {count}\n0000000000 65535 f \n'.encode())
    for offset in new_offsets:
        result.extend(f'{offset:010} 00000 n \n'.encode())
    trailer = data[xref:].split(b'trailer', 1)[1].split(b'startxref', 1)[0]
    result.extend(b'trailer' + trailer + f'startxref\n{new_xref}\n%%EOF\n'.encode())
    return bytes(result)


def raster(pdf, target):
    run(['pdftoppm', '-f', '1', '-singlefile', '-r', '100', '-png', str(pdf), str(target)], check=True, capture_output=True)
    return target.with_suffix('.png').read_bytes()


with tempfile.TemporaryDirectory(prefix='ofd-pdf-mutations-') as directory:
    temp = pathlib.Path(directory)
    for kind in ['cmap', 'cid', 'ctm', 'clip', 'path', 'imageclip', 'imagescale', 'formbbox', 'formresources']:
        fixture = 'visible-image' if kind in ['imageclip', 'imagescale'] else 'geometry' if kind in ['clip', 'path'] else 'truetype'
        original = OUTPUT / f'{fixture}.pdf'
        altered = temp / f'{kind}.pdf'
        altered.write_bytes(mutate(original.read_bytes(), kind))
        if kind == 'cmap':
            before = run(['pdftotext', '-raw', str(original), '-'], check=True, capture_output=True).stdout
            after = run(['pdftotext', '-raw', str(altered), '-'], check=True, capture_output=True).stdout
            assert before != after, 'ToUnicode corruption was not detected'
        else:
            before = raster(original, temp / 'before')
            try:
                after = raster(altered, temp / 'after')
            except subprocess.CalledProcessError:
                assert kind == 'formresources', 'Unexpected renderer failure'
            else:
                assert before != after, f'{kind}: rendered change was not detected'
        print(f'{kind}: independent reader/render mutation detected')
