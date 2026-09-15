// Plain Node writer fixtures: all IR and subsets come from the built public Worker.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { canonicalSerialize } from "@ofd-compose/layout-ir";
import { render } from "@ofd-compose/render-worker";
const root = new URL("../../../tests/ofd-writer/fixtures/", import.meta.url);
const manifest = JSON.parse(await readFile(new URL("../../typography-core/fonts/manifest.json", import.meta.url), "utf8"));
const input = JSON.parse(await readFile(new URL("combined-input.json", root), "utf8"));
const wasm = new Uint8Array(await readFile(new URL("harfbuzz-subset.wasm", import.meta.resolve("harfbuzzjs"))));
const image = new Uint8Array(JSON.parse(await readFile(new URL("node-image.json", import.meta.url), "utf8")));
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
for (const [name, fontIndex, text] of [["combined", 0, null], ["cff", 0, "office é 中文 𠮷"], ["truetype", 2, "office é 中文"], ["glyphless", 0, ""]]) {
  const entry = manifest[fontIndex];
  const font = new Uint8Array(await readFile(new URL(`../../typography-core/fonts/${entry.file}`, import.meta.url)));
  const source = structuredClone(input.source);
  if (text !== null) source.body = [{kind:"paragraph",nodeId:"p",inlines:[{kind:"text",nodeId:"t",text}]}];
  const result = await render(source, input.data, {
    fonts:[{family:"Noto",weight:400,italic:false,sha256:entry.sha256,byteLength:font.length,bytes:font}],
    subsetWasm:{byteLength:wasm.length,bytes:wasm},
    images:[{id:"picture",sha256:hash(image),byteLength:image.length,bytes:image}],
  }, input.profile);
  assert.equal(result.ok,true,JSON.stringify(result.diagnostics));
  const directory = new URL(`${name}/`,root);
  await mkdir(directory,{recursive:true});
  const canonical = canonicalSerialize(result.ir);
  assert.equal(hash(canonical),result.identity.irDigest);
  await writeFile(new URL("ir.json",directory),canonical);
  const resources=[];
  for (const resource of [...result.fonts,...result.images]) {
    const file=`${resource.resourceId}.bin`;
    await writeFile(new URL(file,directory),resource.bytes);
    resources.push({resourceId:resource.resourceId,file,sha256:hash(resource.bytes)});
  }
  await writeFile(new URL("manifest.json",directory),JSON.stringify({identity:result.identity,resources},null,2)+"\n");
  console.log(name,result.ir.pages.length,result.ir.pages.flatMap(p=>p.objects).filter(o=>o.kind==="text").map(o=>({text:o.logicalText,glyphs:o.glyphs.length})).slice(0,3));
}
