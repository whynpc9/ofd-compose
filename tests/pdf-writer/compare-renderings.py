"""Compare original and Form-grouped PDFs using the same fixed renderer instance."""
import argparse
import json
import pathlib
import subprocess
import tempfile

parser = argparse.ArgumentParser()
parser.add_argument('before', type=pathlib.Path)
parser.add_argument('after', type=pathlib.Path)
parser.add_argument('--image', default='ofd-compose-qpdf')
parser.add_argument('--report', type=pathlib.Path)
parser.add_argument('--baseline-label', default='7ecf477571045ad5dc9418c9141efc593f5e55b9')
parser.add_argument('--max-channel-delta', type=int, default=0)
parser.add_argument('--pixel-allowlist', type=pathlib.Path)
args = parser.parse_args()
assert args.max_channel_delta in [0, 1]
allowlist = json.loads(args.pixel_allowlist.read_text())["pages"] if args.pixel_allowlist else None
assert args.max_channel_delta == 0 or allowlist is not None, 'A measured pixel allowlist is required for nonzero tolerance'
before, after = args.before.resolve(), args.after.resolve()
files = sorted(before.glob('*.pdf'))
assert files and {f.name for f in files} == {f.name for f in after.glob('*.pdf')}, 'PDF case sets differ'
rows = []
with tempfile.TemporaryDirectory(prefix='ofd-form-pixels-') as directory:
    output = pathlib.Path(directory)
    for pdf in files:
        for side, folder in [('before', before), ('after', after)]:
            subprocess.run(['docker', 'run', '--rm', '--network', 'none', '--memory', '256m',
                            '-v', f'{folder}:/input:ro', '-v', f'{output}:/output',
                            '--entrypoint', 'pdftoppm', args.image, '-scale-to', '1000', *(['-png'] if args.max_channel_delta == 0 else []),
                            f'/input/{pdf.name}', f'/output/{side}-{pdf.stem}'],
                           check=True, capture_output=True)
    originals = sorted(output.glob('before-*.png' if args.max_channel_delta == 0 else 'before-*.ppm'))
    assert originals
    for page in originals:
        current = output / page.name.replace('before-', 'after-', 1)
        assert current.exists()
        if args.max_channel_delta == 0:
            assert page.read_bytes() == current.read_bytes(), f'Visual change: {page.name}'
            rows.append({'page': page.name[7:], 'maxChannelDelta': 0, 'changedChannels': 0})
        else:
            a, b = page.read_bytes().split(b'\n', 3), current.read_bytes().split(b'\n', 3)
            assert a[:3] == b[:3] and a[0] == b'P6' and a[2] == b'255' and len(a[3]) == len(b[3])
            differences = [abs(x-y) for x,y in zip(a[3], b[3])]
            maximum = max(differences, default=0)
            assert maximum <= args.max_channel_delta, f'Pixel delta {maximum}: {page.name}'
            width, height = map(int, a[1].split())
            changed = sorted({i // 3 for i,d in enumerate(differences) if d})
            pixels = [[i % width, i // width] for i in changed]
            channels = sum(d != 0 for d in differences)
            if allowlist is not None:
                limit = allowlist.get(page.name[7:])
                if limit is None:
                    assert channels == 0, f'Unexpected raster change: {page.name}'
                else:
                    assert maximum <= limit['maxChannelDelta'] and channels <= limit['maxChangedChannels']
                    assert {tuple(p) for p in pixels} <= {tuple(p) for p in limit['allowedPixels']}, f'Change outside measured edge pixels: {page.name}'
            rows.append({'page': page.name[7:], 'maxChannelDelta': maximum, 'changedChannels': channels, 'changedPixels': pixels})
report = {'baseline': args.baseline_label,
          'pdfCases': len(files), 'pixelIdenticalPages': sum(r['maxChannelDelta'] == 0 for r in rows), 'pages': rows}
if args.report:
    args.report.write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps(report))
