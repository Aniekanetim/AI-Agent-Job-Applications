import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { resolve } from "node:path";
import { alertFixture, fixtureNow, writeFixture } from "./email-fixture.js";
import { digest, evidenceFile } from "../email/evidence.js";
import { boardWork } from "../workflow/dispatch.js";
import { bindTaskTicket, transitionTask, loadTaskControl } from "../workflow/task-control.js";
import type { ApplicationTask } from "../workflow/application-state.js";
import { adoptPublishingBoard, authorizeContentTool, chooseContentTool, configureBoardMode, createContentTask, observeContentOutcome,
  previewPublishingCutover, runBoardPost, stageBoardDraft, transitionContent } from "../publishing/board-flow.js";
import { contentPath, readContentTicket } from "../publishing/board-tickets.js";
import { boardConfigFile, readBoardConfig, saveSharedPublishingCheck } from "../publishing/board-config.js";
import { historyMatch } from "../publishing/history.js";
import { queuePost, readBoardPost, saveDraft, savePublishingPreferences, skipPost } from "../publishing/store.js";
import { publish } from "../publishing/worker.js";

const account = { profileUrl: "https://www.linkedin.com/in/synthetic/", audience: "Anyone" as const,
  storageState: ".auth/synthetic.json", routeReference: "synthetic-route" };
const profile = { voice: "Clear", audience: "Peers", rules: "Synthetic scope only.", mediaPreferences: "Use supplied media.",
  topics: ["Testing"], facts: [{ id: "testing", text: "I use synthetic fixtures." }] };
const draft = { text: "Synthetic post on testing", topic: "Testing", facts: ["testing"] };
const content = { source: "agent" as const, sourceReference: "synthetic-task", angle: "Fixtures", draft };
const now = "2026-11-08T12:00:00.000Z";
const receipt = { reference: "synthetic-confirmation", observedAt: now,
  url: "https://www.linkedin.com/feed/update/urn:li:activity:12345/" };
const prepared = () => ({ recheck: async () => {}, click: async () => {}, confirm: async () => receipt, close: async () => {} });

function setContentProfile(root: string) {
  fs.appendFileSync(resolve(root, ".gitignore"), "\n**/*.local.md\n");
  writeFixture(root, "Content Creation Context/profile.local.md", `# Synthetic\n\x60\x60\x60json\n${JSON.stringify(profile)}\n\x60\x60\x60\n`);
}

function setup(t: Parameters<typeof alertFixture>[0]) {
  const { root } = alertFixture(t, 1);
  setContentProfile(root);
  configureBoardMode(root, "autonomous", "synthetic-autonomy", account);
  return root;
}

function legacyDraft(root: string) {
  savePublishingPreferences(root, { account, profile: { voice: profile.voice, topics: profile.topics, facts: profile.facts }, sourceReference: "synthetic-legacy" });
  return saveDraft(root, draft, now);
}

test("one board routes applications and prepared content while leaving parked tickets alone", async t => {
  const root = setup(t);
  writeFixture(root, "Task Board/To Do/APP-synthetic.md", "Synthetic application");
  const application = writeFixture(root, "Task Board/To Do/Content-Moderator.md", "Synthetic application for a content moderator");
  const misfiled = createContentTask(root, { ...content, topic: draft.topic, sourceReference: "synthetic-misfiled" });
  fs.renameSync(resolve(root, misfiled.path), resolve(root, "Task Board/To Do", misfiled.path.split("/").at(-1)!));
  writeFixture(root, "Task Board/Blocked/CONTENT-parked.md", "Private parked content");
  const entry = createContentTask(root, { ...content, topic: draft.topic });
  const id = readContentTicket(root, entry.path).ticket.id;
  assert.equal(boardWork(root).content[0].ready, false);
  stageBoardDraft(root, { ...content, id }, now);
  const plan = boardWork(root);
  assert.deepEqual(plan.applications.map(item => item.name), ["APP-synthetic.md", "Content-Moderator.md"]);
  const bound = bindTaskTicket(root, { taskId: "CONTENT-Moderator", originalIntake: "To Do", checkpoint: "working" }, application.path);
  assert.deepEqual(bound.ticket, application);
  assert.equal(plan.content.length, 1);
  assert.equal(plan.content[0].ready, true);
  assert.equal((await runBoardPost(root, id, undefined, async () => prepared(), () => now)).action, "published");
  assert.equal(boardWork(root).content.length, 0);
  assert.equal(readBoardPost(root, id), null);
  assert.equal(readContentTicket(root, `Task Board/Applied/CONTENT-${id}.md`).ticket.receipt?.url, receipt.url);
  assert.ok(historyMatch(root, account.profileUrl, draft.text, draft.topic, "Fixtures").exact);
  assert.throws(() => stageBoardDraft(root, { ...content, sourceReference: "other", angle: "Another angle" }, now), /fresh text/);
});

test("verified content dependencies reroute the same ticket and partial replies keep it parked", t => {
  const root = setup(t), entry = stageBoardDraft(root, content, now);
  const proof = writeFixture(root, ".local/user-reply.txt", "Synthetic selected answer");
  const blocked = transitionContent(root, { path: entry.path, expected: entry.sha256, action: "block", authority: proof, dependencies: ["media", "voice"] });
  const id = readContentTicket(root, blocked.path).ticket.id;
  const report = (ids: string[]) => writeFixture(root, ".local/content-resolution.json", JSON.stringify({
    taskId: `CONTENT-${id}`, ticketSha256: blocked.sha256, dependencies: ids.map(id => ({ id, evidence: proof })),
  }));
  assert.throws(() => transitionContent(root, { path: blocked.path, expected: blocked.sha256, action: "unblock", authority: report(["media"]) }), /every content/);
  assert.equal(boardWork(root).content.length, 0);
  const resumed = transitionContent(root, { path: blocked.path, expected: blocked.sha256, action: "unblock", authority: report(["media", "voice"]) });
  assert.equal(resumed.path, contentPath(id));
  const deferred = transitionContent(root, { path: resumed.path, expected: resumed.sha256, action: "defer", authority: proof });
  assert.equal(boardWork(root).content.length, 0);
  assert.equal(transitionContent(root, { path: deferred.path, expected: deferred.sha256, action: "resume", authority: proof }).path, resumed.path);
});

test("a verified application resolution requeues the selected ticket through task control", t => {
  const { root } = alertFixture(t, 1), path = "Task Board/Blocked/APP-selected.md";
  const ticket = writeFixture(root, path, "Synthetic selected application");
  const evidence = writeFixture(root, ".local/answer.txt", "Synthetic supplied fact");
  const task: ApplicationTask = { taskId: "APP-selected", checkpoint: "working", originalIntake: "To Do",
    blocker: { reason: "Synthetic", lastCompletedStep: "Draft", contextPath: evidence.path, nextAction: "Verify answer",
      resumeCheckpoint: "Draft", resolvedAt: fixtureNow, resolutionEvidence: evidence.path, dependencyIds: ["one", "two"] } };
  const report = (ids: string[]) => writeFixture(root, ".local/resolution.json", JSON.stringify({
    taskId: task.taskId, ticketSha256: ticket.sha256, resolvedAt: fixtureNow, dependencies: ids.map(id => ({ id, evidence })),
  }));
  const input = { root, task, path, action: "unblock" as const, actor: "synthetic-agent", reason: "Verified all dependencies", observedAt: fixtureNow };
  assert.throws(() => transitionTask({ ...input, authority: report(["one"]) }), /all dependencies/);
  const result = transitionTask({ ...input, authority: report(["one", "two"]) });
  assert.equal(result.kind, "moved");
  assert.equal(loadTaskControl(root, task.taskId).data?.path, "Task Board/To Do/APP-selected.md");
});

test("the fallback tool claims the same draft once and records a confirmed outcome", t => {
  const root = setup(t), staged = stageBoardDraft(root, content, now);
  const id = readContentTicket(root, staged.path).ticket.id;
  const evidence = writeFixture(root, ".local/publishing/evidence/tool.json", JSON.stringify({
    tool: "host-browser", account: account.profileUrl, audience: account.audience,
    draftSha256: digest(JSON.stringify(draft)), controlsVerified: true,
  }));
  assert.deepEqual(chooseContentTool(root, "playwright", [
    { id: "playwright", status: "unavailable", actions: [] },
    { id: "host-browser", status: "verified", actions: ["publish"], evidence },
  ], "publish"), { action: "useTool", tool: "host-browser" });
  const attempt = authorizeContentTool(root, { id, tool: "host-browser", evidence }, now);
  assert.throws(() => authorizeContentTool(root, { id, tool: "host-browser", evidence }, now), /saved outcome/);
  const outcome = { path: staged.path, attemptId: attempt.attemptId, status: "published" as const, receipt };
  assert.throws(() => observeContentOutcome(root, { ...outcome, evidence }), /separate LinkedIn outcome/);
  const report = { attemptId: attempt.attemptId, profileUrl: account.profileUrl, draftSha256: digest(JSON.stringify(draft)), status: "published", receipt };
  const wrappedPreparation = writeFixture(root, ".local/publishing/evidence/wrapped-preparation.json",
    { ...report, observation: { kind: "linkedinConfirmation", evidence } });
  assert.throws(() => observeContentOutcome(root, { ...outcome, evidence: wrappedPreparation }), /separate LinkedIn outcome/);
  const observation = writeFixture(root, ".local/publishing/evidence/confirmed.txt", "Synthetic observed LinkedIn confirmation");
  const mismatched = writeFixture(root, ".local/publishing/evidence/mismatch.json",
    { ...report, draftSha256: "a".repeat(64), observation: { kind: "linkedinConfirmation", evidence: observation } });
  assert.throws(() => observeContentOutcome(root, { ...outcome, evidence: mismatched }), /separate LinkedIn outcome/);
  assert.equal(readBoardPost(root, id)?.status, "attempted");
  const confirmed = writeFixture(root, ".local/publishing/evidence/outcome.json",
    { ...report, observation: { kind: "matchingPublishedPost", evidence: observation } });
  const result = observeContentOutcome(root, { ...outcome, evidence: confirmed });
  assert.equal(result.action, "published");
});

test("legacy cutover imports unfinished posts as Deferred and fences the old publishing callback", async t => {
  const { root } = alertFixture(t, 1);
  const legacy = legacyDraft(root);
  assert.equal(adoptPublishingBoard(root, "synthetic-cutover").imported, 1);
  assert.ok(fs.existsSync(resolve(root, `Task Board/Deferred/CONTENT-${legacy.id}.md`)));
  assert.equal(readBoardPost(root, legacy.id)?.id, legacy.id);
  assert.equal((await publish(root, { kind: "scheduled", scheduleReference: "old-timer" })).action, "idle");
  assert.equal(adoptPublishingBoard(root, "synthetic-cutover").imported, 1);
  assert.equal(evidenceFile(root, `Task Board/Deferred/CONTENT-${legacy.id}.md`).path.endsWith(legacy.id + ".md"), true);
});

test("interrupted cutover stays off and resumes even from an older premature adoption marker", async t => {
  const { root } = alertFixture(t, 1), legacy = legacyDraft(root);
  setContentProfile(root);
  const deferred = resolve(root, "Task Board/Deferred");
  fs.writeFileSync(deferred, "Synthetic conflicting destination");
  assert.throws(() => adoptPublishingBoard(root, "synthetic-cutover"));
  assert.equal(previewPublishingCutover(root).adopted, false);
  assert.equal(boardWork(root).contentMode, "off");
  assert.throws(() => configureBoardMode(root, "autonomous", "synthetic-enable"), /adopt the old publishing queue/);
  assert.equal((await publish(root, { kind: "manual", postId: legacy.id, sourceReference: "synthetic-legacy" })).action, "idle");
  const { legacyRevision: _revision, ...partial } = readBoardConfig(root).data!;
  writeFixture(root, boardConfigFile, { ...partial, adopted: true });
  assert.equal(previewPublishingCutover(root).adopted, false);
  assert.throws(() => configureBoardMode(root, "autonomous", "synthetic-enable"), /adopt the old publishing queue/);
  fs.unlinkSync(deferred);
  assert.equal(adoptPublishingBoard(root, "synthetic-cutover").imported, 1);
  assert.equal(previewPublishingCutover(root).adopted, true);
  assert.equal(readBoardPost(root, legacy.id)?.status, "draft");
  assert.equal(configureBoardMode(root, "autonomous", "synthetic-enable").mode, "autonomous");
});

test("a legacy skipped post can be prepared again after explicitly resuming its ticket", t => {
  const { root } = alertFixture(t, 1), legacy = legacyDraft(root);
  setContentProfile(root);
  queuePost(root, legacy.id, "2026-11-09T12:00:00.000Z", false, now);
  skipPost(root, legacy.id);
  adoptPublishingBoard(root, "synthetic-cutover");
  configureBoardMode(root, "autonomous", "synthetic-enable");
  const path = `Task Board/Deferred/CONTENT-${legacy.id}.md`, { file } = readContentTicket(root, path);
  const authority = writeFixture(root, ".local/resume-legacy.txt", "Synthetic explicit request to resume the post");
  assert.throws(() => stageBoardDraft(root, { ...content, id: legacy.id }, now), /Return this existing ticket/);
  const resumed = transitionContent(root, { path, expected: file.sha256, action: "resume", authority });
  const prepared = stageBoardDraft(root, { ...content, id: legacy.id }, now);
  assert.equal(prepared.path, resumed.path);
  assert.equal(readContentTicket(root, prepared.path).ticket.source, "legacy");
  assert.equal(readContentTicket(root, prepared.path).ticket.ready, true);
  assert.equal(readBoardPost(root, legacy.id)?.status, "draft");
  assert.equal(readBoardPost(root, legacy.id)?.slot, null);
});

test("a prepared content ticket uses the verified shared check-in without a publishing slot", async t => {
  const root = setup(t), entry = stageBoardDraft(root, content, now);
  const id = readContentTicket(root, entry.path).ticket.id;
  const scheduleReference = "shared-native-check-in";
  writeFixture(root, ".local/operation-preferences.json", JSON.stringify({ schemaVersion: 1, mode: "recurring", cadence: "Hourly",
    timezone: "Africa/Lagos", perRunLimit: null, perDayLimit: null, reporting: "summary", sourceReference: "actual-synthetic", scheduleReference }));
  await assert.rejects(runBoardPost(root, id, scheduleReference, async () => prepared(), () => now), /actual shared schedule/);
  const synthetic = writeFixture(root, ".local/publishing/evidence/synthetic.json", JSON.stringify({ synthetic: true, verified: ["text", "image", "video"], checkedAt: now }));
  const report = writeFixture(root, ".local/publishing/evidence/scheduled.json", JSON.stringify({
    workingRoot: root, executionContext: "scheduled", scheduleReference, runReference: "synthetic-check-in-run",
    profileUrl: account.profileUrl, accountRevision: digest(JSON.stringify(account)), checkedAt: now, composerOpened: true, synthetic,
  }));
  saveSharedPublishingCheck(root, report, scheduleReference, account);
  assert.equal(readBoardPost(root, id)?.slot, null);
  assert.equal((await runBoardPost(root, id, scheduleReference, async () => prepared(), () => now)).action, "published");
});
