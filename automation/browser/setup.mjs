import { existsSync, mkdirSync, writeFileSync, renameSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { browserRuntime, runNode, runtimeFingerprint, workingRoot } from './runtime.mjs';

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
  const server = createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end('<!doctype html><title>Browser setup check</title><button id="check" onclick="document.querySelector(\'output\').textContent=\'Browser interaction verified\'">Check browser</button><output aria-live="polite">Waiting</output>');
  });
  let stage = 'open';
  try {
    await new Promise((done, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', done); });
    const address = server.address();
    const url = `http://127.0.0.1:${address.port}/`;
    const invoke = args => run(runtime.cli, [`-s=${session}`, ...args], {
      root: runtime.root, environment: runtime.environment, timeout: 45_000,
    });
    const opened = await invoke(['open', url, `--config=${config}`]);
    if (opened.code !== 0 || /### Error/.test(opened.stdout)) return { ok: false, stage };
    stage = 'snapshot';
    const snapshot = await invoke(['snapshot']);
    if (snapshot.code !== 0 || /### Error/.test(snapshot.stdout)) return { ok: false, stage };
    // CLI refs are inspected during interactive discovery. This controlled fixture uses a known local DOM.
    stage = 'interaction';
    const checked = await invoke(['run-code', 'async page => { await page.getByRole("button", { name: "Check browser", exact: true }).click(); return await page.locator("output").textContent(); }']);
    return { ok: checked.code === 0 && !/### Error/.test(checked.stdout) && checked.stdout.includes('Browser interaction verified'), stage };
  } catch { return { ok: false, stage }; }
  finally {
    await run(runtime.cli, [`-s=${session}`, 'close'], { root: runtime.root, environment: runtime.environment, timeout: 20_000 });
    await new Promise(done => server.close(done));
  }
}

function saveReport(root, result, runtime) {
  const report = { schemaVersion: 1, ...result, fingerprint: runtime ? runtimeFingerprint(runtime) : null,
    checkedAt: new Date().toISOString(), scope: 'Isolated local CLI navigation and interaction; no website authentication or application submission.' };
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
    report = verified.ok ? { ready: true, reason: 'verified' } : { ready: false,
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
