import { createRequire } from 'node:module';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
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
export function cliConfiguration(root = workingRoot) {
  const folder = resolve(root, '.local/browser');
  mkdirSync(folder, { recursive: true });
  const path = resolve(folder, 'cli.config.json');
  const value = JSON.stringify({
    browser: { browserName: 'chromium', isolated: true, launchOptions: { channel: 'chromium', headless: true } },
    outputDir: resolve(root, 'output/playwright'), outputMode: 'file',
  }, null, 2) + '\n';
  // Preserve a user-customized config. The smoke check always uses its own configuration.
  if (!existsSync(path)) writeFileSync(path, value, { flag: 'wx', mode: 0o600 });
  return path;
}

export function runtimeFingerprint(runtime) {
  return { root: runtime.root, platform: process.platform, arch: process.arch,
    nodeMajor: Number(process.versions.node.split('.')[0]), cliVersion: runtime.cliVersion,
    cliBrowserVersion: runtime.cliBrowserVersion, libraryVersion: runtime.libraryVersion,
    browserPath: runtime.browserPath, libraryBrowserPath: runtime.libraryBrowserPath };
}
