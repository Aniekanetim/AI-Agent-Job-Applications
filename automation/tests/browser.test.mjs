import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, relative, isAbsolute } from 'node:path';
import { browserRuntime, workingRoot } from '../browser/runtime.mjs';
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
});
