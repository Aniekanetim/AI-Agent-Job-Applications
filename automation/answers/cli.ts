import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readConversationInput, type ResponseBundle } from "../onboarding/conversation.js";
import { readPrivateJson, savePrivateJson } from "../workflow/private-json.js";
import { lookupApplicationAnswer, prepareReusableResponse, type AnswerRequest, type ReusableChange } from "./workflow.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const [command = "help", flag, path] = process.argv.slice(2);

try {
  if (command === "help") {
    console.log("Reusable application answers\n  resolve --file .local/REQUEST.json\n  prepare --file .local/REPLY.json\nUse the focused reply or attention reply command to commit the prepared response.");
  } else {
    if (flag !== "--file" || !path) throw new Error("Supply an agent-managed private input file with --file.");
    const input = readConversationInput(root, path);
    if (command === "resolve") {
      console.log(JSON.stringify(lookupApplicationAnswer(root, input as AnswerRequest), null, 2));
    } else if (command === "prepare") {
      const { response, changes } = input as { response: ResponseBundle; changes: ReusableChange[] };
      if (!/^[a-zA-Z0-9_-]{1,100}$/.test(response?.id ?? "")) throw new Error("Provide the actual response's stable ID.");
      const bundle = prepareReusableResponse(root, response, changes);
      const output = `.local/answer-proposals/${response.id}.json`;
      const previous = readPrivateJson(root, output);
      if (previous.data === null) savePrivateJson(root, output, bundle, null);
      else if (JSON.stringify(previous.data) !== JSON.stringify(bundle)) throw new Error("Recover or reconcile the already prepared response.");
      console.log(JSON.stringify({ proposalPath: output, answers: bundle.answers.length }, null, 2));
    } else throw new Error("Choose resolve or prepare. Run answers -- help for usage.");
  }
} catch (error) {
  const message = error instanceof Error && !(error instanceof SyntaxError) && !/^(ENOENT|EACCES|EPERM|Command failed)/.test(error.message)
    ? error.message : "Reconcile the private reusable-answer input or file.";
  console.error(message);
  process.exitCode = 1;
}
