// Provisional atom AST: UTF-16 anchors, per-grapheme IDs; NOT the issue20 v1 model.
export const fixture = {
  type: "document",
  id: "fixture",
  children: [
    { type: "text", nodeId: "n1", value: "甲", bold: false },
    { type: "text", nodeId: "n2", value: "乙", bold: true },
    { type: "text", nodeId: "n3", value: "丙", bold: false },
    { type: "binding", nodeId: "n4", value: "名", binding: "sample.name", bold: false },
  ],
};
const clone = (x) => structuredClone(x);
function freeze(x) {
  if (x && typeof x === "object") {
    for (const v of Object.values(x)) freeze(v);
    Object.freeze(x);
  }
  return x;
}
export function leaves(ast) {
  return ast.children.flatMap((n) => (n.type === "wrap" ? leaves(n) : [n]));
}
export function project(ast) {
  return [
    ...leaves(ast).map((n) => ({ value: n.value, bold: n.bold, extension: { nodeId: n.nodeId } })),
  ];
}
export class Adapter {
  constructor(editor, source = fixture) {
    this.editor = editor;
    this.ast = clone(source);
    this.revision = 0;
    this.sequence = 10;
    this.owners = new WeakMap();
    this.initialCapture = true;
    this.sessionId = crypto.randomUUID();
    this.snapshots = new Map();
    this.events = [];
    this.history = editor.spike.history;
    this.pending = null;
    this.failCapture = false;
    this.failRestore = false;
    this.reenter = false;
    this.readonly = leaves(source).some((n) => n.type === "unknown");
    this.history.connect({
      capture: (id) => this.capture(id),
      restore: (s, id, action) => {
        if (this.failRestore && action !== "discard") {
          this.failRestore = false;
          throw new Error("RESTORE_REJECTED");
        }
        this.ast = clone(s.ast);
        this.current = s;
        this.rememberOwners();
        this.events.push({ action: `restore:${action}`, id });
      },
      publish: (action, id, liveIds) => {
        for (const key of this.snapshots.keys())
          if (!liveIds.includes(key)) this.snapshots.delete(key);
        if (action !== "discard") this.revision++;
        this.events.push({ action, id, liveIds, revision: this.revision });
      },
    });
    if (this.readonly) editor.command.executeMode("readonly");
    const container = editor.command.getContainer();
    this.onBefore = (event) => {
      if (this.readonly || event.isComposing) return;
      if (event.type === "keydown" && !["Backspace", "Delete", "Enter"].includes(event.key)) return;
      this.history.begin();
      // Non-mutating input/paste does not leave an open transaction behind.
      queueMicrotask(() => {
        if (!this.composing && this.history.inspect().composing) this.history.cancel();
      });
    };
    for (const type of ["input", "paste", "keydown"])
      container.addEventListener(type, this.onBefore, true);
    container.addEventListener("compositionstart", () => {
      this.composing = true;
    });
    container.addEventListener("compositionend", () => {
      this.composing = false;
    });
  }
  capture(id) {
    if (this.failCapture) {
      this.failCapture = false;
      throw new Error("RECONCILIATION_REJECTED");
    }
    if (this.reenter) {
      this.reenter = false;
      this.history.undo();
    }
    let ast = clone(this.pending || this.ast);
    const old = new Map(leaves(ast).map((n) => [n.nodeId, n]));
    const used = new Set();
    const nodes = this.editor.spike
      .elements()
      .slice(1)
      .map((e) => {
        let nodeId = e.extension?.nodeId;
        const previous = old.get(nodeId);
        if (
          !previous ||
          used.has(nodeId) ||
          (!this.initialCapture && this.owners.get(e) !== nodeId)
        )
          nodeId = `new${++this.sequence}`;
        used.add(nodeId);
        e.extension = { nodeId };
        return { ...(previous || { type: "text" }), nodeId, value: e.value, bold: !!e.bold };
      });
    // The fixture supports one whole-document wrapper, preserving its structural identity.
    ast.children =
      ast.children[0]?.type === "wrap" ? [{ ...ast.children[0], children: nodes }] : nodes;
    if (this.readonly) ast = clone(this.ast);
    const projection = clone(this.editor.spike.snapshot());
    const mapping = nodes.map((n, i) => ({
      index: i + 1,
      nodeId: n.nodeId,
      start: 0,
      end: n.value.length,
    }));
    const logical = (index) =>
      index === 0
        ? { nodeId: ast.id, offset: 0 }
        : { nodeId: nodes[index - 1]?.nodeId, offset: nodes[index - 1]?.value.length };
    const selection = {
      anchor: logical(projection.range.startIndex),
      focus: logical(projection.range.endIndex),
      range: projection.range,
      zone: projection.zone,
      context: projection.context,
    };
    const snapshot = freeze({
      sessionId: this.sessionId,
      historyEntryId: id,
      ast,
      mapping,
      projection,
      selection,
    });
    this.ast = clone(ast);
    this.current = snapshot;
    this.snapshots.set(id, snapshot);
    this.initialCapture = false;
    this.rememberOwners();
    return snapshot;
  }
  rememberOwners() {
    this.owners = new WeakMap(
      this.editor.spike
        .elements()
        .slice(1)
        .map((e) => [e, e.extension?.nodeId]),
    );
  }
  reset(source) {
    if (this.readonly || leaves(source).some((n) => n.type === "unknown"))
      throw new Error("UNSUPPORTED_DOCUMENT_READONLY");
    this.history.begin();
    this.pending = clone(source);
    this.initialCapture = true;
    try {
      this.editor.command.executeSetValue({ main: project(source) }, { isSetCursor: true });
    } catch (error) {
      this.history.cancel();
      throw error;
    } finally {
      this.pending = null;
      this.initialCapture = false;
    }
  }
  command(name, ...args) {
    if (name === "executeSetValue") throw new Error("USE_SOURCE_RESET");
    if (this.readonly) throw new Error("UNSUPPORTED_DOCUMENT_READONLY");
    this.history.begin();
    try {
      this.editor.command[name](...args);
    } catch (error) {
      this.history.cancel();
      throw error;
    } finally {
      if (this.history.inspect().composing) this.history.cancel();
    }
  }
  domain(change) {
    if (this.readonly) throw new Error("UNSUPPORTED_DOCUMENT_READONLY");
    this.history.begin();
    try {
      this.pending = clone(this.ast);
      change(this.pending);
      this.editor.spike.checkpoint();
    } catch (error) {
      this.history.cancel();
      throw error;
    } finally {
      this.pending = null;
    }
  }
  state() {
    const view = this.editor.spike.snapshot();
    const nodes = leaves(this.ast);
    const anchor = (index) =>
      index === 0
        ? { nodeId: this.ast.id, offset: 0 }
        : { nodeId: nodes[index - 1]?.nodeId, offset: nodes[index - 1]?.value.length };
    return clone({
      liveSelection: {
        anchor: anchor(view.range.startIndex),
        focus: anchor(view.range.endIndex),
        zone: view.zone,
        context: view.context,
      },
      ast: this.ast,
      current: this.current,
      revision: this.revision,
      history: this.history.inspect(),
      associations: [...this.snapshots.keys()],
      view: this.editor.spike.snapshot(),
    });
  }
}
