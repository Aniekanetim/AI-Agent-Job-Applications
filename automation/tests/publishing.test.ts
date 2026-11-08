import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { digest, evidenceFile } from "../email/evidence.js";
import { chooseSetting, completeSetupChange, openSettings, saveSettingsReply } from "../settings/menu.js";
import { nextSlots, type Schedule } from "../publishing/schedule.js";
import { accountProbe, disablePublishing, enablePublishing, publishingBrief, publishingFile, queuePost, reconcilePost, recordScheduledCheck,
  saveDraft, savePublishingPreferences, showDraft, skipPost, type Draft } from "../publishing/store.js";
import { publish } from "../publishing/worker.js";

const before = "2026-11-08T08:00:00.000Z", at = "2026-11-10T08:00:00.000Z", during = "2026-11-10T08:00:15.000Z";
const scheduleReference = "synthetic-publisher";
const recurring: Schedule = { kind: "weekly", everyWeeks: 1, anchor: "2026-11-08", slots: [{ day: 2, time: "09:00" }, { day: 4, time: "09:00" }] };
const draft: Draft = { topic: "Test design", text: "What I learned from a synthetic test fixture.", facts: ["qa"] };
const pilot = (postId: string) => ({ kind: "manual" as const, postId, sourceReference: "synthetic-pilot-request", pilot: true as const });
const receipt = { reference: "synthetic-confirmation", observedAt: during, url: "https://www.linkedin.com/feed/update/urn:li:activity:12345/" };

function fixture(t: TestContext) {
  const root = mkdtempSync(resolve(tmpdir(), "linkedin-publishing-test-"));
  execFileSync("git", ["init", "--quiet", root], { windowsHide: true });
  writeFileSync(resolve(root, ".gitignore"), ".local/\n.auth/\nTask Board/\n");
  function write(path: string, value: unknown) {
    const name = resolve(root, path);
    mkdirSync(dirname(name), { recursive: true });
    writeFileSync(name, Buffer.isBuffer(value) || typeof value === "string" ? value : JSON.stringify(value));
    return evidenceFile(root, path);
  }
  t.after(() => {
    const part = relative(tmpdir(), root);
    assert.ok(part && !part.startsWith("..") && !isAbsolute(part));
    rmSync(root, { recursive: true });
  });
  return { root, write };
}

function configure(root: string) {
  return savePublishingPreferences(root, { sourceReference: "synthetic-settings", timezone: "Africa/Lagos", schedule: recurring, scheduleReference,
    account: { profileUrl: "https://www.linkedin.com/in/synthetic/", audience: "Anyone", storageState: ".auth/synthetic.json", routeReference: "synthetic-authorized-route" },
    profile: { voice: "Plain", topics: ["Test design"], facts: [{ id: "qa", text: "I use synthetic fixtures." }] } });
}

const synthetic = (onClick = async () => {}) => async () => ({
  recheck: async () => {}, click: onClick, confirm: async () => receipt, close: async () => {},
});

test("weekly, biweekly, monthly and DST slots use the selected local calendar", () => {
  assert.deepEqual(nextSlots(recurring, "Africa/Lagos", before), [at, "2026-11-12T08:00:00.000Z", "2026-11-17T08:00:00.000Z"]);
  assert.deepEqual(nextSlots({ ...recurring, everyWeeks: 2 }, "Africa/Lagos", at, 2), ["2026-11-12T08:00:00.000Z", "2026-11-24T08:00:00.000Z"]);
  assert.deepEqual(nextSlots({ kind: "monthly", day: 31, time: "09:00" }, "UTC", before, 2), ["2026-12-31T09:00:00.000Z", "2027-01-31T09:00:00.000Z"]);
  assert.equal(nextSlots({ kind: "monthly", day: "last", time: "09:00" }, "UTC", before, 1)[0], "2026-11-30T09:00:00.000Z");
  const dst: Schedule = { kind: "weekly", everyWeeks: 1, anchor: "2026-03-01", slots: [{ day: 0, time: "02:30" }] };
  assert.equal(nextSlots(dst, "America/New_York", "2026-03-08T05:00:00.000Z", 1)[0], "2026-03-15T06:30:00.000Z");
  assert.equal(nextSlots({ ...dst, slots: [{ day: 0, time: "01:30" }] }, "America/New_York", "2026-11-01T04:00:00.000Z", 1)[0], "2026-11-01T05:30:00.000Z");
  assert.throws(() => nextSlots(recurring, "Unknown/Zone", before), /time zone/);
});

test("disabled or corrupt publishing state leaves existing menu and application settings usable", async t => {
  const { root, write } = fixture(t);
  assert.deepEqual(await publish(root, { kind: "scheduled", scheduleReference }, synthetic(), () => before), { action: "idle" });
  assert.equal(existsSync(resolve(root, publishingFile)), false);
  const operationPath = ".local/operation-preferences.json";
  const original = write(operationPath, { schemaVersion: 1, mode: "onDemand", cadence: null, timezone: "Africa/Lagos",
    perRunLimit: null, perDayLimit: null, reporting: "summary", sourceReference: "existing", scheduleReference: null });
  write(publishingFile, "{invalid");
  assert.equal(openSettings(root).options[6].id, "close");
  assert.equal(chooseSetting(root, "5").options[0].id, "check-in");
  chooseSetting(root, "back");
  chooseSetting(root, "8");
  assert.equal(chooseSetting(root, "linkedin-publishing").current?.status, "unavailable");
  assert.equal(chooseSetting(root, "back").phase, "area");
  assert.equal(chooseSetting(root, "close").phase, "closed");
  assert.equal(digest(readFileSync(resolve(root, operationPath))), original.sha256);
  assert.equal(readFileSync(resolve(root, publishingFile), "utf8"), "{invalid");
});

test("publishing settings use the dedicated save and leave the focused answer journal alone", t => {
  const { root } = fixture(t);
  openSettings(root);
  chooseSetting(root, "publishing");
  chooseSetting(root, "linkedin-publishing");
  assert.throws(() => saveSettingsReply(root, ".local/irrelevant.json"), /dedicated publishing/);
  assert.equal(existsSync(resolve(root, ".local/onboarding-pending-response.json")), false);
  configure(root);
  assert.equal(completeSetupChange(root, "synthetic-save").notice, "Change saved.");
});

test("the selected post binds its public facts, private asset revision and attribution", async t => {
  const { root, write } = fixture(t);
  configure(root);
  assert.throws(() => saveDraft(root, { ...draft, facts: ["private"] }, before), /public-profile/);
  const path = ".local/publishing/media/synthetic.png";
  const media = { ...write(path, Buffer.from("89504e470d0a1a0a0000", "hex")), kind: "image" as const,
    origin: "online" as const, rightsReference: "synthetic-license", url: "https://example.invalid/image", credit: "Photo credit" };
  assert.throws(() => saveDraft(root, { ...draft, media }, before), /attribution/);
  const post = saveDraft(root, { ...draft, text: draft.text + "\nPhoto credit", media }, before);
  write(path, Buffer.from("89504e470d0a1a0a1111", "hex"));
  let browserOpened = false;
  const result = await publish(root, pilot(post.id), async () => { browserOpened = true; return synthetic()(); }, () => during);
  assert.equal(result.action, "composerNeedsAttention");
  assert.equal(browserOpened, false);
  assert.equal(showDraft(root, post.id).status, "draft");
});

test("parallel attempts send once and an interrupted click stays unresolved until verified", async t => {
  const { root, write } = fixture(t);
  configure(root);
  const post = saveDraft(root, draft, before);
  let release!: () => void, started!: () => void, clicks = 0;
  const waiting = new Promise<void>(done => { release = done; });
  const entered = new Promise<void>(done => { started = done; });
  const first = publish(root, pilot(post.id), async () => {
    started();
    await waiting;
    return synthetic(async () => { clicks++; throw new Error("Synthetic browser interrupted after handoff"); })();
  }, () => during);
  await entered;
  assert.equal((await publish(root, pilot(post.id), synthetic(), () => during)).action, "busy");
  release();
  const result = await first;
  assert.equal(result.action, "verifyAttempt");
  assert.equal(clicks, 1);
  await assert.rejects(publish(root, pilot(post.id), synthetic(), () => during), /original publishing attempt/);
  const evidence = write(".local/publishing/evidence/synthetic-review.txt", "Observed no post for the original attempt.");
  const attempt = showDraft(root, post.id).attempts[0];
  reconcilePost(root, post.id, attempt.id, "notPublished", { reference: receipt.reference, observedAt: receipt.observedAt }, evidence);
  assert.equal((await publish(root, pilot(post.id), synthetic(async () => { clicks++; }), () => during)).action, "published");
  assert.equal(clicks, 2);
  assert.equal(showDraft(root, post.id).attempts.length, 2);
});

test("pause, skip and schedule changes are rechecked before the browser click", async t => {
  const { root } = fixture(t);
  configure(root);
  const post = saveDraft(root, draft, before);
  queuePost(root, post.id, at, true, before);
  skipPost(root, post.id);
  assert.equal(showDraft(root, post.id).status, "skipped");
  queuePost(root, post.id, at, true, before);
  let clicks = 0;
  const run = await publish(root, pilot(post.id), async () => {
    savePublishingPreferences(root, { paused: true, sourceReference: "synthetic-pause" });
    return synthetic(async () => { clicks++; })();
  }, () => during);
  assert.equal(run.action, "changedBeforeClick");
  assert.equal(clicks, 0);
  assert.equal(showDraft(root, post.id).attempts.length, 0);
  savePublishingPreferences(root, { timezone: "UTC", paused: false, sourceReference: "synthetic-reschedule" });
  assert.equal(publishingBrief(root, during).posts[0].reschedule, true);
  disablePublishing(root, "synthetic-stop");
  assert.equal(showDraft(root, post.id).status, "queued");
});

test("timed publishing requires a confirmed pilot and matching scheduled evidence, and a missed slot stays queued", async t => {
  const { root, write } = fixture(t);
  configure(root);
  const first = saveDraft(root, draft, before);
  assert.throws(() => enablePublishing(root, ["text"], false, "synthetic-opt-in"), /pilot/);
  assert.equal((await publish(root, pilot(first.id), synthetic(), () => during)).action, "published");
  assert.throws(() => enablePublishing(root, ["image"], false, "synthetic-opt-in"), /pilot/);
  assert.throws(() => enablePublishing(root, ["text"], true, "synthetic-opt-in"), /scheduled LinkedIn browser/);
  const syntheticRehearsal = write(".local/publishing/evidence/synthetic-rehearsal.json",
    { synthetic: true, verified: ["text", "image", "video"], checkedAt: during });
  const report = write(".local/publishing/evidence/synthetic-scheduled.json", { executionContext: "scheduled", workingRoot: root,
    checkedAt: during, composerOpened: true, scheduleReference, scheduleRunReference: "synthetic-run",
    revision: accountProbe(root).revision, syntheticRehearsal });
  recordScheduledCheck(root, report);
  enablePublishing(root, ["text"], true, "synthetic-opt-in");
  const second = saveDraft(root, { ...draft, text: "Another synthetic post." }, before);
  queuePost(root, second.id, at, true, before);
  assert.equal((await publish(root, { kind: "scheduled", scheduleReference: "another-timer" }, synthetic(), () => during)).action, "idle");
  assert.equal((await publish(root, { kind: "scheduled", scheduleReference }, synthetic(), () => "2026-11-10T08:01:00.000Z")).action, "idle");
  assert.equal(publishingBrief(root, "2026-11-10T08:01:00.000Z").posts[1].missed, true);
  assert.equal((await publish(root, { kind: "scheduled", scheduleReference }, synthetic(), () => during)).action, "published");
});
