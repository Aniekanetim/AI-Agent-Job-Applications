import { createRequire } from 'node:module';
import { existsSync, mkdirSync, writeFileSync, readFileSync, renameSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { homedir } from 'node:os';

export const workingRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

function chooseCache(root, environment, corePackage) {
  if (environment.PLAYWRIGHT_BROWSERS_PATH) return environment.PLAYWRIGHT_BROWSERS_PATH;
  const browsers = JSON.parse(readFileSync(resolve(dirname(corePackage), 'browsers.json'), 'utf8')).browsers;
  const revision = browsers.find(browser => browser.name === 'chromium').revision;
  const local = resolve(root, '.local/browsers');
  const shared = process.platform === 'win32' ? resolve(environment.LOCALAPPDATA || resolve(homedir(), 'AppData/Local'), 'ms-playwright') :
    process.platform === 'darwin' ? resolve(homedir(), 'Library/Caches/ms-playwright') :
      resolve(environment.XDG_CACHE_HOME || resolve(homedir(), '.cache'), 'ms-playwright');
  return [local, shared].find(folder => existsSync(resolve(folder, `chromium-${revision}`))) || local;
}

/** Resolve the pinned local CLI, never a global command or a network npx fallback. */
export function browserRuntime(root = workingRoot, environment = process.env) {
  const require = createRequire(resolve(root, 'package.json'));
  const cliPackage = require.resolve('@playwright/cli/package.json');
  const cliRequire = createRequire(cliPackage);
  const libraryPackage = require.resolve('playwright/package.json');
  const cliCorePackage = cliRequire.resolve('playwright-core/package.json');
  const libraryRequire = createRequire(libraryPackage);
  const browserPath = chooseCache(root, environment, cliCorePackage);
  const libraryBrowserPath = chooseCache(root, environment, libraryRequire.resolve('playwright-core/package.json'));
  return {
    root, browserPath, libraryBrowserPath,
    cli: resolve(dirname(cliPackage), 'playwright-cli.js'),
    cliVersion: cliRequire('./package.json').version,
    cliInstaller: resolve(dirname(cliRequire.resolve('playwright/package.json')), 'cli.js'),
    libraryInstaller: resolve(dirname(libraryPackage), 'cli.js'),
    cliBrowserVersion: cliRequire('playwright-core/package.json').version,
    libraryVersion: require('playwright/package.json').version,
    cliCorePackage,
    environment: { ...environment, PLAYWRIGHT_BROWSERS_PATH: browserPath, NO_UPDATE_NOTIFIER: '1' },
    libraryEnvironment: { ...environment, PLAYWRIGHT_BROWSERS_PATH: libraryBrowserPath, NO_UPDATE_NOTIFIER: '1' },
  };
}

export function runNode(script, args, options = {}) {
  return new Promise(resolveResult => {
    const child = spawn(process.execPath, [script, ...args], {
      cwd: options.root || workingRoot, env: options.environment || process.env,
      shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '', stderr = '', timedOut = false;
    child.stdout.on('data', chunk => { stdout = (stdout + chunk).slice(-256_000); });
    child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-32_000); });
    const timeout = setTimeout(() => { timedOut = true; child.kill(); }, options.timeout || 45_000);
    child.on('error', () => { clearTimeout(timeout); resolveResult({ code: 1, stdout: '', stderr: '', timedOut }); });
    child.on('close', code => { clearTimeout(timeout); resolveResult({ code: code ?? 1, stdout, stderr, timedOut }); });
  });
}

/** Pin browser choice and keep CLI artifacts in ignored storage. No account state is loaded. */
export function browserVisibility(root = workingRoot) {
  const path = resolve(root, '.local/browser/visibility.json');
  if (!existsSync(path)) return { mode: 'headed', sourceReference: 'package-default' };
  const value = JSON.parse(readFileSync(path, 'utf8'));
  if (value.schemaVersion !== 1 || !['headed', 'headless'].includes(value.mode) || !value.sourceReference?.trim()) throw new Error('Invalid browser visibility choice. Preserve it and ask the agent to reconcile the saved setting.');
  return value;
}

export function saveBrowserVisibility(root, mode, sourceReference) {
  if (!['headed', 'headless'].includes(mode) || !sourceReference?.trim()) throw new Error('Reference the actual headed/headless choice.');
  const folder = resolve(root, '.local/browser'); mkdirSync(folder, { recursive: true });
  const path = resolve(folder, 'visibility.json'), temporary = resolve(folder, `visibility-${randomUUID()}.tmp`);
  writeFileSync(temporary, JSON.stringify({ schemaVersion: 1, mode, sourceReference }, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  renameSync(temporary, path);
}

export function cliConfiguration(root = workingRoot, { configPath, mode = browserVisibility(root).mode } = {}) {
  const folder = resolve(root, '.local/browser');
  mkdirSync(folder, { recursive: true });
  const path = resolve(folder, 'cli.config.json');
  const value = JSON.stringify({
    browser: { browserName: 'chromium', isolated: true, launchOptions: { channel: 'chromium', headless: false } },
    outputDir: resolve(root, 'output/playwright'), outputMode: 'file',
  }, null, 2) + '\n';
  // Preserve the original config, including legacy headless defaults and authentication references.
  if (!existsSync(path)) writeFileSync(path, value, { flag: 'wx', mode: 0o600 });
  const original = configPath ? resolve(root, configPath) : path;
  const config = JSON.parse(readFileSync(original, 'utf8').replace(/^\uFEFF/, ''));
  config.browser ??= {}; config.browser.launchOptions ??= {};
  // The CLI resolves these two lists relative to its config file. Keep that meaning
  // when the effective copy lives in a different private directory.
  for (const key of ['initPage', 'initScript']) if (Array.isArray(config.browser[key])) {
    config.browser[key] = config.browser[key].map(file => resolve(dirname(original), file));
  }
  config.browser.launchOptions.headless = mode === 'headless';
  const contents = JSON.stringify(config, null, 2) + '\n';
  const effective = resolve(folder, `effective-${createHash('sha256').update(contents).digest('hex').slice(0, 20)}.json`);
  if (!existsSync(effective)) writeFileSync(effective, contents, { flag: 'wx', mode: 0o600 });
  return effective;
}

/** Every open, including custom configs, uses visible mode unless explicitly overridden. */
export function launchArguments(input, root = workingRoot) {
  const args = [...input];
  if (!args.includes('open')) return args;
  if (args.includes('--headless') && args.includes('--headed')) throw new Error('Choose one browser visibility mode.');
  const mode = args.includes('--headless') ? 'headless' : args.includes('--headed') ? 'headed' : browserVisibility(root).mode;
  let configPath;
  const filtered = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--headless' || args[i] === '--headed') continue;
    if (args[i].startsWith('--config=')) { configPath = args[i].slice(9); continue; }
    if (args[i] === '--config') { configPath = args[++i]; if (!configPath) throw new Error('Supply the config path.'); continue; }
    filtered.push(args[i]);
  }
  // Leave explicit configs at their original path, preserving INI support and
  // relative initialization paths. Visibility overrides use CLI/environment precedence.
  filtered.push(`--config=${configPath ? resolve(root, configPath) : cliConfiguration(root, { mode })}`);
  if (mode === 'headed') filtered.push('--headed');
  return filtered;
}

export function launchEnvironment(input, root = workingRoot, environment = process.env) {
  if (!input.includes('open')) return environment;
  const mode = input.includes('--headless') ? 'headless' : input.includes('--headed') ? 'headed' : browserVisibility(root).mode;
  return { ...environment, PLAYWRIGHT_MCP_HEADLESS: mode === 'headless' ? 'true' : 'false' };
}

export function runtimeFingerprint(runtime) {
  return { root: runtime.root, platform: process.platform, arch: process.arch,
    nodeMajor: Number(process.versions.node.split('.')[0]), cliVersion: runtime.cliVersion,
    cliBrowserVersion: runtime.cliBrowserVersion, libraryVersion: runtime.libraryVersion,
    browserPath: runtime.browserPath, libraryBrowserPath: runtime.libraryBrowserPath };
}
