import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { spawn, execFile } from "node:child_process";
import { basename, dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { setTimeout as pause } from "node:timers/promises";
import { chromium } from "playwright";
import { chromeArguments, cliCall, cliConfiguration, invokeTool, observePage, startCli, withMcp } from "./bridge.js";
import type { Context } from "./webmcp.js";
import { rehearseDeclarative } from "./declarative-rehearsal.js";

const html = `<!doctype html>
<meta charset="utf-8">
<title>Synthetic vacancy</title>
<output id="receipt">No submission</output>
<script>
document.modelContext?.registerTool({
  name: "submit_fixture",
  description: "Submit a synthetic application",
  inputSchema: {type: "object", properties: {name: {type: "string"}}, required: ["name"]},
  execute: async ({name}) => {
    await fetch("/receipt", {method: "POST", body: name});
    document.querySelector("#receipt").textContent = "Synthetic receipt R-001";
    return {content: [{type: "text", text: "Fixture response"}]};
  }
});
document.modelContext?.registerTool({
  name: "inspect_fixture",
  description: "Inspect this synthetic vacancy",
  inputSchema: {type: "object", properties: {}},
  execute: () => ({content: [{type: "text", text: "Synthetic vacancy"}]})
});
</script>`;

const root = process.cwd();
let submissions = 0;
const server = createServer((request, response) => {
  if (request.url === "/receipt" && request.method === "POST") {
    request.on("end", () => { submissions++; response.end("Recorded"); });
    request.resume();
    return;
  }
  response.setHeader("Content-Type", "text/html; charset=utf-8");
  response.end(html);
});

async function rehearseCli(executable: string, origin: string) {
  const temp = realpathSync(tmpdir());
  const profile = mkdtempSync(join(temp, "job-webmcp-fixture-"));
  const url = origin + "/vacancy";
  const browser = spawn(executable, ["--headless=new", "--remote-debugging-port=0",
    "--enable-features=WebMCP", "--disable-background-networking", "--no-first-run",
    "--user-data-dir=" + profile, url], { stdio: "ignore", windowsHide: true });
  const closed = new Promise(resolve => { browser.once("close", resolve); browser.once("error", resolve); });
  const run = promisify(execFile);
  let config: ReturnType<typeof cliConfiguration> | undefined;
  let browserEndpoint: string | undefined;
  try {
    const portFile = join(profile, "DevToolsActivePort");
    for (let i = 0; i < 80 && !existsSync(portFile) && browser.exitCode === null; i++) await pause(100);
    if (!existsSync(portFile)) throw new Error("The dedicated fixture browser did not publish its endpoint.");
    const port = readFileSync(portFile, "utf8").split(/\r?\n/)[0];
    browserEndpoint = "http://127.0.0.1:" + port;
    const target: Context = { taskId: "synthetic", page: { url, browser: "playwright", sessionReference: "fixture" },
      pageId: 1, context: "interactive", method: "cli", connection: randomUUID(), vacancy: "fixture",
      account: "fixture", browserEndpoint, evidence: { path: "fixture", sha256: "a".repeat(64) } };
    config = cliConfiguration(root, target);
    await startCli(root, target);
    const call = cliCall(root, target);
    const opened = await call("new_page", { url });
    assert.equal(opened.isError, undefined, "The CLI could not open the loopback fixture.");
    const listed = await call("list_pages", {});
    const pages = listed.structuredContent?.pages;
    assert.ok(Array.isArray(pages), "Fixture CLI page listing failed: " + JSON.stringify(listed).slice(0, 1400));
    const match = pages.find(page => page.url === url);
    assert.ok(match && Number.isInteger(match.id ?? match.pageId));
    target.pageId = match.id ?? match.pageId;
    const inventory = await observePage(call, target);
    assert.ok(inventory.tools.find(tool => tool.name === "inspect_fixture"));
    const inspection = await invokeTool(call, { pageId: target.pageId, toolName: "inspect_fixture" }, {}, true);
    assert.equal(inspection.status, "completed");
    assert.ok(JSON.stringify(inspection.untrustedOutput).includes("Synthetic vacancy"));
    assert.equal(submissions, 1);
    console.log("WebMCP CLI rehearsal passed: owned daemon, contextual discovery and read-only inspection.");
  } finally {
    if (config) await run(config.command, [config.args[0], "stop", ...config.args.slice(2, 4)], {
      cwd: root, windowsHide: true, timeout: 10_000,
    }).catch(() => {});
    if (browserEndpoint) {
      try {
        const response = await fetch(browserEndpoint + "/json/version", { signal: AbortSignal.timeout(2000) });
        const { webSocketDebuggerUrl } = await response.json() as { webSocketDebuggerUrl: string };
        const endpoint = new URL(webSocketDebuggerUrl);
        if (endpoint.protocol !== "ws:" || endpoint.host !== new URL(browserEndpoint).host) throw new Error();
        const socket = new WebSocket(endpoint);
        await new Promise<void>((done, reject) => {
          const timer = setTimeout(() => { socket.close(); reject(new Error()); }, 2500);
          socket.addEventListener("open", () => socket.send(JSON.stringify({ id: 1, method: "Browser.close" })), { once: true });
          socket.addEventListener("close", () => { clearTimeout(timer); done(); }, { once: true });
          socket.addEventListener("error", () => { clearTimeout(timer); reject(new Error()); }, { once: true });
        });
      } catch { /* Fall back to stopping this fixture process below. */ }
    }
    await Promise.race([closed, pause(1500)]);
    if (browser.exitCode === null && browser.signalCode === null && browser.pid) {
      if (process.platform === "win32") {
        await run("taskkill.exe", ["/PID", String(browser.pid), "/T", "/F"], {
          windowsHide: true, timeout: 5000,
        }).catch(() => browser.kill());
      } else browser.kill();
    }
    await Promise.race([closed, pause(3000)]);
    const actual = realpathSync(profile);
    if (dirname(actual) === temp && basename(actual).startsWith("job-webmcp-fixture-")) {
      try { rmSync(actual, { recursive: true, maxRetries: 7, retryDelay: 250 }); }
      catch { console.error("The isolated fixture profile is still locked and remains in the system temporary folder."); }
    }
  }
}
try {
  const executable = process.argv[2] ?? chromium.executablePath();
  if (!existsSync(executable)) throw new Error("Install the existing Playwright Chromium or supply a compatible Chrome executable.");
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Unable to bind the local fixture.");
  const origin = `http://127.0.0.1:${address.port}`;
  await withMcp(root, [...chromeArguments(root, origin), "--headless=true", "--isolated=true",
    "--executablePath", executable, "--chromeArg=--enable-features=WebMCP"], async call => {
    const url = origin + "/vacancy";
    const opened = await call("new_page", { url });
    assert.equal(opened.isError, undefined, "Chrome could not open the fixture");
    const pages = (await call("list_pages", {})).structuredContent?.pages;
    assert.ok(Array.isArray(pages));
    const match = pages.find(page => page.url === url);
    assert.ok(match && Number.isInteger(match.id ?? match.pageId));
    const pageId = match.id ?? match.pageId;
    const target: Context = { taskId: "synthetic", page: { url, browser: "playwright", sessionReference: "fixture" },
      pageId, context: "interactive", method: "mcp", connection: "fixture", vacancy: "fixture",
      account: "fixture", evidence: { path: "fixture", sha256: "a".repeat(64) } };
    const observed = await observePage(call, target);
    assert.equal(observed.document.apiObserved, true);
    assert.ok(observed.tools.find(tool => tool.name === "submit_fixture"));
    const invocation = await invokeTool(call, { pageId, toolName: "submit_fixture" }, { name: "Synthetic candidate" });
    assert.equal(invocation.status, "completed");
    const ui = await call("evaluate_script", { pageId, function: '() => document.querySelector("#receipt").textContent' });
    assert.ok(JSON.stringify(ui.content).includes("Synthetic receipt R-001"));
    assert.equal(submissions, 1);
    console.log("WebMCP rehearsal passed: native Chrome discovery, MCP invocation, visible receipt and one loopback submission.");
  });
  await rehearseCli(executable, origin);
  await rehearseDeclarative(root, executable);
} catch (error) {
  console.error(error instanceof Error ? error.message : "The loopback rehearsal did not finish.");
  process.exitCode = 1;
} finally {
  server.closeAllConnections();
  server.close();
}
await new Promise<void>(done => process.stdout.write("", () => done()));
await new Promise<void>(done => process.stderr.write("", () => done()));
process.exit(process.exitCode ?? 0);
