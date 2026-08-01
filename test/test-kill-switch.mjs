// Proves D3 safety constraint 7: killInFlight() reliably terminates a
// running execution (the mechanism both SIGINT/Ctrl-C and `orbit-agent
// stop` route through — see daemon.mjs's shutdown()).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmpBin = fs.mkdtempSync(path.join(os.tmpdir(), 'orbit-agent-fakebin3-'));
const fakeClaude = path.join(tmpBin, 'claude');
// A "run" that never finishes on its own — only a kill signal ends it.
fs.writeFileSync(fakeClaude, '#!/usr/bin/env node\nsetInterval(() => {}, 1000);\n');
fs.chmodSync(fakeClaude, 0o755);
process.env.PATH = `${tmpBin}:${process.env.PATH}`;

const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'orbit-agent-project3-'));
const { executeMention, killInFlight, isExecuting } = await import('../src/claudeRunner.mjs');

const cfg = { projectDir, allowedTools: ['Read'], maxTurns: 3 };

const runPromise = executeMention(cfg, { id: 'd1', task_id: 't1', mentionText: 'hang forever' });
await new Promise((r) => setTimeout(r, 100));
assert.equal(isExecuting(), true);

killInFlight();

await assert.rejects(runPromise, /exited with code|SIGTERM/i);

await new Promise((r) => setTimeout(r, 50));
assert.equal(isExecuting(), false, 'in-flight state must clear once the killed child exits');

fs.rmSync(tmpBin, { recursive: true, force: true });
fs.rmSync(projectDir, { recursive: true, force: true });
console.log('test-kill-switch: OK');
