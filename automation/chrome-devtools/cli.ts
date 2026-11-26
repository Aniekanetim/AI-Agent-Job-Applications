import { realpathSync } from "node:fs";
import { bridgeStatus, cliCall, invokeTool, observePage, startCli, useMcp } from "./bridge.js";
import { documentObservationScript, observeWebMcpAction, prepareWebMcpAction, saveInventory,
  type Context, type Observation, type Request } from "./webmcp.js";
import { siteFile } from "../sites/files.js";
import { readPrivateJson } from "../workflow/private-json.js";

const root = realpathSync(process.cwd());
const [command = "help", flag, file] = process.argv.slice(2);
try {
  let result: unknown;
  if (command === "help") result = {
    commands: ["status", "document-script", "cli-start --file .local/proposal.json", "inventory --file .local/proposal.json",
      "invoke --file .local/proposal.json", "observe --file .local/proposal.json"],
    note: "Run from the repository root. WebMCP is optional. See automation/chrome-devtools/README.md.",
  };
  else if (command === "status") result = bridgeStatus(root);
  else if (command === "document-script") result = { function: documentObservationScript };
  else {
    if (flag !== "--file" || !file?.startsWith(".local/")) throw new Error("Supply the private proposal under .local with --file.");
    siteFile(root, file);
    const data = readPrivateJson(root, file).data;
    if (!data || typeof data !== "object") throw new Error("Supply the actual job and Chrome observations.");
    if (command === "cli-start") result = await startCli(root, (data as { target: Context }).target);
    else if (command === "observe") {
      const input = data as { actionId: string; result: Parameters<typeof observeWebMcpAction>[2];
        evidence: Parameters<typeof observeWebMcpAction>[3]; confirmed?: Parameters<typeof observeWebMcpAction>[4] };
      result = observeWebMcpAction(root, input.actionId, input.result, input.evidence, input.confirmed);
    } else if (command === "inventory" || command === "invoke") {
      const { target, observation, request } = data as { target: Context; observation?: Observation; request?: Request };
      if (!target || command === "invoke" && !request) throw new Error("Supply the actual target and selected action.");
      if (target.method === "native") {
        if (!observation || JSON.stringify(observation.target) !== JSON.stringify(target)) throw new Error("Supply the current native observation for this target.");
        result = command === "inventory" ? saveInventory(root, observation) : {
          ...prepareWebMcpAction(root, observation, request!), next: "Call the matching native tool once, then verify its effect.",
        };
      } else {
        const run = async (call: Parameters<typeof observePage>[0]) => {
          const current = await observePage(call, target);
          if (command === "inventory") return saveInventory(root, current);
          const action = prepareWebMcpAction(root, current, request!);
          return { actionId: action.actionId, invocation: await invokeTool(call, { pageId: action.pageId, toolName: action.toolName },
            request!.input, request!.purpose === "inspect"),
            next: "Inspect the actual state, then record the independent observation." };
        };
        if (target.method === "mcp") result = await useMcp(root, target, run);
        else if (target.method === "cli") result = await run(cliCall(root, target));
        else throw new Error("Choose an observed native, MCP or CLI connection.");
      }
    } else throw new Error("Unknown WebMCP command. Run npm run webmcp -- help.");
  }
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  // Only surface errors from local validation. Third-party error text can contain private form values.
  console.error(error instanceof SyntaxError || error instanceof TypeError || !(error instanceof Error) ||
    "code" in error ? "WebMCP preparation could not be verified. Inspect the saved application checkpoint." : error.message);
  process.exitCode = 1;
}
