import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readPrivateJson } from "../workflow/private-json.js";
import { disablePublishing, enablePublishing, publishingBrief, publishingPath, queuePost, reconcilePost, saveDraft,
  savePublishingPreferences, showDraft, skipPost } from "./store.js";
import { publish } from "./worker.js";
import { publishingRehearsal } from "./rehearsal.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const args = process.argv.slice(2), command = args.shift() ?? "brief";
const value = (flag: string) => {
  const found = args[args.indexOf(flag) + 1];
  if (!args.includes(flag) || !found || found.startsWith("--")) throw new Error(`Supply ${flag}.`);
  return found;
};
const now = new Date().toISOString();

function readRequest() {
  const path = value("--file");
  if (!/^\.local\/publishing\/requests\/[a-zA-Z0-9_-][a-zA-Z0-9_.-]*\.json$/.test(path)) throw new Error("Use an agent-managed private publishing proposal.");
  publishingPath(root, path);
  const request = readPrivateJson(root, path).data;
  if (!request || typeof request !== "object" || Array.isArray(request)) throw new Error("Use a publishing proposal object.");
  return request;
}

async function run() {
  if (command === "brief") return publishingBrief(root, now);
  if (command === "preview") return showDraft(root, value("--id"));
  if (command === "skip") return skipPost(root, value("--id"));
  if (command === "disable") return disablePublishing(root, value("--source"));
  if (command === "publish-now") return publish(root, { kind: "manual", postId: value("--id"), sourceReference: value("--source") });
  if (command === "tick") return publish(root, { kind: "scheduled", scheduleReference: value("--schedule") });
  if (command === "rehearse") return publishingRehearsal(root,
    args.includes("--schedule") ? { reference: value("--schedule"), runReference: value("--scheduled-run") } : undefined);
  const request = readRequest();
  if (command === "configure") return savePublishingPreferences(root, request as Parameters<typeof savePublishingPreferences>[1]);
  if (command === "draft") {
    const p = request as { draft: Parameters<typeof saveDraft>[1]; id?: string };
    return saveDraft(root, p.draft, now, p.id);
  }
  if (command === "queue") {
    const p = request as { id: string; at: string; recurring: boolean };
    return queuePost(root, p.id, p.at, p.recurring, now);
  }
  if (command === "pilot") {
    const p = request as { id: string; sourceReference: string };
    if (typeof p.sourceReference !== "string" || !p.sourceReference.trim()) throw new Error("Reference the actual authorization for the selected pilot post.");
    return publish(root, { kind: "manual", postId: p.id, sourceReference: p.sourceReference, pilot: true });
  }
  if (command === "enable") {
    const p = request as { formats: Parameters<typeof enablePublishing>[1]; scheduled: boolean; sourceReference: string };
    return enablePublishing(root, p.formats, p.scheduled, p.sourceReference);
  }
  if (command === "reconcile") {
    const p = request as { id: string; attemptId: string; status: Parameters<typeof reconcilePost>[3];
      receipt: Parameters<typeof reconcilePost>[4]; evidence: Parameters<typeof reconcilePost>[5] };
    return reconcilePost(root, p.id, p.attemptId, p.status, p.receipt, p.evidence);
  }
  throw new Error("Choose a documented publishing action.");
}

try {
  if (command === "help") console.log(`LinkedIn publishing
  brief | preview --id ID | skip --id ID
  configure | draft | queue | pilot | enable | reconcile   use --file .local/publishing/requests/FILE.json
  rehearse [--schedule REF --scheduled-run REF]  run the loopback rehearsal and optionally check the scheduled composer
  publish-now --id ID --source REF | tick --schedule REF | disable --source REF
See automation/publishing/README.md for the saved permissions, schedule and private proposal shapes.`);
  else console.log(JSON.stringify(await run(), null, 2));
} catch (error) {
  console.error(error instanceof Error && !(error instanceof SyntaxError) && !/^(?:ENOENT|EACCES|EPERM|Command failed|browserType\.|browser\.|page\.|locator\.)/.test(error.message)
    ? error.message : "The private publishing context or browser needs attention.");
  process.exitCode = 1;
}
