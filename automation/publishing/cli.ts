import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readPrivateJson } from "../workflow/private-json.js";
import { disablePublishing, enablePublishing, publishingBrief, publishingPath, queuePost, reconcilePost, saveDraft,
  savePublishingPreferences, showDraft, skipPost } from "./store.js";
import { publish } from "./worker.js";
import { publishingRehearsal } from "./rehearsal.js";
import { adoptPublishingBoard, authorizeContentTool, chooseContentTool, configureBoardMode, contentBrief, contentHistory, createContentTask,
  observeContentOutcome, previewPublishingCutover, recoverBoardPublication, runBoardPost, stageBoardDraft, transitionContent } from "./board-flow.js";
import { readBoardConfig } from "./board-config.js";
import { readBoardPost } from "./store.js";
import { sharedPublishingRehearsal } from "./rehearsal.js";

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
  if (command === "board-brief") return contentBrief(root);
  if (command === "board-cutover-preview") return previewPublishingCutover(root);
  if (command === "board-preview") return readBoardPost(root, value("--id"));
  if (command === "board-recover") return recoverBoardPublication(root, value("--id"));
  if (command === "board-work") {
    const schedule = args.includes("--schedule") ? value("--schedule") : undefined;
    if (!schedule) value("--source");
    return runBoardPost(root, value("--id"), schedule);
  }
  if (command === "board-rehearse") return sharedPublishingRehearsal(root, value("--schedule"), value("--scheduled-run"));
  if (command === "disable" && readBoardConfig(root).data) return configureBoardMode(root, "off", value("--source"));
  if (readBoardConfig(root).data && ["configure", "draft", "queue", "skip", "pilot", "enable", "publish-now", "reconcile", "rehearse"].includes(command)) {
    throw new Error("Use the Task Board publishing workflow.");
  }
  if (command === "brief") return publishingBrief(root, now);
  if (command === "preview") return showDraft(root, value("--id"));
  if (command === "skip") return skipPost(root, value("--id"));
  if (command === "disable") return disablePublishing(root, value("--source"));
  if (command === "publish-now") return publish(root, { kind: "manual", postId: value("--id"), sourceReference: value("--source") });
  if (command === "tick") return publish(root, { kind: "scheduled", scheduleReference: value("--schedule") });
  if (command === "rehearse") return publishingRehearsal(root,
    args.includes("--schedule") ? { reference: value("--schedule"), runReference: value("--scheduled-run") } : undefined);
  const request = readRequest();
  if (command === "board-history") return contentHistory(root, request as Parameters<typeof contentHistory>[1]);
  if (command === "board-configure") {
    const p = request as { mode: Parameters<typeof configureBoardMode>[1]; sourceReference: string; account?: Parameters<typeof configureBoardMode>[3] };
    return configureBoardMode(root, p.mode, p.sourceReference, p.account);
  }
  if (command === "board-create") return createContentTask(root, request as Parameters<typeof createContentTask>[1]);
  if (command === "board-draft") return stageBoardDraft(root, request as Parameters<typeof stageBoardDraft>[1], now);
  if (command === "board-transition") return transitionContent(root, request as Parameters<typeof transitionContent>[1]);
  if (command === "board-observe") return observeContentOutcome(root, request as Parameters<typeof observeContentOutcome>[1]);
  if (command === "board-authorize-tool") return authorizeContentTool(root, request as Parameters<typeof authorizeContentTool>[1]);
  if (command === "board-tool") {
    const p = request as { preferred: string; tools: Parameters<typeof chooseContentTool>[2]; action: string };
    return chooseContentTool(root, p.preferred, p.tools, p.action);
  }
  if (command === "board-adopt") {
    const p = request as { sourceReference: string; stoppedTimer?: Parameters<typeof adoptPublishingBoard>[2] };
    return adoptPublishingBoard(root, p.sourceReference, p.stoppedTimer);
  }
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
  if (command === "help") console.log(`Task Board publishing
  board-brief | board-cutover-preview | board-preview --id ID | board-recover --id ID
  board-configure | board-create | board-draft | board-transition | board-adopt | board-history   use --file .local/publishing/requests/FILE.json
  board-tool | board-authorize-tool | board-observe   use --file .local/publishing/requests/FILE.json
  board-work --id ID (--schedule REF or --source REF) | board-rehearse --schedule REF --scheduled-run REF | disable --source REF
See Content Creation Workflow for the guarded commands and shared check-in.`);
  else console.log(JSON.stringify(await run(), null, 2));
} catch (error) {
  console.error(error instanceof Error && !(error instanceof SyntaxError) && !/^(?:ENOENT|EACCES|EPERM|Command failed|browserType\.|browser\.|page\.|locator\.)/.test(error.message)
    ? error.message : "The private publishing context or browser needs attention.");
  process.exitCode = 1;
}
