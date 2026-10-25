import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, existsSync, rmSync, copyFileSync, cpSync } from "node:fs";
import { resolve, join, relative, isAbsolute, dirname } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createProgress, configureProgress, newBoard, migrateProgress, readiness, refreshProgress, formatProgress,
  mappingAreas, preparationIds, emptyCheck, type OnboardingProgress, type ProgressCheck } from "../onboarding/progress.js";
import { saveProgress, loadProgress, completedCheck, evidenceReference, inspectReadiness } from "../onboarding/state-store.js";

const now = "2026-10-24T12:00:00.000Z";
const ref = { path: "fixture.local.md", sha256: "a".repeat(64) };
const done = (): ProgressCheck => ({ ...emptyCheck("complete"), evidence: [ref], checkedAt: now });
const board = (name = "Example") => newBoard(name, `https://${name.toLowerCase()}.test/`, `Site Architecture Context/${name}`);
function prepared(scope: "manualApplications" | "bothApplications" | "profileSetup" = "manualApplications") {
  const state = configureProgress(createProgress(), scope, scope === "profileSetup" ? [] : [board()], now);
  state.selectedRoles = [{ roleId: "qa", profilePath: "Job Context/Candidate/Role Profiles/QA" }];
  state.steps.candidateProfiles = done(); state.steps.applicationInstructions = done();
  if (scope !== "profileSetup") {
    state.steps.browserTools = done();
    for (const id of preparationIds) state.preparation[id] = done();
    state.preparation.scheduledAccess = { ...done(), status: "skipped", reason: "On-demand operation." };
    state.boards[0].access = done();
    for (const area of mappingAreas) state.boards[0].mapping[area] = done();
    if (scope === "bothApplications") state.emailConnection = done();
  }
  return state;
}
function sandbox(t: TestContext) {
  const root = mkdtempSync(join(tmpdir(), "application-onboarding-"));
  execFileSync("git", ["init", "--quiet", root], { windowsHide: true });
  writeFileSync(resolve(root, ".gitignore"), ".local/\n*.local.md\n");
  t.after(() => {
    const checked = resolve(root), part = relative(tmpdir(), checked);
    assert.ok(part && !part.startsWith("..") && !isAbsolute(part));
    rmSync(checked, { recursive: true });
  });
  return root;
}

test("application setup requires one to three distinct boards; custom HTTPS boards work", () => {
  assert.throws(() => configureProgress(createProgress(), "manualApplications", [], now));
  assert.throws(() => configureProgress(createProgress(), "bothApplications", [board("a"), board("b"), board("c"), board("d")], now));
  assert.throws(() => configureProgress(createProgress(), "manualApplications", [board(), board()], now));
  const state = configureProgress(createProgress(), "bothApplications", [board("a"), board("b"), board("c")], now);
  assert.equal(state.boards.length, 3); assert.equal(state.steps.boardSelection.status, "complete");
  assert.throws(() => newBoard("Unsafe", "https://candidate:secret@example.test/", "Site Architecture Context/Unsafe"));
  assert.throws(() => newBoard("Unsafe", "https://example.test/", "Site Architecture Context/../../elsewhere"));
});

test("profile-only preparation skips browser, boards and email without claiming application readiness", () => {
  const state = prepared("profileSetup");
  assert.equal(readiness(state).ready, true);
  assert.equal(state.steps.browserTools.status, "skipped");
  assert.match(formatProgress(state), /Scope: Candidate profile only/);
  assert.match(formatProgress(state), /2 of 3 steps complete/);
});

test("manual mode does not need email; both intake sources require selected-inbox verification", () => {
  assert.equal(readiness(prepared()).ready, true);
  const state = prepared("bothApplications");
  state.emailConnection = emptyCheck();
  assert.ok(readiness(state).blockers.some(value => value.includes("inbox")));
});

test("schema-1 migration preserves answers' references, questions and unknown metadata; complete is revalidated", () => {
  const original = { schemaVersion: 1, scope: "emailApplications", phase: "complete", selectedRoles: [{ roleId: "qa" }],
    currentRoleId: "qa", pendingQuestions: [{ id: "specific-question" }], deferredQuestions: [{ condition: "when needed" }],
    contextRevisions: { "private.local.md": "original-hash" }, updatedAt: now, customCheckpoint: { next: "preserve" } };
  const migrated = migrateProgress(original, now);
  assert.equal(migrated.schemaVersion, 3); assert.equal(migrated.phase, "inProgress");
  for (const key of ["selectedRoles", "pendingQuestions", "deferredQuestions", "contextRevisions", "customCheckpoint"] as const) {
    assert.deepEqual(migrated[key], original[key]);
  }
  assert.equal(readiness(migrated).ready, false); assert.deepEqual(original.phase, "complete");
  assert.deepEqual(migrateProgress(migrated, now), migrated);
  assert.throws(() => migrateProgress({ ...original, schemaVersion: 99 }, now));
});

test("reconfiguring preserves matching board knowledge, profiles and questions; new boards remain pending", () => {
  const state = prepared(); state.deferredQuestions = [{ id: "country-specific" }];
  const changed = configureProgress(state, "bothApplications", [board(), board("Second")], now);
  assert.deepEqual(changed.boards[0], state.boards[0]);
  assert.equal(changed.boards[1].access.status, "pending");
  assert.deepEqual(changed.selectedRoles, state.selectedRoles);
  assert.deepEqual(changed.deferredQuestions, state.deferredQuestions);
});

test("a profile-only update preserves previously learned boards and the selected email verification", () => {
  const state = prepared("bothApplications");
  const changed = configureProgress(state, "profileSetup", [], now);
  assert.deepEqual(changed.boards, state.boards);
  assert.deepEqual(changed.emailConnection, state.emailConnection);
  assert.equal(readiness(changed).ready, true);
});

test("a working login alone cannot finish site preparation", () => {
  const state = prepared();
  for (const area of mappingAreas) state.boards[0].mapping[area] = emptyCheck();
  assert.equal(readiness(state).ready, false);
  const view = formatProgress(state);
  assert.match(view, /✓ Access/); assert.match(view, /○ Application entry and destination/);
});

test("top-level progress stays unfinished when new preparation is pending without erasing existing proof", () => {
  const state = prepared();
  for (const id of preparationIds) state.preparation[id] = emptyCheck();
  const previous = structuredClone(state.steps);
  const view = formatProgress(state);
  assert.doesNotMatch(view, /✓ Choose scope|✓ Import CVs|✓ Save preferences|✓ Connect websites/);
  assert.match(view, /→ Import CVs and prepare role-specific documents/);
  assert.deepEqual(state.steps, previous);
  for (const id of preparationIds) state.preparation[id] = done();
  assert.match(formatProgress(state), /✓ Import CVs and prepare role-specific documents/);
});

test("unvisited submit branches need no practice submission; inaccessible forms require an evidenced boundary", () => {
  const state = prepared();
  state.boards[0].mapping.accessibleForms = { ...done(), status: "skipped", reason: "External portal requires an assigned vacancy; boundary recorded in the map." };
  assert.equal(readiness(state).ready, true);
  state.boards[0].mapping.accessibleForms.reason = null;
  assert.equal(readiness(state).ready, false);
  state.boards[0].mapping.accessibleForms.reason = "Boundary recorded";
  state.boards[0].mapping.navigation = { ...done(), status: "skipped", reason: "Unknown" };
  assert.equal(readiness(state).ready, false);
});

test("deferring an optional selected board is explicit partial readiness; all deferred is not ready", () => {
  const state = prepared(); const second = board("Second");
  second.deferred = { reason: "User will connect later", sourceReference: "user-reply-1", recordedAt: now };
  state.boards.push(second);
  assert.deepEqual(readiness(state).deferredBoards, ["Second"]);
  assert.equal(readiness(state).partial, true); assert.equal(readiness(state).ready, true);
  state.boards[0].deferred = second.deferred;
  assert.equal(readiness(state).ready, false);
});

test("completion needs a handoff; unresolved questions or missing check evidence reopen the affected state", () => {
  const state = prepared();
  assert.equal(refreshProgress(state).phase, "inProgress");
  state.steps.readiness = done();
  assert.equal(refreshProgress(state).phase, "complete");
  state.pendingQuestions.push({ id: "required" });
  const waiting = refreshProgress(state);
  assert.equal(waiting.phase, "waitingForUser"); assert.equal(waiting.steps.readiness.status, "pending");
  state.pendingQuestions = []; state.steps.browserTools.evidence = [];
  assert.equal(readiness(state).ready, false);
});

test("atomic migration preserves old bytes on disk until explicitly saved and rejects another writer", t => {
  const root = sandbox(t); mkdirSync(resolve(root, ".local"));
  const old = { schemaVersion: 1, scope: "profileSetup", phase: "complete", selectedRoles: [], currentRoleId: null,
    pendingQuestions: [], deferredQuestions: [], contextRevisions: {}, updatedAt: now };
  const path = resolve(root, ".local/onboarding-state.json");
  writeFileSync(path, JSON.stringify(old)); const previous = readFileSync(path);
  const loaded = loadProgress(root, now);
  assert.equal(loaded.migrated, true); assert.deepEqual(readFileSync(path), previous);
  saveProgress(root, loaded.state, loaded.revision);
  assert.equal(loadProgress(root).migrated, false);
  assert.throws(() => saveProgress(root, loaded.state, loaded.revision), /another session/);
  const fresh = loadProgress(root); assert.equal(saveProgress(root, fresh.state, fresh.revision), false);
});

test("tracked or unignored progress cannot be saved; malformed progress is preserved", t => {
  const root = sandbox(t);
  writeFileSync(resolve(root, ".gitignore"), "");
  assert.throws(() => saveProgress(root, createProgress(), null), /ignored/);
  const path = resolve(root, ".local/onboarding-state.json");
  writeFileSync(path, "{unreadable");
  assert.throws(() => loadProgress(root)); assert.equal(readFileSync(path, "utf8"), "{unreadable");
  assert.equal(existsSync(resolve(root, "Job Context")), false);
});

test("changed or missing canonical context invalidates readiness without resetting saved profiles", t => {
  const root = sandbox(t);
  const path = resolve(root, "fixture.local.md"); writeFileSync(path, "Synthetic profile");
  const state = prepared("profileSetup");
  state.steps.candidateProfiles = completedCheck(root, ["fixture.local.md"], now);
  state.steps.applicationInstructions = completedCheck(root, ["fixture.local.md"], now);
  assert.equal(inspectReadiness(root, state).ready, true);
  writeFileSync(path, "Synthetic update");
  const inspected = inspectReadiness(root, state);
  assert.equal(inspected.ready, false);
  assert.equal(inspected.state.steps.candidateProfiles.status, "inProgress");
  assert.equal(state.steps.candidateProfiles.status, "complete");
  assert.throws(() => evidenceReference(root, "../outside.md"), /inside/);
});

test("a portable old browser report cannot establish a new machine's browser readiness", t => {
  const root = sandbox(t); writeFileSync(resolve(root, "fixture.local.md"), "Synthetic evidence");
  const state = prepared();
  const actual = completedCheck(root, ["fixture.local.md"], now);
  state.steps.candidateProfiles = actual; state.steps.applicationInstructions = actual; state.steps.browserTools = actual;
  state.boards[0].access = actual;
  for (const area of mappingAreas) state.boards[0].mapping[area] = actual;
  assert.ok(inspectReadiness(root, state).blockers.some(value => value.includes("verify the CLI")));
});

test("CLI refuses premature completion, reopens stale progress and refreshes an old handoff", t => {
  const root = sandbox(t);
  writeFileSync(join(root, "package.json"), '{"type":"module"}');
  const compiled = resolve(dirname(fileURLToPath(import.meta.url)), "../onboarding");
  const destination = resolve(root, ".local/build/automation/onboarding");
  mkdirSync(destination, { recursive: true });
  cpSync(resolve(compiled, ".."), resolve(root, ".local/build/automation"), { recursive: true });
  const command = (...args: string[]) => spawnSync(process.execPath, [join(destination, "cli.js"), ...args], { cwd: root, encoding: "utf8", windowsHide: true });
  assert.equal(command("start", "--scope", "profileSetup").status, 0);
  let loaded = loadProgress(root);
  loaded.state.selectedRoles = [{ roleId: "synthetic" }];
  saveProgress(root, loaded.state, loaded.revision);
  writeFileSync(join(root, "synthetic.local.md"), "Synthetic candidate context");
  writeFileSync(join(root, "handoff.local.md"), "Synthetic profile-only handoff");
  assert.equal(command("finish", "--reference", "handoff.local.md").status, 1);
  for (const id of ["candidateProfiles", "applicationInstructions"]) assert.equal(command("record", "--step", id, "--reference", "synthetic.local.md").status, 0);
  assert.equal(command("finish", "--reference", "handoff.local.md").status, 0);
  assert.equal(command("check").status, 0);
  writeFileSync(join(root, "synthetic.local.md"), "Changed synthetic context");
  const before = readFileSync(join(root, ".local/onboarding-state.json"));
  const stale = command("check");
  assert.equal(stale.status, 2);
  assert.doesNotMatch(stale.stdout, /Ready for the configured scope/);
  assert.deepEqual(readFileSync(join(root, ".local/onboarding-state.json")), before);
  for (const id of ["candidateProfiles", "applicationInstructions"]) assert.equal(command("record", "--step", id, "--reference", "synthetic.local.md").status, 0);
  writeFileSync(join(root, "handoff.local.md"), "Updated synthetic handoff");
  assert.equal(command("finish", "--reference", "handoff.local.md").status, 0);
  assert.equal(command("check").status, 0);
});
