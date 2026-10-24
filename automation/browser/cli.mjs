import { spawn } from 'node:child_process';
import { browserRuntime, cliConfiguration } from './runtime.mjs';

try {
  const runtime = browserRuntime();
  const args = process.argv.slice(2);
  if (!args.length) args.push('--help');
  if (args.includes('open') && !args.some(arg => arg === '--config' || arg.startsWith('--config='))) {
    args.push(`--config=${cliConfiguration()}`);
  }
  const child = spawn(process.execPath, [runtime.cli, ...args], {
    cwd: runtime.root, env: runtime.environment, shell: false, windowsHide: true, stdio: 'inherit',
  });
  child.on('error', () => { console.error('Browser CLI could not start. Run the agent-led browser setup.'); process.exitCode = 1; });
  child.on('exit', code => { process.exitCode = code ?? 1; });
} catch {
  console.error('Local browser dependencies are missing. Ask the agent to follow automation/browser/README.md.');
  process.exitCode = 2;
}
