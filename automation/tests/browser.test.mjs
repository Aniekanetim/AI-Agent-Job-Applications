import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, relative, isAbsolute } from 'node:path';
import { browserRuntime, workingRoot, cliConfiguration, launchArguments, launchEnvironment, browserVisibility, saveBrowserVisibility } from '../browser/runtime.mjs';
import { inspectBrowsers, installMissingBrowsers, verifyBrowser, prepareBrowser } from '../browser/setup.mjs';

function box(t) {
  const root = mkdtempSync(join(tmpdir(), 'application-browser-'));
  t.after(() => { const part = relative(tmpdir(), resolve(root)); assert.ok(part && !part.startsWith('..') && !isAbsolute(part)); rmSync(root, { recursive: true }); });
  return root;
}
test('launcher resolves the pinned local CLI and preserves an explicitly selected browser cache', () => {
  const runtime = browserRuntime(workingRoot, { PLAYWRIGHT_BROWSERS_PATH: 'custom-cache' });
  assert.equal(runtime.cliVersion, '0.1.22'); assert.equal(runtime.browserPath, 'custom-cache');
  assert.ok(runtime.cli.includes('@playwright'));
  assert.equal(runtime.environment.NO_UPDATE_NOTIFIER, '1');
});
test('missing local dependencies are a specific setup dependency, not a false ready result', async t => {
  const root = box(t); writeFileSync(join(root, 'package.json'), '{}');
  mkdirSync(join(root, '.local')); writeFileSync(join(root, '.local/browser-readiness.json'), '{"ready":true}');
  const result = await prepareBrowser({ root });
  assert.equal(result.ready, false); assert.equal(result.reason, 'dependenciesMissing');
  assert.equal(JSON.parse(readFileSync(join(root, '.local/browser-readiness.json'), 'utf8')).ready, false);
});
test('matching installed browser runtimes are reused without installation', async t => {
  const root = box(t), executable = join(root, 'browser.exe'); writeFileSync(executable, 'fixture');
  const runtime = { root, cliCorePackage: join(root, 'cli/package.json'), libraryInstaller: join(root, 'library/cli.js'), environment: {} };
  const calls = [];
  const run = async (file, args) => { calls.push([file, args]); return { code: 0, stdout: executable, stderr: '' }; };
  assert.deepEqual(await inspectBrowsers(runtime, run), [{ kind: 'cli', installed: true, executablePath: executable }, { kind: 'library', installed: true, executablePath: executable }]);
  assert.equal((await installMissingBrowsers(runtime, run)).ok, true);
  assert.equal(calls.every(([file]) => file === '-e'), true);
});
test('installation failure reports the affected runtime without raw subprocess output', async t => {
  const root = box(t); const runtime = { root, cliCorePackage: join(root, 'cli/package.json'), libraryInstaller: join(root, 'library/cli.js'), cliInstaller: 'cli-install.js', environment: {} };
  const run = async (file) => file === '-e' ? { code: 0, stdout: join(root, 'absent'), stderr: '' } : { code: 1, stdout: 'private-proxy-detail', stderr: 'private-token' };
  const result = await installMissingBrowsers(runtime, run);
  assert.deepEqual(result, { ok: false, failed: 'cli' });
  assert.equal(JSON.stringify(result).includes('private'), false);
});
test('failed smoke check closes only its own unique session and never loads candidate authentication', async t => {
  const root = box(t); const calls = [];
  const runtime = { root, cli: 'cli.js', environment: {} };
  const run = async (file, args) => { calls.push([file, args]); return { code: 1, stdout: '', stderr: '' }; };
  const result = await verifyBrowser(runtime, run);
  assert.equal(result.ok, false); assert.equal(result.stage, 'open');
  assert.equal(calls.length, 3); assert.equal(calls[1][1][1], 'close');
  assert.equal(calls[2][1][1], 'close');
  assert.equal(calls[0][1][0], calls[1][1][0]);
  assert.equal(JSON.stringify(calls).includes('close-all'), false);
  assert.equal(JSON.stringify(calls).includes('state-load'), false);
  assert.match(calls[0][1][2], /^http:\/\/127\.0\.0\.1:/);
  assert.equal(calls[0][1].includes('--headed'), true);
  const config = calls[0][1].find(arg => arg.startsWith('--config=')).slice(9);
  assert.equal(JSON.parse(readFileSync(config, 'utf8')).browser.launchOptions.headless, false);
});

test('normal opens are headed even with legacy defaults; original custom settings survive', t => {
  const root = box(t); mkdirSync(join(root, '.local/browser'), { recursive: true });
  const path = join(root, '.local/browser/cli.config.json');
  const original = JSON.stringify({ browser: { isolated: false, launchOptions: { headless: true, slowMo: 50 }, storageState: '.auth/reference.json' }, outputDir: 'custom-output' });
  writeFileSync(path, original);
  const args = launchArguments(['-s=work', 'open', 'https://example.test'], root);
  assert.ok(args.includes('--headed'));
  const actual = JSON.parse(readFileSync(args.find(arg => arg.startsWith('--config=')).slice(9), 'utf8'));
  assert.equal(actual.browser.launchOptions.headless, false); assert.equal(actual.browser.launchOptions.slowMo, 50);
  assert.equal(actual.browser.storageState, '.auth/reference.json'); assert.equal(actual.outputDir, 'custom-output');
  assert.equal(readFileSync(path, 'utf8'), original);
  assert.equal(JSON.parse(readFileSync(cliConfiguration(box(t)), 'utf8')).browser.launchOptions.headless, false);
});

test('headless needs an explicit per-open override or saved choice; custom configs cannot silently change the default', t => {
  const root = box(t), custom = join(root, 'custom.json');
  writeFileSync(custom, JSON.stringify({ browser: { initScript: ['./init.js'], launchOptions: { headless: true, slowMo: 20 } } }));
  const customArgs = launchArguments(['open', '--config', custom], root);
  const effective = JSON.parse(readFileSync(customArgs.find(arg => arg.startsWith('--config=')).slice(9), 'utf8'));
  assert.deepEqual(effective.browser.initScript, ['./init.js']);
  assert.equal(customArgs.find(arg => arg.startsWith('--config=')).slice(9), custom);
  assert.ok(customArgs.includes('--headed'));
  const mode = args => JSON.parse(readFileSync(args.find(arg => arg.startsWith('--config=')).slice(9), 'utf8')).browser.launchOptions.headless;
  assert.equal(launchEnvironment(['open', '--config', custom], root, { PLAYWRIGHT_MCP_HEADLESS: 'true' }).PLAYWRIGHT_MCP_HEADLESS, 'false');
  const ini = join(root, 'custom.ini'); writeFileSync(ini, '[browser]\nheadless=true\n');
  assert.ok(launchArguments(['open', `--config=${ini}`], root).includes('--headed'));
  assert.equal(launchEnvironment(['open', `--config=${ini}`, '--headless'], root, {}).PLAYWRIGHT_MCP_HEADLESS, 'true');
  assert.equal(mode(launchArguments(['open', '--headless'], root)), true);
  assert.equal(browserVisibility(root).mode, 'headed');
  saveBrowserVisibility(root, 'headless', 'synthetic-user-choice');
  assert.equal(mode(launchArguments(['open'], root)), true);
  assert.equal(mode(launchArguments(['open', '--headed'], root)), false);
  assert.throws(() => launchArguments(['open', '--headed', '--headless'], root));
  saveBrowserVisibility(root, 'headed', 'synthetic-correction');
  assert.equal(mode(launchArguments(['open'], root)), false);
  assert.deepEqual(launchArguments(['snapshot'], root), ['snapshot']);
});
