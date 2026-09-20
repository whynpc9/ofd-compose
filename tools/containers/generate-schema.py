"""Derive the experimental source-content schema from the committed contract schemas."""
import json
import subprocess
from pathlib import Path
root = Path(__file__).resolve().parents[2]
def obj(properties, optional=()):
    return {'type':'object','additionalProperties':False,'properties':properties,'required':[k for k in properties if k not in optional]}
def arr(item): return {'type':'array','items':item,'maxItems':128}
def string(**kw): return {'type':'string',**kw}
sha = string(pattern='^[a-f0-9]{64}$')
identifier = string(minLength=1,maxLength=256)
size = {'type':'integer','minimum':1,'maximum':33554432}
resolved = json.loads((root/'schemas/document-model/resolved-document.schema.json').read_text())
for key in ['format','modelVersion','templateSchemaVersion','expressionLanguageVersion','bindingPolicyVersion']:
    resolved['properties'][key] = string(minLength=1,maxLength=128)
ir = json.loads((root/'schemas/layout-ir/canonical-layout-ir.schema.json').read_text())
style = resolved['properties']['styles']['patternProperties']['^(.*)$']
font = obj({'family':identifier,'weight':{'type':'integer','minimum':1,'maximum':1000},'italic':{'type':'boolean'},'sha256':sha,'byteLength':size})
image = obj({'id':identifier,'sha256':sha,'byteLength':size,'mimeType':{'enum':['image/png','image/jpeg']}},['mimeType'])
number = {'type':'number'}
box = obj(dict.fromkeys(['x','y','width','height'],number))
page = obj({'width':number,'height':number,'contentBox':box})
layout = obj({'page':page,'pagination':obj({'maxPages':size,'maxIterations':size},['maxPages','maxIterations']),'defaultStyle':style,'formattingPolicy':obj(dict.fromkeys(['version','locale','timeZone','tzdataVersion','rounding'],string()))},['page','pagination'])
schema = obj({'resolvedDocument':resolved,'renderProfile':obj({'version':string(minLength=1,maxLength=128),'layout':layout}), 'resources':obj({'fonts':arr(font),'images':arr(image),'layout':ir['properties']['resources']}),'semanticMap':ir['properties']['semantics'],'irDigest':sha})
schema['$schema']='https://json-schema.org/draft/2020-12/schema'
(root/'schemas/containers/source-content.schema.json').write_text(json.dumps(schema,ensure_ascii=False,indent=2)+'\n')

subprocess.run([str(root/"node_modules/.bin/biome"), "format", "--write", str(root/"schemas/containers/source-content.schema.json")], check=True)
