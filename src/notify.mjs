// Best-effort desktop notification for D2 ("surfaces them to the operator
// (terminal + optional desktop notification)"). Zero dependencies: shells
// out to whatever native notifier the OS already has, with a fixed argv
// array (never a shell string) so notification text can never be
// interpreted as shell syntax. Never throws, never blocks the poll loop.
import { execFile } from 'node:child_process';
import { platform } from 'node:os';

function run(cmd, args) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: 3000 }, () => resolve());
  });
}

export async function notify(title, body) {
  try {
    const os = platform();
    if (os === 'darwin') {
      const script = `display notification ${JSON.stringify(body)} with title ${JSON.stringify(title)}`;
      await run('osascript', ['-e', script]);
    } else if (os === 'linux') {
      await run('notify-send', [title, body]);
    }
    // Windows / anything else: no built-in zero-dependency option — skip.
  } catch {
    // best-effort only
  }
}
