import assert from "node:assert/strict";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { setTimeout as pause } from "node:timers/promises";
import { chromium, type BrowserContext } from "playwright";
import { readySite, siteBox } from "../tests/sites-fixture.js";
import { recordSiteAccess } from "../sites/execution.js";
import { canMarkApplied } from "../workflow/application-state.js";
import { bindTaskTicket, loadTaskControl } from "../workflow/task-control.js";
import { invokeTool, observePage, useMcp } from "./bridge.js";
import { observeWebMcpAction, prepareWebMcpAction, saveInventory, type Context } from "./webmcp.js";

const fixtureOrigin = "https://webmcp-fixture.test";
const vacancyUrl = fixtureOrigin + "/vacancy";
const fixtureHtml = '<!doctype html>'
  + '<title>Synthetic WebMCP declarative vacancy</title>'
  + '<form id="manual" toolname="prepare_fixture" tooldescription="Prepare a synthetic application draft">'
  + '<label>Name <input name="name" required></label><button type="submit">Submit draft</button></form>'
  + '<form id="automatic" toolname="submit_fixture" tooldescription="Submit a synthetic application" toolautosubmit>'
  + '<label>Name <input name="name" required></label><button type="submit">Submit application</button></form>'
  + '<output id="receipt">No submission</output>'
  + '<script>'
  + 'for (const form of document.forms) form.addEventListener("submit", event => {'
  + '  event.preventDefault();'
  + '  const request = fetch("/receipt", {method: "POST", body: new URLSearchParams(new FormData(form))})'
  + '    .then(response => response.text()).then(receipt => {'
  + '      document.querySelector("#receipt").textContent = receipt;'
  + '      return {content: [{type: "text", text: "Form delivered"}]};'
  + '    });'
  + '  if (event.agentInvoked) event.respondWith(request);'
  + '});'
  + '</script>';

async function rehearseForm(browser: BrowserContext, endpoint: string, root: string, purpose: "fill" | "submit") {
  const requests: string[] = [];
  const cleanup: (() => void)[] = [];
  const receipt = "Synthetic declarative fixture receipt R-002";
  const input = { name: purpose === "fill" ? "Synthetic draft" : "Synthetic candidate" };
  const toolName = purpose === "fill" ? "prepare_fixture" : "submit_fixture";
  const route = (value: URL) => value.origin === fixtureOrigin;
  const page = await browser.newPage();
  try {
    await page.route(route, async request => {
      const url = new URL(request.request().url());
      if (url.pathname === "/receipt" && request.request().method() === "POST") {
        requests.push(new URLSearchParams(request.request().postData() ?? "").get("name") ?? "");
        await request.fulfill({ contentType: "text/plain", body: receipt });
      } else if (url.pathname === "/vacancy" && request.request().method() === "GET") {
        await request.fulfill({ contentType: "text/html", body: fixtureHtml });
      } else await request.abort();
    });
    await page.goto(vacancyUrl);
    const site = readySite({ after: done => cleanup.push(done) }, {
      taskId: "APP-webmcp-" + purpose, originalIntake: "To Do", checkpoint: "prepared",
      selectedRoleId: "synthetic-qa", cvVersion: "test-cv", cvSha256: "a".repeat(64),
    }, vacancyUrl);
    appendFileSync(site.root + "/.gitignore", "\n/Task Board/To Do/*\n**/*.local.json\n");
    const evidence = site.write(".local/webmcp-rehearsal/site.json", { url: page.url(), title: await page.title() });
    const access = site.write(".local/webmcp-rehearsal/access.json", { ...site.page, schemaVersion: 1,
      siteId: site.site.id, taskId: site.task.taskId, observedAt: new Date().toISOString(),
      access: "anonymous", identityVerified: true, challengeCleared: true, permittedActions: ["webmcp", "submit"], evidence });
    const task = recordSiteAccess(site.root, site.task, access);
    const ticket = site.write("Task Board/To Do/" + task.taskId + ".md", "# Synthetic declarative application");
    bindTaskTicket(site.root, task, ticket.path);
    const current = () => loadTaskControl(site.root, task.taskId).data!.task;
    const target: Context = { taskId: task.taskId, page: site.page, pageId: 1, context: "interactive",
      method: "mcp", connection: endpoint, vacancy: "fixture-vacancy", account: "fixture-anonymous", evidence };
    await useMcp(root, target, async call => {
      const pages = (await call("list_pages", {})).structuredContent?.pages;
      assert.ok(Array.isArray(pages));
      const matchingPage = pages.find(page => page.url === vacancyUrl);
      assert.ok(matchingPage && Number.isInteger(matchingPage.id ?? matchingPage.pageId));
      target.pageId = matchingPage.id ?? matchingPage.pageId;
      const inventory = saveInventory(site.root, await observePage(call, target));
      assert.equal(inventory.status, "available", "Chrome did not return a usable WebMCP inventory.");
      const definition = inventory.tools.find(tool => tool.name === toolName);
      assert.ok(definition, "Chrome did not expose the declarative action.");
      const mapping = site.write(dirname(site.site.architecturePath).replaceAll("\\", "/") + "/webmcp.local.json", {
        ...definition, toolName, purpose, origin: fixtureOrigin, fields: ["name"],
        observation: "Synthetic form with known submission behavior.",
      });
      const action = prepareWebMcpAction(site.root, await observePage(call, target), {
        inventoryId: inventory.id, toolName, purpose, input, mapping, ownerId: "declarative-rehearsal",
      });
      assert.equal(current().checkpoint, purpose === "fill" ? "prepared" : "submissionAttempted");
      const execution = invokeTool(call, action, input);
      if (purpose === "fill") {
        const name = page.locator("#manual input");
        await page.waitForFunction(expected => document.querySelector<HTMLInputElement>("#manual input")?.value === expected,
          input.name, { timeout: 10_000 });
        assert.equal(await name.inputValue(), input.name);
        assert.equal(canMarkApplied(current()), false);
        assert.deepEqual(requests, []);
        assert.equal(await page.locator("#receipt").textContent(), "No submission");
        await page.locator("#manual").evaluate((form: HTMLFormElement) => form.reset());
        assert.equal((await execution).status, "canceled");
        assert.equal(await name.inputValue(), "");
        assert.deepEqual(requests, []);
        const draft = site.write(".local/webmcp-rehearsal/draft.json", { fieldsPopulated: true, submitted: false, reset: true });
        observeWebMcpAction(site.root, action.actionId, "completed", draft);
        assert.equal(current().checkpoint, "prepared");
        assert.equal(canMarkApplied(current()), false);
      } else {
        assert.equal((await execution).status, "completed");
        assert.equal(canMarkApplied(current()), false);
        assert.deepEqual(requests, [input.name]);
        const observedReceipt = await page.locator("#receipt").textContent();
        assert.equal(observedReceipt, receipt);
        const confirmation = site.write(".local/webmcp-rehearsal/receipt.json", { vacancy: vacancyUrl, receipt: observedReceipt });
        observeWebMcpAction(site.root, action.actionId, "confirmed", confirmation, {
          ...current(), checkpoint: "confirmed", confirmation: { reference: confirmation.path, observedAt: new Date().toISOString() },
        });
        assert.equal(canMarkApplied(current()), true);
      }
    });
  } finally {
    await page.close().catch(() => {});
    for (const done of cleanup.reverse()) done();
  }
}

export async function rehearseDeclarative(root: string, executablePath: string) {
  const cleanup: (() => void)[] = [];
  const temp = siteBox({ after: done => cleanup.push(done) });
  const profile = join(temp.root, "browser");
  mkdirSync(profile);
  let browser: BrowserContext | undefined;
  try {
    browser = await chromium.launchPersistentContext(profile, { executablePath, headless: true,
      args: ["--remote-debugging-port=0", "--enable-features=WebMCP"], serviceWorkers: "block" });
    const portFile = join(profile, "DevToolsActivePort");
    for (let i = 0; i < 30 && !existsSync(portFile); i++) await pause(100);
    assert.ok(existsSync(portFile), "The declarative fixture browser did not publish its endpoint.");
    const port = readFileSync(portFile, "utf8").split(/\r?\n/)[0];
    const endpoint = "http://127.0.0.1:" + port;
    await rehearseForm(browser, endpoint, root, "fill");
    console.log("WebMCP declarative draft passed: fields filled, no receipt or submission, task remains Prepared.");
    await rehearseForm(browser, endpoint, root, "submit");
    console.log("WebMCP declarative submission passed: attempt recorded first, one submission, separate receipt required.");
  } finally {
    await browser?.close().catch(() => {});
    for (const done of cleanup.reverse()) done();
  }
}
