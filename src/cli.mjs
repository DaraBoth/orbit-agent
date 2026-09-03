import { runInit } from './commands/init.mjs';
import { runConnect } from './commands/connect.mjs';
import { runStatus } from './commands/status.mjs';
import { runStop } from './commands/stop.mjs';

const HELP = `orbit-agent — one-command ORBIT onboarding, plus a local NAT bridge daemon
between a laptop coding agent and ORBIT

Usage:
  orbit-agent init --token <dgm_pat_...> --goal <id> [options]
  orbit-agent connect --goal <id> --role <role> --instance <label> [options]
  orbit-agent status
  orbit-agent stop
  orbit-agent --help

Start here: \`init\` verifies your token, saves config, and wires up this
project's .claude/ (hooks, an ORBIT skill, and /orbit-inbox) in one shot —
that's the entire beginner setup:

  npx orbit-agent init --token dgm_pat_... --goal <goalId> --base-url https://your-orbit-host

init options:
  --token <token>           dgm_pat_... token (required first run; default $ORBIT_API_KEY)
  --goal <id>               ORBIT goal id to attach to (required first run)
  --base-url <url>          ORBIT base URL (default: https://orbit.vongpichdaraboth.com)
  --dir <path>              Project directory to set up (default: cwd)
  --role <role>             Agent identity role, e.g. dev-agent (defaulted if omitted)
  --instance <label>        Instance label, e.g. laptopA (defaulted from hostname if omitted)

\`init\` does not start the daemon. Run \`connect\` afterward (in the same
directory) when you want live heartbeats and @mention delivery — that's the
additional step, not the default one.

connect options:
  --goal <id>              ORBIT goal id to attach to (required first run)
  --role <role>             Agent identity role, e.g. dev-agent (required first run)
  --instance <label>        Instance label, e.g. laptopA (required first run)
  --dir <path>              Project directory to confine to (default: cwd)
  --base-url <url>          ORBIT base URL (default: https://orbit.vongpichdaraboth.com)
  --token <token>           dgm_pat_... token (default: $ORBIT_API_KEY, or reused from a saved config)
  --heartbeat-interval <s>  Heartbeat interval in seconds (default: 45)
  --poll-interval <s>       Mention poll interval in seconds (default: 20)
  --allow-execute           Enable D3 autonomous execution. OFF by default — plain
                             connect never executes anything, only observes.
  --allowed-tools <list>    Comma-separated Claude Code --allowedTools list.
                             Required with --allow-execute.
  --max-turns <n>           Max turns per autonomous run (default: 8)

Config lives at ~/.orbit-agent/config.json (chmod 0600) and is reused across
runs so you don't have to repeat every flag. See README.md, especially the
SECURITY section, before using --allow-execute.
`;

export async function main(argv) {
  const [cmd, ...rest] = argv;

  if (!cmd || cmd === '--help' || cmd === '-h' || cmd === 'help') {
    console.log(HELP);
    return;
  }

  try {
    if (rest.includes('--help') || rest.includes('-h')) {
      console.log(HELP);
      return;
    }
    if (cmd === 'init') {
      await runInit(rest);
      return;
    }
    if (cmd === 'connect') {
      await runConnect(rest);
      return;
    }
    if (cmd === 'status') {
      await runStatus(rest);
      return;
    }
    if (cmd === 'stop') {
      await runStop(rest);
      return;
    }
    console.error(`Unknown command: ${cmd}\n`);
    console.log(HELP);
    process.exitCode = 1;
  } catch (err) {
    console.error(`orbit-agent: ${err?.message || err}`);
    process.exitCode = 1;
  }
}
