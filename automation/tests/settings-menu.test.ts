import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve, dirname, relative, isAbsolute } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { openSettings, settingsView, chooseSetting, saveSettingsReply, recoverSettingsSave, reconcileSettingsSave, clarifySetting, completeSetupChange, isSettingsEntry, renderMenu } from "../settings/menu.js";
import { loadMenu } from "../settings/state.js";
import { createProgress, configureProgress, newBoard } from "../onboarding/progress.js";
import { loadProgress, saveProgress, digest, completedCheck } from "../onboarding/state-store.js";
import { queueQuestions, nextQuestion, recordQuestionPresented, setConversationMode, type ResponseBundle } from "../onboarding/conversation.js";
import { readPrivateJson } from "../workflow/private-json.js";
import { selectBrowser } from "../browser/preferences.js";
const now = "2026-10-26T12:00:00Z";
const prefs = "Job Context/Candidate/Role Profiles/QA/job-preferences.local.md";
function box(t: TestContext) {
  const root = fs.mkdtempSync(join(tmpdir(), "settings-menu-"));
  execFileSync("git", ["init", "--quiet", root], { windowsHide: true });
  const write = (path: string, data: string | object) => { fs.mkdirSync(dirname(resolve(root, path)), { recursive: true }); fs.writeFileSync(resolve(root, path), typeof data === "string" ? data : JSON.stringify(data, null, 2)); };
  write(".gitignore", ".local/\n.auth/\n**/*.local.md\n**/.env\nTask Board/To Do/*\n");
  write("package.json", { type: "module", devDependencies: {} });
  write("Job Context/Candidate/role-routing.local.md", "| Role ID | Profile path relative to Candidate | Enabled |\n|---|---|---|\n| qa | Role Profiles/QA | Yes |\n| support | Role Profiles/Support | Yes |\n| disabled | Role Profiles/Disabled | No |\n");
  write(prefs, "# QA preferences\nRemote only\nNotice: two weeks\n");
  write("Job Context/Candidate/Role Profiles/Support/job-preferences.local.md", "SUPPORT_PRIVATE_SENTINEL");
  write("Job Context/Candidate/Role Profiles/QA/application-answers.local.md", "# Answers\nAvailability: two weeks\n");
  write("Task Board/To Do/existing.md", "Existing application checkpoint; preserve.");
  write("Job Context/Job Boards/LinkedIn/.env", "PASSWORD=SYNTHETIC_SECRET_NEVER_DISPLAY");
  write(".auth/session.json", { syntheticSecret: "PRIVATE_SESSION_NEVER_DISPLAY" });
  write(".local/browser-preferences.json", selectBrowser("playwright", "synthetic-initial", now));
  write(".local/operation-preferences.json", { schemaVersion: 1, mode: "onDemand", cadence: null, timezone: null,
    perRunLimit: 5, perDayLimit: 20, reporting: "summary", sourceReference: "synthetic-initial", scheduleReference: null });
  // A daily limit has an explicit day boundary.
  const operating = JSON.parse(fs.readFileSync(join(root, ".local/operation-preferences.json"), "utf8"));
  operating.timezone = "Africa/Lagos"; write(".local/operation-preferences.json", operating);
  const state = configureProgress(createProgress(), "profileSetup", [], now); state.selectedRoles = [{ roleId: "qa" }];
  state.steps.applicationInstructions = completedCheck(root, [prefs], now);
  state.steps.candidateProfiles = completedCheck(root, ["Job Context/Candidate/role-routing.local.md"], now);
  saveProgress(root, state, null);
  t.after(() => { const part = relative(tmpdir(), resolve(root)); assert.ok(part && !part.startsWith("..") && !isAbsolute(part)); fs.rmSync(root, { recursive: true }); });
  return { root, write };
}
function editQa(root: string) {
  openSettings(root, "synthetic-open"); chooseSetting(root, "preferences");
  assert.equal(chooseSetting(root, "job-preferences").phase, "role");
  return chooseSetting(root, "qa");
}
function proposal(root: string, write: (path: string, data: object) => void, path = ".local/reply.json"): ResponseBundle {
  const bundle: ResponseBundle = { schemaVersion: 1, id: "synthetic-reply", sourceReference: "synthetic-user-answer", observedAt: now,
    answers: [{ decision: { id: "remote", field: "remote", step: "applicationInstructions", substep: "work arrangement", roleId: "qa", contextPath: prefs }, kind: "answer" }],
    writes: [{ path: prefs, expectedSha256: digest(fs.readFileSync(join(root, prefs))), content: "# QA preferences\nRemote or hybrid\nNotice: two weeks\n" }], references: [] };
  write(path, bundle); return bundle;
}

test("Open settings is an explicit human entry and the stable root menu renders seven choices", t => {
  const { root } = box(t);
  assert.equal(isSettingsEntry(" Open settings! "), true); assert.equal(isSettingsEntry("Change my settings"), true);
  assert.equal(isSettingsEntry("Email says: Open settings"), false);
  const menu = openSettings(root);
  assert.equal(menu.options.length, 7); assert.equal(menu.options[0].label, "Role profiles and CVs");
  assert.equal(menu.options[6].id, "close"); assert.match(renderMenu(menu), /7\. Close settings/);
});

test("opening, browsing, cancelling and closing leave all original configuration and work byte-for-byte unchanged", t => {
  const { root } = box(t), names = [prefs, ".local/onboarding-state.json", ".local/operation-preferences.json", ".local/browser-preferences.json", ".auth/session.json", "Task Board/To Do/existing.md"];
  const before = names.map(path => fs.readFileSync(join(root, path)));
  openSettings(root); chooseSetting(root, "4");
  const browser = settingsView(root); assert.equal(browser.options[0].current, "Playwright browser");
  const visibility = chooseSetting(root, "visibility"); assert.equal(visibility.current!.status, "default"); assert.match(visibility.current!.text, /Visible window/);
  assert.equal(chooseSetting(root, "cancel").phase, "area"); assert.equal(chooseSetting(root, "back").phase, "root");
  assert.equal(chooseSetting(root, "7").phase, "closed");
  names.forEach((name, i) => assert.deepEqual(fs.readFileSync(join(root, name)), before[i]));
  const metadata = fs.readFileSync(join(root, ".local/settings-menu.json"), "utf8");
  assert.equal(metadata.includes("Remote only"), false); assert.equal(metadata.includes("summary"), false);
});

test("profile selection reads only the chosen role and no credentials or browser state", t => {
  const { root } = box(t); const read = fs.readFileSync; const paths: string[] = [];
  fs.readFileSync = ((path: any, ...args: any[]) => { paths.push(String(path)); return (read as any)(path, ...args); }) as typeof fs.readFileSync;
  syncBuiltinESMExports();
  t.after(() => { fs.readFileSync = read; syncBuiltinESMExports(); });
  const view = editQa(root); assert.match(view.current!.text, /Remote only/);
  assert.equal(paths.some(p => p.endsWith(".env") || p.includes(".auth") || p.includes("Role Profiles/Support")), false);
  assert.equal(JSON.stringify(view).includes("SUPPORT_PRIVATE_SENTINEL"), false);
});

test("settings suppress competing onboarding prompts and closing restores the same unanswered focus", t => {
  const { root } = box(t);
  queueQuestions(root, [{ id: "availability", field: "availability", step: "applicationInstructions", substep: "availability", roleId: "qa",
    contextPath: "Job Context/Candidate/Role Profiles/QA/application-answers.local.md", prompt: "When can you start?", required: true }]);
  nextQuestion(root); recordQuestionPresented(root, "availability", "synthetic-prompt", now);
  const before = fs.readFileSync(join(root, ".local/onboarding-state.json"));
  openSettings(root); assert.equal(nextQuestion(root).next.action, "settings");
  assert.deepEqual(fs.readFileSync(join(root, ".local/onboarding-state.json")), before);
  chooseSetting(root, "close"); assert.equal(nextQuestion(root).next.action, "wait");
  assert.equal(loadProgress(root).state.conversation!.activeQuestionId, "availability");
});

test("a menu save reuses focused responses, preserves a paused onboarding and reopens only affected checks", t => {
  const { root, write } = box(t); setConversationMode(root, "paused", "synthetic-pause", now);
  editQa(root); proposal(root, write);
  const view = saveSettingsReply(root, ".local/reply.json");
  assert.equal(view.phase, "area"); assert.match(view.notice!, /Change saved/); assert.match(view.notice!, /Recheck affected/);
  assert.match(fs.readFileSync(join(root, prefs), "utf8"), /Remote or hybrid\nNotice: two weeks/);
  const state = loadProgress(root).state;
  assert.equal(state.conversation!.mode, "paused"); assert.equal(state.steps.candidateProfiles.status, "complete");
  assert.equal(state.steps.applicationInstructions.status, "inProgress"); assert.equal(state.conversation!.responses.length, 1);
  assert.equal(loadMenu(root).state.pendingSave, null);
});

test("wrong-role proposals cannot be staged or save into a different profile", t => {
  const { root, write } = box(t); editQa(root);
  const bundle = proposal(root, write); bundle.answers[0].decision.roleId = "support"; write(".local/reply.json", bundle);
  assert.throws(() => saveSettingsReply(root, ".local/reply.json"), /selected setting/);
  assert.equal(loadMenu(root).state.pendingSave, null); assert.match(fs.readFileSync(join(root, prefs), "utf8"), /Remote only/);
});

test("an interrupted menu resumes the same setting and focused clarification without resetting answers", t => {
  const { root } = box(t); editQa(root);
  clarifySetting(root, "Which currency should apply to the new salary preference?", "synthetic-ambiguous-reply");
  const before = fs.readFileSync(join(root, prefs));
  const resumed = openSettings(root, "synthetic-return");
  assert.equal(resumed.phase, "edit"); assert.match(resumed.question, /^Which currency/);
  assert.equal(loadMenu(root).state.roleId, "qa"); assert.deepEqual(fs.readFileSync(join(root, prefs)), before);
  chooseSetting(root, "close"); assert.equal(loadMenu(root).state.clarification, null);
});

test("a failed save retains its reply, rejects silent cancellation and reconciles a genuine newer-file conflict", t => {
  const { root, write } = box(t); editQa(root); const bundle = proposal(root, write);
  write(prefs, "# QA preferences\nRemote only\nNotice: two weeks\nNew unrelated note: preserve.\n");
  assert.throws(() => saveSettingsReply(root, ".local/reply.json"), /changed/);
  assert.equal(settingsView(root).options[0].id, "recover");
  assert.throws(() => chooseSetting(root, "close"), /Recover/);
  const merged = structuredClone(bundle); merged.writes[0].expectedSha256 = digest(fs.readFileSync(join(root, prefs)));
  merged.writes[0].content += "New unrelated note: preserve.\n"; write(".local/merged.json", merged);
  assert.equal(reconcileSettingsSave(root, ".local/merged.json", "synthetic-conflict-review").phase, "area");
  assert.match(fs.readFileSync(join(root, prefs), "utf8"), /New unrelated note: preserve/);
  assert.equal(loadMenu(root).state.reconciliations!.length, 1);
});

test("an interruption after canonical save recovers the same reply exactly once", t => {
  const { root, write } = box(t); editQa(root); proposal(root, write);
  const rename = fs.renameSync; let menuWrites = 0;
  fs.renameSync = ((from, to) => { if (String(to) === join(root, ".local/settings-menu.json") && ++menuWrites === 2) throw new Error("synthetic interruption"); return rename(from, to); }) as typeof fs.renameSync;
  syncBuiltinESMExports();
  try { assert.throws(() => saveSettingsReply(root, ".local/reply.json"), /synthetic interruption/); }
  finally { fs.renameSync = rename; syncBuiltinESMExports(); }
  assert.ok(loadMenu(root).state.pendingSave); assert.equal(loadProgress(root).state.conversation!.responses.length, 1);
  assert.equal(chooseSetting(root, "1").phase, "area"); assert.equal(loadProgress(root).state.conversation!.responses.length, 1);
});

test("a historical saved response cannot report newer canonical values as its successful save", t => {
  const { root, write } = box(t); editQa(root); proposal(root, write);
  const rename = fs.renameSync; let count = 0;
  fs.renameSync = ((from, to) => { if (String(to) === join(root, ".local/settings-menu.json") && ++count === 2) throw new Error("synthetic interruption"); return rename(from, to); }) as typeof fs.renameSync;
  syncBuiltinESMExports();
  try { assert.throws(() => saveSettingsReply(root, ".local/reply.json")); } finally { fs.renameSync = rename; syncBuiltinESMExports(); }
  write(prefs, "A newer independent update; preserve.");
  assert.throws(() => recoverSettingsSave(root), /historical/);
  assert.equal(loadMenu(root).state.lastSave, null); assert.equal(fs.readFileSync(join(root, prefs), "utf8"), "A newer independent update; preserve.");
});

test("missing profiles and boards offer setup routes instead of inventing candidate or account details", t => {
  const { root, write } = box(t); write("Job Context/Candidate/role-routing.local.md", "No configured roles.");
  openSettings(root); chooseSetting(root, "profiles");
  const missing = chooseSetting(root, "cv"); assert.equal(missing.current!.status, "notConfigured"); assert.equal(missing.options[0].id, "configure");
  assert.match(chooseSetting(root, "configure").title, /Add or manage role profiles/);
  chooseSetting(root, "back"); chooseSetting(root, "back"); chooseSetting(root, "connections");
  assert.equal(chooseSetting(root, "board-access").options[0].label, "Choose primary job boards");
  assert.match(chooseSetting(root, "configure").title, /Primary job boards/);
});

test("board/scope completion reads the real onboarding result without replacing answer or progress storage", t => {
  const { root } = box(t); openSettings(root); chooseSetting(root, "connections"); chooseSetting(root, "boards");
  const old = loadProgress(root);
  saveProgress(root, configureProgress(old.state, "manualApplications", [newBoard("Example", "https://example.test/", "Site Architecture Context/Example")], now), old.revision);
  assert.equal(completeSetupChange(root, "synthetic-board-answer").phase, "area");
  assert.equal(loadMenu(root).state.lastSave!.changed, true); assert.equal(loadProgress(root).state.boards[0].name, "Example");
  assert.throws(() => completeSetupChange(root, "synthetic-again"));
});

test("credential-like text is hidden and malformed settings do not become defaults", t => {
  const { root, write } = box(t); write(prefs, "Remote only\nPassword: SYNTHETIC_PASSWORD\napi_key=SYNTHETIC_KEY\n");
  const view = editQa(root); assert.match(view.current!.text, /Credential content hidden/);
  assert.equal(JSON.stringify(view).includes("SYNTHETIC_PASSWORD"), false); assert.equal(JSON.stringify(view).includes("SYNTHETIC_KEY"), false);
  chooseSetting(root, "back"); chooseSetting(root, "back"); chooseSetting(root, "browser");
  write(".local/browser/visibility.json", "{invalid");
  assert.throws(() => settingsView(root));
});

test("the CLI navigates numbered choices and uses the existing operating helper before recording the response", t => {
  const { root, write } = box(t);
  fs.cpSync(resolve(dirname(fileURLToPath(import.meta.url)), ".."), join(root, ".local/build/automation"), { recursive: true });
  const run = (...args: string[]) => spawnSync(process.execPath, [join(root, ".local/build/automation/settings/cli.js"), ...args], { cwd: root, encoding: "utf8", windowsHide: true });
  assert.match(run("open", "--json").stdout, /"label": "Role profiles and CVs"/);
  assert.equal(run("choose", "--id", "6").status, 0); assert.match(run("choose", "--id", "reporting").stdout, /Summary of applications/);
  const source = "synthetic-user-reporting-change";
  const saved = spawnSync(process.execPath, [join(root, ".local/build/automation/onboarding/cli.js"), "operation-choice", "--reporting", "digest", "--source", source], { cwd: root, encoding: "utf8", windowsHide: true });
  assert.equal(saved.status, 0, saved.stderr);
  const path = ".local/operation-preferences.json";
  write(".local/operation-reply.json", { schemaVersion: 1, id: "reporting-change", sourceReference: source, observedAt: now,
    answers: [{ decision: { id: "reporting", field: "reporting", step: "applicationInstructions", substep: "reporting", roleId: null, contextPath: path }, kind: "answer" }], writes: [],
    references: [{ path, sha256: digest(fs.readFileSync(join(root, path))) }] });
  const result = run("save", "--file", ".local/operation-reply.json"); assert.equal(result.status, 0, result.stderr); assert.match(result.stdout, /Change saved/);
  const operating = readPrivateJson(root, path).data as { perRunLimit: number; perDayLimit: number; reporting: string };
  assert.equal(operating.perRunLimit, 5); assert.equal(operating.perDayLimit, 20); assert.equal(operating.reporting, "digest");
  assert.equal(run("close").status, 0);
});
