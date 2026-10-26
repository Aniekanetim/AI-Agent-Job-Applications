import { spawn } from 'node:child_process';
import { browserRuntime, launchArguments, launchEnvironment, saveBrowserVisibility } from './runtime.mjs';

try {
  const runtime = browserRuntime();
  let args = process.argv.slice(2);
  if (!args.length) args.push('--help');
  if (args[0] === 'visibility') {
    const mode = args[args.indexOf('--mode') + 1], source = args[args.indexOf('--source') + 1];
    if (!args.includes('--mode') || !args.includes('--source')) throw new Error('Supply --mode headed|headless and --source with the actual user instruction.');
    saveBrowserVisibility(runtime.root, mode, source);
    console.log(`Browser visibility saved: ${mode}. Existing sessions keep their current mode. Verify the new mode before refreshing readiness.`);
  } else {
    const environment = launchEnvironment(args, runtime.root, runtime.environment);
    args = launchArguments(args, runtime.root);
    const child = spawn(process.execPath, [runtime.cli, ...args], {
      cwd: runtime.root, env: environment, shell: false, windowsHide: true, stdio: 'inherit',
    });
    child.on('error', () => { console.error('Browser CLI could not start. Run the agent-led browser setup.'); process.exitCode = 1; });
    child.on('exit', code => { process.exitCode = code ?? 1; });
  }
} catch {
  console.error('Browser setup or configuration needs attention. Ask the agent to follow automation/browser/README.md; existing sessions and configuration are preserved.');
  process.exitCode = 2;
}
