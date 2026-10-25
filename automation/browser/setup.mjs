import { existsSync, mkdirSync, writeFileSync, renameSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { browserRuntime, runNode, runtimeFingerprint, workingRoot } from './runtime.mjs';
import { createRehearsal } from './rehearsal.mjs';

// A subprocess resolves executable paths after the selected cache environment is set.
const executableProbe = 'const {createRequire}=require("node:module");const r=createRequire(process.argv[1]);console.log(r("playwright-core").chromium.executablePath())';
export async function inspectBrowsers(runtime, run = runNode) {
  const results = [];
  for (const [kind, packageFile] of [['cli', runtime.cliCorePackage], ['library', resolve(dirname(runtime.libraryInstaller), 'package.json')]]) {
    const result = await run('-e', [executableProbe, packageFile], { root: runtime.root,
      environment: kind === 'library' ? runtime.libraryEnvironment : runtime.environment });
    const executable = result.stdout.trim();
    results.push({ kind, installed: result.code === 0 && !!executable && existsSync(executable), executablePath: executable || null });
  }
  return results;
}

export async function installMissingBrowsers(runtime, run = runNode) {
  const checks = await inspectBrowsers(runtime, run);
  for (const check of checks) {
    if (check.installed) continue;
    const installer = check.kind === 'cli' ? runtime.cliInstaller : runtime.libraryInstaller;
    const result = await run(installer, ['install', 'chromium'], {
      root: runtime.root, environment: check.kind === 'library' ? runtime.libraryEnvironment : runtime.environment, timeout: 900_000,
    });
    if (result.code !== 0) {
      const folder = resolve(runtime.root, '.local/browser'); mkdirSync(folder, { recursive: true });
      writeFileSync(resolve(folder, `${check.kind}-installation.log`), `${result.stdout}\n${result.stderr}`, { mode: 0o600 });
      return { ok: false, failed: check.kind };
    }
  }
  return { ok: true };
}

/** Exercise the actual CLI in an isolated session against loopback, without credentials. */
export async function verifyBrowser(runtime, run = runNode) {
  const session = `setup-${randomUUID().slice(0, 12)}`;
  const folder = resolve(runtime.root, 'output/playwright', session);
  mkdirSync(folder, { recursive: true });
  const config = resolve(folder, 'config.json');
  writeFileSync(config, JSON.stringify({ browser: { browserName: 'chromium', isolated: true,
    launchOptions: { channel: 'chromium', headless: true } }, outputDir: folder, outputMode: 'file' }), { mode: 0o600 });
  const fixture = await createRehearsal(folder);
  const uploadSession = `${session}-upload`;
  let stage = 'open';
  try {
    const invoke = (args, selected = session) => run(runtime.cli, [`-s=${selected}`, ...args], {
      root: runtime.root, environment: runtime.environment, timeout: 45_000,
    });
    const opened = await invoke(['open', fixture.url, `--config=${config}`]);
    if (opened.code !== 0 || /### Error/.test(opened.stdout)) return { ok: false, stage };
    stage = 'snapshot';
    const snapshot = await invoke(['snapshot']);
    if (snapshot.code !== 0 || /### Error/.test(snapshot.stdout)) return { ok: false, stage };
    // CLI refs are inspected during interactive discovery. This controlled fixture uses a known local DOM.
    stage = 'checkpoint';
    const saved = await invoke(['run-code', 'async page => { await page.getByLabel("Candidate name").fill("Synthetic Candidate"); await page.getByRole("button", {name:"Save rehearsal checkpoint",exact:true}).click(); await page.locator("#checkpoint").filter({hasText:"Checkpoint saved"}).waitFor(); return "checkpoint verified"; }']);
    if (saved.code !== 0 || /### Error/.test(saved.stdout) || !saved.stdout.includes('checkpoint verified')) return { ok: false, stage };
    await invoke(['close']);
    stage = 'resume';
    const resumed = await invoke(['open', fixture.url, `--config=${config}`], uploadSession);
    if (resumed.code !== 0 || /### Error/.test(resumed.stdout)) return { ok: false, stage };
    stage = 'upload';
    const code = `async page => { if (await page.getByLabel("Candidate name").inputValue() !== "Synthetic Candidate") throw new Error("checkpoint not restored"); await page.getByLabel("Test document").setInputFiles(${JSON.stringify(fixture.uploadPath)}); await page.locator("#upload").filter({hasText:"Synthetic file upload verified"}).waitFor(); await page.getByRole("button", {name:"Check browser",exact:true}).click(); await page.locator("#outcome").filter({hasText:"Browser interaction and upload verified"}).waitFor(); return await page.locator("#outcome").textContent(); }`;
    const checked = await invoke(['run-code', code], uploadSession);
    return { ok: checked.code === 0 && !/### Error/.test(checked.stdout) && checked.stdout.includes(`Browser interaction and upload verified: ${fixture.applicationId}`), stage };
  } catch { return { ok: false, stage }; }
  finally {
    await run(runtime.cli, [`-s=${session}`, 'close'], { root: runtime.root, environment: runtime.environment, timeout: 20_000 });
    await run(runtime.cli, [`-s=${uploadSession}`, 'close'], { root: runtime.root, environment: runtime.environment, timeout: 20_000 });
    await fixture.close();
  }
}

function saveReport(root, result, runtime) {
  const report = { schemaVersion: 1, ...result, fingerprint: runtime ? runtimeFingerprint(runtime) : null,
    checkedAt: new Date().toISOString(), scope: 'Playwright-only local navigation, form completion, draft recovery across isolated sessions and synthetic file upload. No in-app browser, website authentication or job submission is established.' };
  const folder = resolve(root, '.local');
  mkdirSync(folder, { recursive: true });
  const temporary = resolve(folder, `browser-readiness-${randomUUID()}.tmp`);
  writeFileSync(temporary, JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  renameSync(temporary, resolve(folder, 'browser-readiness.json'));
  return report;
}

export async function prepareBrowser({ install = false, root = workingRoot } = {}) {
  let runtime;
  try { runtime = browserRuntime(root); }
  catch { return saveReport(root, { ready: false, reason: 'dependenciesMissing', nextAction: 'Agent: verify Node.js 22+ and npm, then install this working copy with npm ci.' }); }
  if (Number(process.versions.node.split('.')[0]) < 22) {
    return saveReport(root, { ready: false, reason: 'nodeVersion', nextAction: 'Agent: prepare Node.js 22+ using the supported host installer; explain any required user action.' }, runtime);
  }
  if (install) {
    const installed = await installMissingBrowsers(runtime);
    if (!installed.ok) return saveReport(root, { ready: false, reason: 'browserInstallation', nextAction: 'Agent: inspect the private installation log and resolve network, storage, permissions or Linux system dependencies; preserve existing installations.' }, runtime);
  }
  const checks = await inspectBrowsers(runtime);
  let report;
  if (checks.some(check => !check.installed)) report = { ready: false, reason: 'browserMissing',
    nextAction: 'Agent: run npm run browser:setup to install the missing pinned browser runtimes.' };
  else {
    const verified = await verifyBrowser(runtime);
    report = verified.ok ? { ready: true, reason: 'verified', capabilities: { navigation: true, formFilling: true, fileUpload: true, outcomeInspection: true, checkpointRecovery: true } } : { ready: false,
      reason: `browserCheck:${verified.stage}`, nextAction: 'Agent: inspect the private setup artifacts and resolve the browser launch or interaction failure.' };
  }
  return saveReport(root, { ...report, checks }, runtime);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const report = await prepareBrowser({ install: process.argv.includes('--install') });
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = report.ready ? 0 : 2;
  } catch {
    console.error('Browser setup could not finish. Agent: investigate runtime or private-storage access; no account credentials were read.');
    process.exitCode = 1;
  }
}
