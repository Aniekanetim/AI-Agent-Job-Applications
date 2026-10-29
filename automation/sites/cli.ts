import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { ensureSite, loadSites, prepareSitePassword, type SiteRequest } from "./registry.js";
import { siteFile, siteEvidence } from "./files.js";
import { bindTaskSite, recordSiteAccess, assertSiteAction, type SitePage, type SiteAction } from "./execution.js";
import { pauseForSiteAccess, reportSiteAccess, resolveSiteAccess } from "./access-handoff.js";
import { markSubmissionAttempted, type ApplicationTask } from "../workflow/application-state.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../../.."), args = process.argv.slice(2);
const option = (name: string) => args[args.indexOf(name) + 1];
const command = args[0] ?? "help";
try {
  let result: unknown;
  if (command === "list") result = loadSites(root).state;
  else if (command === "help") result = { commands: ["list", "ensure --file PRIVATE_REQUEST.json", "reconcile --file PRIVATE_REQUEST_ARRAY.json", "password --site SITE_ID", "bind|access|check|pause|report|resolve|submit --file PRIVATE_OPERATION.json"],
    note: "Operations return task state without saving it. Persist through the owning task/protected alert interface before browser actions. Reconcile registers actual observations only; it never clears blockers, migrates ticket evidence or claims live readiness." };
  else if (command === "password") result = prepareSitePassword(root, option("--site"));
  else {
    if (!args.includes("--file")) throw new Error("Supply the saved private request file.");
    const value = JSON.parse(readFileSync(siteFile(root, option("--file")), "utf8"));
    if (command === "ensure") result = ensureSite(root, value as SiteRequest);
    else if (command === "reconcile") {
      if (!Array.isArray(value)) throw new Error("Reconcile an explicit array of observed sites, never infer a successful login from a folder.");
      result = value.map(r => ensureSite(root, r));
    } else {
      const task = value.task as ApplicationTask;
      if (command === "bind") result = bindTaskSite(root, task, value.siteId, value.page as SitePage);
      else if (command === "access") result = recordSiteAccess(root, task, siteEvidence(root, value.reportPath));
      else if (command === "check") { assertSiteAction(root, task, value.page, value.action as SiteAction); result = { permitted: true, taskId: task.taskId, action: value.action }; }
      else if (command === "pause") result = pauseForSiteAccess(root, task, value.observation);
      else if (command === "report") result = reportSiteAccess(task, value.id, value.reference);
      else if (command === "resolve") result = resolveSiteAccess(root, task, value.observation);
      else if (command === "submit") result = markSubmissionAttempted(task, root, value.page);
      else throw new Error("Unknown site command; use help.");
    }
  }
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
} catch {
  // Never echo request bodies, URL query strings, credentials or raw parser errors.
  process.stderr.write("Website preparation could not complete. Preserve the private request and checkpoint; inspect its identity, ownership, paths and current evidence using automation/sites/README.md.\n");
  process.exitCode = 1;
}
