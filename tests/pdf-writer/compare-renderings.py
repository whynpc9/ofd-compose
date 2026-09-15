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
args = parser.parse_args()
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
                            '--entrypoint', 'pdftoppm', args.image, '-scale-to', '1000', '-png',
                            f'/input/{pdf.name}', f'/output/{side}-{pdf.stem}'],
                           check=True, capture_output=True)
    originals = sorted(output.glob('before-*.png'))
    assert originals
    for page in originals:
        current = output / page.name.replace('before-', 'after-', 1)
        assert current.exists() and page.read_bytes() == current.read_bytes(), f'Visual change: {page.name}'
        rows.append(page.name[7:])
report = {'baselineCommit': '7ecf477571045ad5dc9418c9141efc593f5e55b9',
          'pdfCases': len(files), 'pixelIdenticalPages': len(rows), 'pages': rows}
if args.report:
    args.report.write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps(report))
