import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, existsSync, mkdirSync, symlinkSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import { ensureSite, loadSites, prepareSitePassword, matchesSite } from "../sites/registry.js";
import { siteEvidence, siteFile } from "../sites/files.js";
import { assertSiteAction, bindTaskSite } from "../sites/execution.js";
import { pauseForSiteAccess, reportSiteAccess, resolveSiteAccess } from "../sites/access-handoff.js";
import { markSubmissionAttempted, canMarkApplied, assertTaskMove, type ApplicationTask } from "../workflow/application-state.js";
import { decideBrowser, saveUploadHandoff } from "../browser/fallback.js";
import { selectBrowser } from "../browser/preferences.js";
import { siteBox, readySite, siteNow } from "./sites-fixture.js";
import { openSettings, chooseSetting, saveSettingsReply } from "../settings/menu.js";
import { loadProgress } from "../onboarding/state-store.js";
import { newBoard } from "../onboarding/progress.js";

const task = (): ApplicationTask => ({ taskId: "APP-synthetic-website", originalIntake: "To Do", checkpoint: "working", browserExecution: { defaultBrowser: "playwright", activeBrowser: "playwright", requiresFileUpload: null, handoffs: [] } });
test("saved primary identity automatically adopts canonical folders and keeps reusable learned maps/methods", t => {
  const { root, write } = siteBox(t), progress = loadProgress(root).state;
  progress.boards = [newBoard("Existing", "https://primary.example.invalid", "Site Architecture Context/Existing")];
  write(".local/onboarding-state.json", progress);
  const observation = write(".local/observation.json", "Synthetic observed primary identity");
  mkdirSync(resolve(root, "Site Architecture Context/Existing/playwright"), { recursive: true });
  writeFileSync(resolve(root, "Site Architecture Context/Existing/architecture.md"), "Reusable observed journey: KEEP");
  writeFileSync(resolve(root, "Site Architecture Context/Existing/playwright/pages.ts"), "export const observed = true;");
  const r = ensureSite(root, { kind: "board", label: "Display label changes", url: "https://primary.example.invalid/jobs/1", observation });
  if (r.action !== "prepared") throw new Error();
  assert.equal(r.site.accessPath, "Job Context/Job Boards/Existing/access-and-instructions.local.md");
  assert.equal(r.site.architecturePath, "Site Architecture Context/Existing/architecture.local.md");
  assert.match(readFileSync(resolve(root, r.site.architecturePath), "utf8"), /Reusable base knowledge/);
  assert.equal(existsSync(resolve(root, "Site Architecture Context/Existing/playwright/pages.local.ts")), false);
});
test("encountered fourth/fifth boards stay outside the primary-board limit and never rewrite onboarding", t => {
  const { root, write } = siteBox(t), onboarding = write(".local/onboarding-state.json", loadProgress(root).state);
  for (let i = 1; i <= 5; i++) {
    const url = `https://board${i}.example.invalid/jobs/123`, proof = write(`.local/board${i}.json`, { url });
    assert.equal(ensureSite(root, { kind: "board", label: `Board ${i}`, url, observation: proof }).action, "prepared");
  }
  assert.equal(loadSites(root).state.sites.length, 5); assert.deepEqual(siteEvidence(root, onboarding.path), onboarding);
  assert.equal(loadProgress(root).state.boards.length, 0);
});
test("tracking and identity-provider observations do not become boards or credential scopes", t => {
  const { root, write } = siteBox(t), observation = write(".local/redirect.json", "Synthetic tracking redirect");
  for (const kind of ["tracker", "identityProvider"] as const) assert.equal(ensureSite(root, { kind, url: "https://tracking.example.invalid/click?job=1", label: "Redirect", observation }).action, "followDestination");
  assert.equal(loadSites(root).state.sites.length, 0);
});
test("shared ATS tenants and direct employer applications have distinct account context", t => {
  const { root, write } = siteBox(t), observation = write(".local/source.json", "Synthetic site identities");
  const make = (url: string, scopePath?: string) => ensureSite(root, { kind: "direct", label: "Employer", url, scopePath, observation });
  assert.throws(() => make("https://boards.greenhouse.io/Acme/jobs/1"), /tenant/);
  const a = make("https://boards.greenhouse.io/Acme/jobs/1", "/Acme"), b = make("https://boards.greenhouse.io/Other/jobs/1", "/Other");
  assert.equal(a.action, "prepared"); assert.equal(b.action, "prepared"); if (a.action !== "prepared" || b.action !== "prepared") return;
  assert.notEqual(a.site.id, b.site.id); assert.notEqual(a.site.accessPath, b.site.accessPath);
  assert.equal(matchesSite(a.site, "https://boards.greenhouse.io/Acme2/jobs/1"), false);
  assert.deepEqual(a.site.parents, []); assert.match(a.site.accessPath, /^Job Context\/Application destinations\//);
});
test("the same verified destination reuses canonical knowledge across source boards", t => {
  const { root, write } = siteBox(t), observation = write(".local/source.json", "Synthetic observed source and destination");
  const board = (n: string) => ensureSite(root, { kind: "board", label: n, url: `https://${n}.example.invalid`, observation });
  const a = board("first"), b = board("second"); if (a.action !== "prepared" || b.action !== "prepared") throw new Error();
  const d = ensureSite(root, { kind: "destination", label: "Employer", url: "https://careers.example.invalid/jobs/1", parentSiteId: a.site.id, observation });
  if (d.action !== "prepared") throw new Error();
  assert.match(d.site.architecturePath, /Application destinations/);
  const again = ensureSite(root, { kind: "destination", label: "Changed label", url: "https://careers.example.invalid/jobs/2", parentSiteId: b.site.id, observation });
  if (again.action !== "prepared") throw new Error();
  assert.equal(d.site.architecturePath, again.site.architecturePath); assert.equal(again.site.parents.length, 2);
  assert.throws(() => ensureSite(root, { kind: "destination", label: "Unknown", url: "https://unknown.example.invalid", observation }));
});
test("partial creation repairs only missing files; repeated preparation preserves learned data, sessions and credentials", t => {
  const { root, write } = siteBox(t), observation = write(".local/source.json", "Synthetic partial repair");
  const context = { accessPath: "Job Context/Job Boards/Existing/access-and-instructions.local.md", architecturePath: "Site Architecture Context/Existing/architecture.local.md" };
  write(context.architecturePath, "Observed map: KEEP");
  const request = { kind: "board" as const, label: "Existing", url: "https://existing.example.invalid", observation, context };
  const first = ensureSite(root, request); if (first.action !== "prepared") throw new Error();
  const env = prepareSitePassword(root, first.site.id); write(env.path, "PASSWORD=SYNTHETIC_DO_NOT_DISPLAY");
  const method = `${first.site.methodDirectory}/playwright/pages.local.ts`; write(method, "export const learned = true;");
  const before = [context.architecturePath, env.path, method, ".local/site-registry.json"].map(p => siteEvidence(root, p));
  ensureSite(root, request);
  before.forEach(p => assert.deepEqual(siteEvidence(root, p.path), p));
  assert.equal(readFileSync(resolve(root, context.architecturePath), "utf8"), "Observed map: KEEP");
  assert.throws(() => ensureSite(root, { ...request, url: "https://different.example.invalid" }), /tenant contexts/);
});
test("concurrent preparations converge to one registry entry without lost sites", async t => {
  const { root, write } = siteBox(t), observation = write(".local/source.json", "Synthetic concurrent preparation");
  // Use the URL relative to this module to work on Windows paths containing spaces.
  const entry = new URL("../sites/registry.js", import.meta.url).href;
  const script = `import {ensureSite} from ${JSON.stringify(entry)}; const [root,raw]=process.argv.slice(1); ensureSite(root,JSON.parse(raw));`;
  const run = promisify(execFile);
  await Promise.all([1, 1, 2, 3].map(i => run(process.execPath, ["--input-type=module", "-e", script, root, JSON.stringify({ kind: "board", label: `Board${i}`, url: `https://board${i}.example.invalid`, observation })], { windowsHide: true })));
  assert.equal(loadSites(root).state.sites.length, 3);
});
test("runtime paths reject traversal, tracked files and escaping junctions, including missing descendants", t => {
  const { root, write } = siteBox(t), outside = siteBox(t);
  for (const p of ["../escape.local.md", "C:/escape.local.md", ".local/a/../b", ".local/name.", ".local/a\\b"]) assert.throws(() => siteFile(root, p));
  writeFileSync(resolve(root, "tracked.local.md"), "Synthetic tracked"); execFileSync("git", ["-C", root, "add", "-f", "tracked.local.md"], { windowsHide: true });
  assert.throws(() => siteFile(root, "tracked.local.md"), /untracked/);
  mkdirSync(resolve(root, ".local"), { recursive: true }); symlinkSync(outside.root, resolve(root, ".local/escape"), "junction");
  assert.throws(() => siteFile(root, ".local/escape/missing/child.local.md"), /outside/);
});
test("anonymous context creates no credentials and remains unusable until actual access is bound", t => {
  const { root, write } = siteBox(t), observation = write(".local/source.json", "Synthetic anonymous observation");
  const result = ensureSite(root, { kind: "board", label: "Public", url: "https://public.example.invalid/jobs/1", observation }); if (result.action !== "prepared") throw new Error();
  const page = { url: "https://public.example.invalid/jobs/1", browser: "playwright" as const, sessionReference: "synthetic-session" };
  const bound = bindTaskSite(root, task(), result.site.id, page);
  assert.equal(existsSync(resolve(root, result.site.accessPath.replace(/access-and-instructions.local.md$/, ".env"))), false);
  assert.throws(() => assertSiteAction(root, bound, page, "upload"));
  assert.equal(loadSites(root).state.sites[0].id, result.site.id);
});
test("sensitive operations reject wrong site/session, missing or changed evidence and changed access instructions", t => {
  const f = readySite(t, { ...task(), selectedRoleId: "qa", cvVersion: "v1", cvSha256: "a".repeat(64), checkpoint: "prepared" });
  assert.equal(markSubmissionAttempted(f.task, f.root, f.page).checkpoint, "submissionAttempted");
  assert.throws(() => markSubmissionAttempted(f.task));
  for (const page of [{ ...f.page, sessionReference: "wrong" }, { ...f.page, url: "https://other.example.invalid" }, { ...f.page, url: f.page.url.replace("synthetic-qa", "other-job") }, { ...f.page, browser: "inApp" as const }]) assert.throws(() => assertSiteAction(f.root, f.task, page, "upload"));
  assert.throws(() => assertSiteAction(f.root, f.task, f.page, "credentials"));
  f.write(f.site.accessPath, "New user instruction; recheck actual access");
  assert.throws(() => markSubmissionAttempted(f.task, f.root, f.page), /changed/);
});
test("redirect and browser transitions lose prior access; selected CV and history remain intact", t => {
  const f = readySite(t, { ...task(), selectedRoleId: "qa", cvVersion: "v1", cvSha256: "a".repeat(64) });
  const dest = ensureSite(f.root, { kind: "destination", parentSiteId: f.site.id, label: "New employer", url: "https://new.example.invalid", observation: f.write(".local/destination.json", "Synthetic redirect") });
  if (dest.action !== "prepared") throw new Error();
  const next = bindTaskSite(f.root, f.task, dest.site.id, { ...f.page, url: "https://new.example.invalid" });
  assert.equal(next.siteExecution!.access, undefined); assert.equal(next.siteHistory!.length, 1); assert.equal(next.cvSha256, f.task.cvSha256);
  assert.throws(() => bindTaskSite(f.root, { ...f.task, checkpoint: "submissionAttempted" }, dest.site.id, { ...f.page, url: "https://new.example.invalid" }));
});
test("pre-profile challenge blocks either intake without fabricated role/CV; readiness and context creation cannot clear it", t => {
  const f = readySite(t, task()), observation = { id: "early-challenge", siteId: f.site.id, ...f.page, challenge: "Synthetic security verification", detectedAt: siteNow,
    evidence: f.write(".local/challenge.json", "Synthetic challenge, no actual CAPTCHA"), checkpointReference: ".local/checkpoint.json", sessionAccess: "visible" as const };
  for (const originalIntake of ["Email Alerts", "To Do"] as const) {
    const paused = pauseForSiteAccess(f.root, { ...f.task, originalIntake }, observation);
    assert.equal(paused.selectedRoleId, undefined); assert.equal(paused.cvSha256, undefined); assert.equal(paused.siteExecution!.access, undefined);
    assert.doesNotThrow(() => assertTaskMove(paused, originalIntake, "Blocked"));
    assert.equal(canMarkApplied({ ...paused, checkpoint: "confirmed", selectedRoleId: "qa", cvVersion: "v1", cvSha256: "a".repeat(64), confirmation: { reference: "forged", observedAt: siteNow } }), false);
    assert.throws(() => markSubmissionAttempted({ ...paused, checkpoint: "prepared" }, f.root, f.page));
    assert.throws(() => saveUploadHandoff(paused, f.page.url, "checkpoint", siteNow));
    assert.equal(decideBrowser(paused, selectBrowser("playwright", "synthetic", siteNow), { inApp: true, playwright: true }, false).action, "blocked");
    const reported = reportSiteAccess(paused, observation.id, "synthetic-request"); assert.equal(reportSiteAccess(reported, observation.id, "another"), reported);
    const clear = { ...f.page, id: observation.id, taskId: paused.taskId, siteId: f.site.id, observedAt: siteNow, evidence: f.write(".local/clear.json", "Synthetic same-session clearance observation"), humanReference: "synthetic-human", challengeCleared: true, sameVacancyVerified: true, sessionVerified: true, outcome: "notSubmitted" as const };
    assert.throws(() => resolveSiteAccess(f.root, paused, { ...clear, challengeCleared: false }));
    assert.throws(() => resolveSiteAccess(f.root, paused, { ...clear, outcome: "unknown" }));
    assert.throws(() => resolveSiteAccess(f.root, paused, { ...clear, sessionReference: "other" }));
    const recovered = resolveSiteAccess(f.root, paused, { ...clear, sessionReference: "recovered", recovery: { fromSessionReference: f.page.sessionReference, evidence: f.write(".local/recovery.json", "Synthetic accessible browser recovery and same unsubmitted vacancy checked") } });
    assert.equal(recovered.siteExecution!.sessionReference, "recovered"); assert.equal(recovered.siteExecution!.access, undefined); assert.equal(recovered.accessHandoffs![0].sessionReference, f.page.sessionReference);
    const resumed = resolveSiteAccess(f.root, paused, clear); assert.doesNotThrow(() => assertTaskMove(resumed, "Blocked", "To Do"));
    assert.equal(resumed.checkpoint, "working"); assert.equal(resumed.siteExecution!.access, undefined);
  }
});
test("Settings and focused replies edit encountered employer access without adding primary boards or clearing a blocker", t => {
  const f = readySite(t, task()); f.write(".local/onboarding-state.json", loadProgress(f.root).state);
  const before = siteEvidence(f.root, ".local/onboarding-state.json"), taskProof = f.write(".local/blocked-task.json", { blocker: "Unchanged observed challenge" });
  openSettings(f.root); chooseSetting(f.root, "connections");
  const edit = chooseSetting(f.root, "site-access"); assert.equal(edit.current!.path, f.site.accessPath);
  f.write(".local/reply.json", { schemaVersion: 1, id: "site-answer", sourceReference: "synthetic-user-reply", observedAt: siteNow,
    answers: [{ decision: { id: "site-login", field: "account", step: "connections", substep: "employer access", roleId: null, contextPath: f.site.accessPath }, kind: "answer" }],
    writes: [{ path: f.site.accessPath, expectedSha256: siteEvidence(f.root, f.site.accessPath).sha256, content: "Use the authorized existing employer session; never copy a source-board password.\n" }], references: [] });
  saveSettingsReply(f.root, ".local/reply.json");
  assert.match(readFileSync(resolve(f.root, f.site.accessPath), "utf8"), /existing employer session/);
  assert.equal(loadProgress(f.root).state.boards.length, 0); assert.deepEqual(siteEvidence(f.root, taskProof.path), taskProof);
  chooseSetting(f.root, "close");
  assert.equal(loadSites(f.root).state.sites.length, 1);
});
test("reconciliation does not alter legacy Applied evidence, active tasks, email associations or sessions", t => {
  const { root, write } = siteBox(t), paths = [".local/legacy-applied.json", ".local/inbox-state.json", ".local/session.json", ".local/blocked.json"];
  const refs = paths.map(p => write(p, { synthetic: p, checkpoint: "preserve" }));
  const r = ensureSite(root, { kind: "board", label: "Newly registered", url: "https://old-observation.example.invalid", observation: refs[3] }); assert.equal(r.action, "prepared");
  refs.forEach(e => assert.deepEqual(siteEvidence(root, e.path), e));
  assert.equal(canMarkApplied({ taskId: "legacy", originalIntake: "Email Alerts", selectedRoleId: "qa", cvVersion: "v1", cvSha256: "a".repeat(64), checkpoint: "confirmed", confirmation: { reference: "legacy-receipt", observedAt: siteNow } }), true);
  const publicChanges = execFileSync("git", ["-C", root, "ls-files", "--others", "--exclude-standard"], { encoding: "utf8", windowsHide: true }); assert.equal(publicChanges.trim(), ".gitignore");
});
