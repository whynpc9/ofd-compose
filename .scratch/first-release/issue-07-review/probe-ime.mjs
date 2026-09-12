// Diagnostic of fixed upstream handlers with explicit stubs, not a browser/IME test.
// Run from repository root: node .scratch/first-release/issue-07-review/probe-ime.mjs
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const root = '.scratch/first-release/reference/canvas-editor-1.0.2/';
const baseline = JSON.parse(readFileSync('docs/decisions/evidence/canvas-editor-1.0.2-isolation.json'));
const checked = [];
function load(relative, imports) {
  const source = readFileSync(root + relative, 'utf8');
  const hash = createHash('sha256').update(source).digest('hex');
  assert.equal(hash, baseline.sourceFiles.find(f => f.path === relative)?.sha256);
  checked.push({ path: relative, sha256: hash });
  const compiled = ts.transpileModule(source, { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
  }}).outputText;
  const exports = {};
  new Function('exports', 'require', compiled)(exports, name => {
    assert(Object.hasOwn(imports, name), `Unexpected import: ${name}`);
    return imports[name];
  });
  return exports;
}
const input = load('src/editor/core/event/handlers/input.ts', {
  '../../../dataset/constant/Common': { ZERO: '\u200b' },
  '../../../dataset/constant/Element': { EDITOR_ELEMENT_COPY_ATTR: [], EDITOR_ELEMENT_STYLE_ATTR: [] },
  '../../../dataset/enum/Element': { ElementType: { TEXT: 'text' } },
  '../../../utils': { splitText: text => Array.from(text) },
  '../../../utils/element': { formatElementContext: () => {} },
});
const composition = load('src/editor/core/event/handlers/composition.ts', {
  '../../../utils/ua': { isFirefox: false }, './input': input,
}).default;
function run(name, endIndex, finalData, expected) {
  const elements = [...'\u200b甲乙丙'].map(value => ({ value }));
  let selection = { startIndex: 0, endIndex };
  const renderCalls = [];
  const range = {
    getRange: () => selection, setRange: (startIndex, endIndex) => { selection = { startIndex, endIndex }; },
    getIsCanInput: () => true, getDefaultStyle: () => null,
    getRangeAnchorStyle: (list, index) => list[index],
  };
  const draw = {
    isReadonly: () => false, isDisabled: () => false, isDesignMode: () => true,
    getPosition: () => ({ getCursorPosition: () => ({ index: selection.endIndex }) }),
    getRange: () => range, getElementList: () => elements,
    getCursor: () => ({ clearAgentDomValue: () => {} }),
    getTraceParticle: () => ({ markElementListInserted: () => {} }),
    getControl: () => ({ getIsRangeWithinControl: () => false, getActiveControl: () => null }),
    getOptions: () => ({ trace: { disabled: true } }),
    spliceElementList: (list, start, count, inserted = []) => list.splice(start, count, ...inserted),
    render: options => renderCalls.push(options),
    getAccessibility: () => ({ input: () => {} }),
  };
  const host = { getDraw: () => draw, isComposing: false, compositionInfo: null };
  const text = () => elements.slice(1).map(e => e.value).join('');
  composition.compositionstart(host);
  input.input('n', host);
  const during = text();
  composition.compositionend(host, { data: finalData });
  assert.equal(text(), expected);
  return { name, initial: '甲乙丙', initialSelection: { startIndex: 0, endIndex },
    finalData, during, after: text(), finalSelection: selection, renderCalls };
}
const cases = [
  run('collapsed-cancel', 0, '', '甲乙丙'),
  run('selected-cancel', 2, '', '丙'),
  run('selected-commit', 2, '你', '你丙'),
];
console.log(JSON.stringify({ upstreamCommit: baseline.package.gitHead, typescript: ts.version,
  evidence: 'isolated-handler-diagnostic', browserOrSystemImeExecuted: false,
  limitations: 'Plain text, trace disabled, no controls; DOM/Draw/Range/render are stubs, normalization and style copy are disabled, Array.from segments this BMP fixture. Explicit non-Firefox event sequence only; no claim about OS Esc events, node identity, actual history, or fix.',
  checkedSources: checked, cases }, null, 2));
