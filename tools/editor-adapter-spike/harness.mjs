import PublishedEditor from "@published";
import PatchedEditor from "@upstream";
import { Adapter, fixture, leaves, project } from "./adapter.mjs";

const clone = (x) => structuredClone(x);
const delay = () => new Promise((resolve) => setTimeout(resolve, 30));
const equal = (a, b, message) => {
  if (JSON.stringify(a) !== JSON.stringify(b))
    throw new Error(`${message}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`);
};
const ok = (value, message) => {
  if (!value) throw new Error(message);
};
let editor, adapter;
let trace = [];
function create(patched = true, source = fixture, max = 40) {
  editor?.destroy();
  document.querySelector("#editor").replaceChildren();
  editor = new (patched ? PatchedEditor : PublishedEditor)(
    document.querySelector("#editor"),
    project(source),
    { historyMaxRecordCount: max },
  );
  editor.command.executeSetRange(0, 0);
  adapter = patched ? new Adapter(editor, source) : null;
  trace = [];
  for (const type of [
    "compositionstart",
    "compositionupdate",
    "compositionend",
    "beforeinput",
    "input",
    "paste",
    "keydown",
  ]) {
    editor.command.getContainer().addEventListener(type, (event) => {
      trace.push({
        type,
        data: event.data,
        inputType: event.inputType,
        key: event.key,
        isComposing: event.isComposing,
        clipboard: event.clipboardData
          ? {
              types: [...event.clipboardData.types],
              items: [...event.clipboardData.items].map((i) => ({ kind: i.kind, type: i.type })),
              text: event.clipboardData.getData("text/plain"),
            }
          : null,
        isTrusted: event.isTrusted,
        time: performance.now(),
        state: adapter?.state(),
      });
    });
  }
  return { editor, adapter };
}
function text() {
  return editor.command.getText().main.replaceAll("\u200b", "").replaceAll("\n", "");
}
function select(a = 0, b = 2) {
  editor.command.executeSetRange(a, b);
}
function input(data, composing = false) {
  editor.command
    .getContainer()
    .querySelector("textarea")
    .dispatchEvent(
      new InputEvent("input", {
        bubbles: true,
        data,
        inputType: composing ? "insertCompositionText" : "insertText",
        isComposing: composing,
      }),
    );
}
function composition(type, data = "") {
  editor.command
    .getContainer()
    .querySelector("textarea")
    .dispatchEvent(new CompositionEvent(type, { bubbles: true, data }));
}
function key(value, modifiers = {}) {
  editor.command
    .getContainer()
    .querySelector("textarea")
    .dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: value, ...modifiers }),
    );
}
function insert(value) {
  adapter.command("executeInsertElementList", [{ value }]);
}
function check(state) {
  const atoms = leaves(state.ast);
  equal(
    state.view.main
      .slice(1)
      .map((e) => e.value)
      .join(""),
    atoms.map((n) => n.value).join(""),
    "projection/source text",
  );
  equal(
    state.view.main.slice(1).map((e) => e.extension?.nodeId),
    atoms.map((n) => n.nodeId),
    "projection/source identity",
  );
  equal(
    state.current.mapping.map((m) => m.nodeId),
    atoms.map((n) => n.nodeId),
    "mapping/source identity",
  );
  ok(new Set(atoms.map((n) => n.nodeId)).size === atoms.length, "unique identities");
  equal(
    [...state.history.undo, ...state.history.redo].sort(),
    state.associations.sort(),
    "association lifetime",
  );
}
async function run() {
  const cases = [];
  async function test(name, action) {
    try {
      const evidence = await action();
      cases.push({ name, status: "pass", evidence });
    } catch (error) {
      cases.push({ name, status: "fail", error: error.stack, state: adapter?.state(), trace });
    }
  }
  await test("published-selected-cancel-reproduces-loss", async () => {
    create(false);
    select();
    composition("compositionstart");
    input("n", true);
    composition("compositionend");
    await delay();
    equal(text(), "丙名", "fixed upstream defect");
    return { expectedFailure: "Selected 甲乙 lost", actual: text(), trace };
  });
  await test("published-async-A-B-loses-intermediate-observation", async () => {
    create(false);
    const observed = [];
    editor.eventBus.on("contentChange", () => observed.push(text()));
    editor.command.executeInsertElementList([{ value: "A" }]);
    editor.command.executeInsertElementList([{ value: "B" }]);
    await delay();
    ok(
      observed.length >= 2 && observed.every((s) => s === "AB甲乙丙名"),
      "notifications observe B only",
    );
    editor.command.executeUndo();
    const intermediate = text();
    equal(intermediate, "A甲乙丙名", "A existed upstream");
    return { expectedFailure: "No event identifies A checkpoint", observed, intermediate };
  });
  await test("patched-sync-A-B-every-undo-redo-state", async () => {
    create();
    const states = [adapter.state()];
    insert("A");
    states.push(adapter.state());
    insert("B");
    states.push(adapter.state());
    await delay();
    equal(adapter.state().history.undo.length, 3, "no async duplicate commit");
    for (const i of [1, 0]) {
      editor.command.executeUndo();
      const s = adapter.state();
      check(s);
      equal(s.ast, states[i].ast, "undo snapshot");
      equal(s.current, states[i].current, "immutable undo checkpoint");
      states.push(s);
    }
    for (const i of [1, 2]) {
      editor.command.executeRedo();
      const s = adapter.state();
      check(s);
      equal(s.ast, states[i].ast, "redo snapshot");
      equal(s.current, states[i].current, "immutable redo checkpoint");
      states.push(s);
    }
    ok(
      states.every((s, i) => !i || s.revision > states[i - 1].revision),
      "monotonic revisions",
    );
    return states;
  });
  for (const commit of [false, true])
    await test(`patched-selected-ime-${commit ? "commit" : "cancel"}-with-redo`, async () => {
      create();
      insert("Z");
      editor.command.executeUndo();
      select();
      const before = adapter.state();
      composition("compositionstart");
      input("n", true);
      input("ni", true);
      const during = adapter.state();
      equal(during.ast, before.ast, "temporary content not persisted");
      equal(during.revision, before.revision, "no temporary revision");
      composition("compositionend", commit ? "你" : "");
      await delay();
      const after = adapter.state();
      check(after);
      if (commit) {
        equal(text(), "你丙名", "IME replacement");
        equal(after.history.undo.length, before.history.undo.length + 1, "one commit");
        equal(after.history.redo, [], "redo pruned on commit");
        editor.command.executeUndo();
        equal(text(), "甲乙丙名", "commit undo text");
      } else {
        equal(after.ast, before.ast, "cancel source");
        equal(after.current.mapping, before.current.mapping, "cancel mapping");
        equal(after.view, before.view, "full cancel projection/context/selection");
        equal(after.liveSelection, before.liveSelection, "cancel logical selection");
        equal(after.history, before.history, "cancel cursor and redo");
        equal(after.revision, before.revision, "cancel no revision");
        editor.command.executeRedo();
        equal(text(), "Z甲乙丙名", "redo branch remains usable");
      }
      return { before, during, after, trace };
    });
  await test("patched-direct-input-paste-shortcut", async () => {
    create();
    input("直");
    await delay();
    const direct = adapter.state();
    check(direct);
    equal(text(), "直甲乙丙名", "direct input");
    const clipboard = new DataTransfer();
    clipboard.setData("text/plain", "粘贴");
    // Firefox ignores the constructor's clipboardData initializer. This remains
    // an explicitly synthetic payload through the real textarea paste handler.
    const pasteEvent = new ClipboardEvent("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(pasteEvent, "clipboardData", { value: clipboard });
    editor.command.getContainer().querySelector("textarea").dispatchEvent(pasteEvent);
    await delay();
    const pasted = adapter.state();
    check(pasted);
    equal(text(), "直粘贴甲乙丙名", "paste entry");
    key("z", { ctrlKey: true, metaKey: true, code: "KeyZ", keyCode: 90 });
    await delay();
    const undone = adapter.state();
    check(undone);
    equal(undone.ast, direct.ast, "shortcut undo source");
    return { direct, pasted, undone, trace };
  });
  await test("patched-Chinese-split-style-copy-delete", async () => {
    create();
    select(0, 2);
    adapter.command("executeBold");
    const styled = adapter.state();
    check(styled);
    equal(
      leaves(styled.ast)
        .slice(0, 2)
        .map((n) => n.nodeId),
      ["n1", "n2"],
      "style preserves identity",
    );
    // Rich duplicate of projected elements exercises duplicate identity repair.
    const copied = clone(styled.view.main.slice(1, 3));
    select(4, 4);
    adapter.command("executeInsertElementList", copied);
    const duplicated = adapter.state();
    check(duplicated);
    ok(leaves(duplicated.ast).length === 6, "copied two Chinese atoms");
    select(4, 6);
    adapter.command("executeBackspace");
    const deleted = adapter.state();
    check(deleted);
    equal(deleted.ast, styled.ast, "delete preserves originals");
    return { styled, duplicated, deleted };
  });
  await test("patched-prepend-copy-keeps-original-identities", async () => {
    create();
    const before = adapter.state();
    const copied = clone(before.view.main.slice(1, 3));
    select(0, 0);
    adapter.command("executeInsertElementList", copied);
    const duplicated = adapter.state();
    check(duplicated);
    equal(
      leaves(duplicated.ast)
        .slice(2)
        .map((n) => n.nodeId),
      ["n1", "n2", "n3", "n4"],
      "original IDs after prepended copy",
    );
    ok(
      leaves(duplicated.ast)
        .slice(0, 2)
        .every((n) => !["n1", "n2"].includes(n.nodeId)),
      "copies receive fresh IDs",
    );
    select(0, 2);
    adapter.command("executeBackspace");
    const deleted = adapter.state();
    check(deleted);
    equal(deleted.ast, before.ast, "deleting copy preserves original AST");
    return { before, duplicated, deleted };
  });
  await test("patched-synchronous-observers-see-only-atomic-states", async () => {
    create();
    const observations = [];
    for (const event of ["renderChange", "positionContextChange"])
      editor.eventBus.on(event, () => {
        const s = adapter.state();
        observations.push({
          event,
          text: s.view.main
            .slice(1)
            .map((e) => e.value)
            .join(""),
          sourceText: leaves(s.ast)
            .map((n) => n.value)
            .join(""),
          ids: s.view.main.slice(1).map((e) => e.extension?.nodeId),
          sourceIds: leaves(s.ast).map((n) => n.nodeId),
          revision: s.revision,
        });
      });
    insert("A");
    editor.command.executeUndo();
    editor.command.executeRedo();
    adapter.failRestore = true;
    try {
      editor.command.executeUndo();
    } catch (e) {
      equal(e.message, "RESTORE_REJECTED", "restore rejection");
    }
    select(0, 2);
    composition("compositionstart");
    input("n", true);
    const duringObservationCount = observations.length;
    composition("compositionend");
    await delay();
    ok(observations.length > duringObservationCount, "cancel publishes restored observation");
    for (const observation of observations) {
      equal(observation.text, observation.sourceText, "observer text atomicity");
      equal(observation.ids, observation.sourceIds, "observer identity atomicity");
    }
    return { observations, state: adapter.state() };
  });
  await test("patched-metadata-text-wrap-single-domain-and-branch", async () => {
    create();
    const baseline = adapter.state();
    adapter.domain((ast) => {
      leaves(ast).find((n) => n.nodeId === "n4").binding = "sample.alias";
    });
    const bound = adapter.state();
    equal(bound.view.main, baseline.view.main, "metadata same visible projection");
    insert("文");
    const edited = adapter.state();
    adapter.domain((ast) => {
      ast.children = [
        { type: "wrap", nodeId: "wrap1", predicate: "sample.enabled", children: ast.children },
      ];
    });
    const wrapped = adapter.state();
    check(wrapped);
    const undo = [];
    for (const expected of [edited, bound, baseline]) {
      editor.command.executeUndo();
      const s = adapter.state();
      check(s);
      equal(s.ast, expected.ast, "mixed undo state");
      undo.push(s);
    }
    editor.command.executeRedo();
    equal(adapter.state().ast, bound.ast, "binding redo");
    insert("新");
    const branch = adapter.state();
    check(branch);
    equal(branch.history.redo, [], "branch cleared");
    ok(branch.revision > wrapped.revision, "branch revision remains monotonic");
    return { baseline, bound, edited, wrapped, undo, branch };
  });
  await test("patched-reconcile-failure-rollback-and-reentry", async () => {
    create();
    insert("A");
    editor.command.executeUndo();
    select(0, 2);
    const before = adapter.state();
    adapter.failCapture = true;
    let error;
    try {
      insert("bad");
    } catch (e) {
      error = e.message;
    }
    equal(error, "RECONCILIATION_REJECTED", "injected reconcile failure");
    let after = adapter.state();
    equal(after.ast, before.ast, "failed source rollback");
    equal(after.view, before.view, "failed view rollback");
    equal(after.history, before.history, "failed history rollback");
    adapter.reenter = true;
    try {
      insert("reenter");
    } catch (e) {
      error = e.message;
    }
    equal(error, "HISTORY_REENTRY", "reentry blocked");
    after = adapter.state();
    equal(after.view, before.view, "reentry rollback");
    check(after);
    return { before, after, error };
  });
  await test("patched-undo-failure-rolls-back-atomically", async () => {
    create();
    insert("A");
    const before = adapter.state();
    adapter.failRestore = true;
    let error;
    try {
      editor.command.executeUndo();
    } catch (e) {
      error = e.message;
    }
    equal(error, "RESTORE_REJECTED", "injected restore failure");
    const after = adapter.state();
    check(after);
    equal(after.ast, before.ast, "restore failure AST");
    equal(after.view, before.view, "restore failure view");
    equal(after.history, before.history, "restore failure stacks");
    equal(after.revision, before.revision, "restore failure revision");
    return { before, after, error };
  });
  await test("patched-history-clipping-and-reset-cleanup", async () => {
    create(true, fixture, 2);
    for (const value of ["A", "B", "C", "D"]) insert(value);
    const clipped = adapter.state();
    check(clipped);
    equal(clipped.history.undo.length, 3, "history limit plus baseline");
    adapter.domain(() => {});
    const metadataNoop = adapter.state();
    check(metadataNoop);
    adapter.domain((ast) => {
      leaves(ast).find((n) => n.nodeId === "n4").binding = "sample.changed";
    });
    const beforeRejectedReset = adapter.state();
    adapter.failCapture = true;
    let failure;
    try {
      adapter.reset(fixture);
    } catch (error) {
      failure = error.message;
    }
    equal(failure, "RECONCILIATION_REJECTED", "reset failure diagnosed");
    const rejectedReset = adapter.state();
    equal(rejectedReset.ast, beforeRejectedReset.ast, "reset failure source rollback");
    equal(rejectedReset.view, beforeRejectedReset.view, "reset failure view rollback");
    equal(rejectedReset.history, beforeRejectedReset.history, "reset failure stack rollback");
    equal(
      rejectedReset.revision,
      beforeRejectedReset.revision,
      "reset failure no published revision",
    );
    adapter.reset(fixture);
    const reset = adapter.state();
    equal(reset.ast, fixture, "reset uses authoritative new source metadata and identities");
    check(reset);
    equal(reset.history.undo.length, 1, "reset initial checkpoint");
    equal(reset.associations.length, 1, "reset clears associations");
    return { clipped, metadataNoop, beforeRejectedReset, rejectedReset, reset };
  });
  await test("patched-missing-association-rolls-back-and-blocks-edit-save", async () => {
    create();
    insert("A");
    const a = adapter.state();
    insert("B");
    adapter.snapshots.delete(`${adapter.sessionId}:${a.current.historyEntryId}`);
    const before = adapter.state();
    let failure;
    try {
      editor.command.executeUndo();
    } catch (error) {
      failure = error.message;
    }
    equal(failure, "HISTORY_ASSOCIATION_MISSING", "missing target diagnosed by registry lookup");
    const after = adapter.state();
    equal(after.ast, before.ast, "missing target source rollback");
    equal(after.view, before.view, "missing target projection rollback");
    equal(after.history, before.history, "missing target stacks rollback");
    equal(after.revision, before.revision, "missing target no revision");
    for (const operation of [() => insert("blocked"), () => adapter.saveSource()]) {
      let blocked;
      try {
        operation();
      } catch (error) {
        blocked = error.message;
      }
      equal(blocked, "HISTORY_ASSOCIATION_MISSING", "edit/save fail closed until document reload");
    }
    return { before, after, failure };
  });
  await test("patched-unknown-source-readonly-preserved", async () => {
    const unknown = clone(fixture);
    unknown.children.push({
      type: "unknown",
      nodeId: "opaque",
      value: "□",
      payload: { vendor: "synthetic", lossless: [1, 2, 3] },
    });
    create(true, unknown);
    const before = adapter.state();
    input("坏");
    key("Backspace");
    await delay();
    const after = adapter.state();
    equal(after.ast, before.ast, "opaque source retained");
    equal(after.view, before.view, "readonly view unchanged");
    let error;
    try {
      insert("坏");
    } catch (e) {
      error = e.message;
    }
    equal(error, "UNSUPPORTED_DOCUMENT_READONLY", "domain blocked");
    return { before, after };
  });
  return {
    layer: "synthetic-browser-events-with-real-Editor",
    osImeVerified: false,
    userAgent: navigator.userAgent,
    cases,
    passed: cases.filter((c) => c.status === "pass").length,
    failed: cases.filter((c) => c.status === "fail").length,
  };
}
window.probe = {
  run,
  create,
  select,
  state: () => adapter?.state(),
  trace: () => clone(trace),
  text,
};
document.querySelector("#select").onclick = () => {
  select();
  document.querySelector("#status").textContent =
    "Selected 甲乙. Use an actual OS Pinyin IME to commit or cancel.";
};
document.querySelector("#reset").onclick = () => create();
create();
