import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { documentObservationScript, type Context, type DocumentObservation, type Observation } from "./webmcp.js";

const version = "1.12.0";
const environment = {
  ...Object.fromEntries(Object.entries(process.env).filter(([name]) =>
    /^(PATH|SYSTEMROOT|WINDIR|COMSPEC|TEMP|TMP|USERPROFILE|HOME|LOCALAPPDATA|APPDATA|LANG|DISPLAY|WAYLAND_DISPLAY|XDG_RUNTIME_DIR|XAUTHORITY)$/i.test(name))),
  CHROME_DEVTOOLS_MCP_NO_CONFIG_DISCOVERY: "1",
  CHROME_DEVTOOLS_MCP_NO_USAGE_STATISTICS: "1",
  NO_UPDATE_NOTIFIER: "1",
};
type BrowserMethod = "evaluate_script" | "list_webmcp_tools" | "execute_webmcp_tool" | "new_page" | "list_pages";
type ToolResult = { isError?: boolean; structuredContent?: Record<string, unknown>; content?: { text?: string }[] };
type Call = (name: BrowserMethod, details: Record<string, unknown>) => Promise<ToolResult>;

function tooling(root: string) {
  const require = createRequire(resolve(root, "automation/chrome-devtools/tooling/package.json"));
  try {
    const manifest = require("chrome-devtools-mcp/package.json");
    if (manifest.version !== version) throw new Error();
    return {
      require,
      mcp: require.resolve("chrome-devtools-mcp/build/src/bin/chrome-devtools-mcp.js"),
      cli: require.resolve("chrome-devtools-mcp/build/src/bin/chrome-devtools.js"),
    };
  } catch {
    throw new Error("The optional pinned bridge is unavailable. Use a verified native connection or install the optional tooling.");
  }
}

export function bridgeStatus(root: string) {
  try { tooling(root); return { installed: true, version, operationVerified: false }; }
  catch { return { installed: false, version, operationVerified: false }; }
}

function origin(value: string) {
  const url = new URL(value);
  if (url.username || url.password || /[*{}()\\]/.test(url.hostname) || !["https:", "http:"].includes(url.protocol) ||
    url.protocol === "http:" && url.hostname !== "127.0.0.1") throw new Error("Use the exact registered HTTPS origin or the loopback rehearsal.");
  return url.origin;
}
function endpoint(value: string) {
  const url = new URL(value);
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || !url.port || url.href !== url.origin + "/") {
    throw new Error("Use the authorized dedicated browser's loopback endpoint.");
  }
  return url.origin;
}

export function chromeArguments(root: string, allowedOrigin: string) {
  if (origin(allowedOrigin) !== allowedOrigin) throw new Error("Use an exact site origin.");
  return [
    "--categoryExperimentalWebmcp=true", "--categoryExperimentalThirdParty=false", "--pageIdRouting=true",
    "--categoryNetwork=false", "--categoryPerformance=false", "--categoryMemory=false", "--categoryEmulation=false",
    "--categoryExtensions=false", "--categoryPwa=false", "--fileNavigations=false", "--redactNetworkHeaders=true",
    "--usageStatistics=false", "--performanceCrux=false", "--experimentalStructuredContent=true",
    "--javascriptEvaluation=true", "--workspace", root, "--allowedUrlPattern", allowedOrigin + "/*",
  ];
}

export async function withMcp<T>(root: string, args: string[], action: (call: Call) => Promise<T>): Promise<T> {
  const local = tooling(root);
  const clientUrl = pathToFileURL(local.require.resolve("@modelcontextprotocol/sdk/client/index.js")).href;
  const transportUrl = pathToFileURL(local.require.resolve("@modelcontextprotocol/sdk/client/stdio.js")).href;
  const { Client } = await import(clientUrl);
  const { StdioClientTransport } = await import(transportUrl);
  const client = new Client({ name: "job-applications-webmcp", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath, args: [local.mcp, ...args], cwd: root, env: environment, stderr: "ignore",
  });
  try {
    await client.connect(transport, { timeout: 12_000 });
    return await action(async (name, details) => client.callTool({ name, arguments: details }, undefined, { timeout: 25_000 }));
  } finally { await client.close().catch(() => {}); }
}

export function useMcp<T>(root: string, target: Context, action: (call: Call) => Promise<T>) {
  if (target.method !== "mcp") throw new Error("Use the observed Chrome connection method.");
  return withMcp(root, [...chromeArguments(root, origin(target.page.url)), "--browserUrl", endpoint(target.connection)], action);
}

export function cliConfiguration(root: string, target: Context) {
  if (target.method !== "cli" || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(target.connection)) {
    throw new Error("Use an explicitly established, dedicated job WebMCP CLI session.");
  }
  const local = tooling(root);
  const browserUrl = endpoint(target.browserEndpoint ?? "");
  const args = [...chromeArguments(root, origin(target.page.url)), "--browserUrl", browserUrl];
  return { command: process.execPath, args: [local.cli, "start", "--sessionId", target.connection, ...args] };
}

export async function startCli(root: string, target: Context) {
  const config = cliConfiguration(root, target);
  process.env.CHROME_DEVTOOLS_MCP_NO_CONFIG_DISCOVERY = "1";
  process.env.CHROME_DEVTOOLS_MCP_NO_USAGE_STATISTICS = "1";
  const entry = tooling(root).require.resolve("chrome-devtools-mcp/build/src/daemon/client.js");
  const { startDaemon } = await import(pathToFileURL(entry).href);
  try { await startDaemon(["--viaCli", ...config.args.slice(4)], target.connection); }
  catch { throw new Error("The dedicated Chrome CLI daemon did not start."); }
  // Check the daemon in case the supplied ID already existed.
  await cliCall(root, target)("list_pages", {});
  return { sessionId: target.connection, stop: { command: config.command, args: [config.args[0], "stop", ...config.args.slice(2, 4)] } };
}

export function cliCall(root: string, target: Context): Call {
  const expected = cliConfiguration(root, target).args.slice(4);
  const local = tooling(root);
  let daemonIdentity: string | undefined;
  return async (name, details) => {
    if (name === "execute_webmcp_tool" && details.input !== "{}") throw new Error("Candidate inputs require the MCP connection.");
    try {
      const entry = local.require.resolve("chrome-devtools-mcp/build/src/daemon/client.js");
      const { sendCommand } = await import(pathToFileURL(entry).href);
      const response = await sendCommand({ method: "status" }, target.connection, 4_000);
      const status = response.success ? JSON.parse(response.result) : null;
      if (!status || status.version !== version || !Array.isArray(status.args) ||
        JSON.stringify(status.args.filter((arg: string) => arg !== "--viaCli")) !== JSON.stringify(expected)) {
        throw new Error();
      }
      const identity = JSON.stringify([status.pid, status.startDate]);
      if (daemonIdentity && daemonIdentity !== identity) throw new Error();
      daemonIdentity = identity;
      // Call the already-running daemon. The upstream CLI command can auto-start a default daemon.
      const called = await sendCommand({ method: "invoke_tool", tool: name, args: details }, target.connection, 25_000);
      return called.success ? JSON.parse(called.result) as ToolResult : { isError: true };
    } catch { throw new Error("The dedicated Chrome CLI session could not complete the operation. Inspect the current state before retrying."); }
  };
}

function replyText(result: ToolResult) {
  const text = result.content?.map(part => part.text ?? "").join("\n") ??
    String(result.structuredContent?.text ?? "");
  if (Buffer.byteLength(text) > 128_000) throw new Error("Chrome returned an oversized WebMCP response.");
  return text;
}

export async function observePage(call: Call, target: Context): Promise<Observation> {
  const readDocument = async () => {
    const response = await call("evaluate_script", { pageId: target.pageId, function: documentObservationScript });
    const json = replyText(response).match(/```json\s*([\s\S]+?)\s*```/)?.[1];
    if (response.isError || !json) throw new Error("Chrome could not verify the current document.");
    return JSON.parse(json) as DocumentObservation;
  };
  const before = await readDocument();
  const catalogue = await call("list_webmcp_tools", { pageId: target.pageId });
  const after = await readDocument();
  if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error("The page changed during WebMCP discovery.");
  const tools = catalogue.structuredContent?.webmcpTools;
  if (catalogue.isError || !Array.isArray(tools)) throw new Error("This connection did not return a verified WebMCP catalogue.");
  return { target, document: after, tools };
}

export async function invokeTool(call: Call, details: { pageId: number; toolName: string }, input: Record<string, unknown>) {
  try {
    const response = await call("execute_webmcp_tool", { ...details, input: JSON.stringify(input) });
    if (response.isError) return "unknown";
    // A transport success is separate from what the site did.
    const result = JSON.parse(replyText(response).trim());
    const value = typeof result?.status === "string" ? result.status.toLowerCase() : null;
    return value === "completed" || value === "awaitingsubmission" || value === "canceled" ? value : "unknown";
  } catch { return "unknown"; }
}
