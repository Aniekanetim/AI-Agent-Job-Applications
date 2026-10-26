import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadProgress } from "./state-store.js";
import { queueQuestions, nextQuestion, recordQuestionPresented, setConversationMode, deferQuestion, recordRoadmapShown,
  applyResponse, readConversationInput, conversationSummary, clarifyQuestion, recoverUnshownQuestion, reconcileStagedResponse, type ResponseBundle } from "./conversation.js";
import type { FocusedQuestion } from "./conversation-types.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const args = process.argv.slice(2), command = args.shift() ?? "status";
function value(flag: string) { const i = args.indexOf(flag); if (i < 0 || !args[i + 1] || args[i + 1].startsWith("--")) throw new Error(`Supply ${flag} with a nonsecret reference or private proposal path.`); return args[i + 1]; }
const now = new Date().toISOString();
try {
  if (command === "help") console.log(`Agent-managed focused onboarding:
  status                         Show brief current stage/focus without writing
  queue --file .local/FILE        Register focused question metadata, never answers
  next                           Select one question; unchanged presented questions return wait
  next --repeat-on-request       Re-present only when the user requests repetition/resumption
  asked --id ID --source REF      Record the actual user-visible prompt
  not-shown --id ID --source REF  Record actual non-presentation before retrying the same prompt
  clarify --file .local/FILE      Save one focused clarification with its actual response source
  reply --file .local/FILE        Save every clear answer in one response, then its references
  recover                        Finish the retained interrupted response before asking again
  reconcile --file FILE --source REF   Rebase an actual conflicting file while preserving the reply
  pause --source REF             Pause onboarding under the user's instruction
  resume --source REF            Resume its existing checkpoint; does not start a schedule
  defer --id ID --source REF      Defer an optional question only
  roadmap-shown                  Record that the applicable roadmap was actually shown
Use private files for response proposals; never put answers or secrets in command arguments.
The agent interprets natural language and preserves unrelated canonical content in each proposal.
These helpers enforce one active question and save integrity; they do not send messages or infer missing facts.`);
  else {
    let state = loadProgress(root).state;
    if (command === "queue") {
      const input = readConversationInput(root, value("--file"));
      if (!Array.isArray(input)) throw new Error("Queue input must be a list of focused decision questions.");
      state = queueQuestions(root, input as Omit<FocusedQuestion, "status" | "askedAt">[]);
    } else if (command === "next") {
      const result = nextQuestion(root, args.includes("--repeat-on-request")); state = result.state;
      console.log(JSON.stringify(result.next, null, 2));
    } else if (command === "asked") state = recordQuestionPresented(root, value("--id"), value("--source"), now);
    else if (command === "not-shown") state = recoverUnshownQuestion(root, value("--id"), value("--source"), now);
    else if (command === "clarify") {
      const input = readConversationInput(root, value("--file")) as { id: string; prompt: string; sourceReference: string };
      state = clarifyQuestion(root, input.id, input.prompt, input.sourceReference, now);
    }
    else if (command === "reply") state = applyResponse(root, readConversationInput(root, value("--file")) as ResponseBundle);
    else if (command === "reconcile") {
      reconcileStagedResponse(root, readConversationInput(root, value("--file")) as ResponseBundle, value("--source"));
      state = loadProgress(root).state;
    }
    else if (command === "recover") state = applyResponse(root);
    else if (command === "pause" || command === "resume") state = setConversationMode(root, command === "pause" ? "paused" : "active", value("--source"), now);
    else if (command === "defer") state = deferQuestion(root, value("--id"), value("--source"));
    else if (command === "roadmap-shown") state = recordRoadmapShown(root);
    else if (command !== "status") throw new Error("Unknown focused-onboarding command; use help.");
    console.log(conversationSummary(state));
  }
} catch (error) {
  const message = error instanceof Error && !(error instanceof SyntaxError) && !/^(ENOENT|EACCES|EPERM|Command failed)/.test(error.message) ? error.message : "The private proposal or saved checkpoint needs investigation.";
  console.error(`${message}\nPreserve the proposal and checkpoint; reconcile the affected binding or save before retrying.`);
  process.exitCode = 1;
}
