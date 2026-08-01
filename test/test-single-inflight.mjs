// Proves D3 safety constraint 5: only one execution may be in flight per
// instance at a time — a second executeMention() call while one is running
// must be rejected, not queued or run concurrently.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmpBin = fs.mkdtempSync(path.join(os.tmpdir(), 'orbit-agent-fakebin2-'));
const fakeClaude = path.join(tmpBin, 'claude');
// Sleeps briefly so there's a real window where a second call can observe
// "already in progress".
fs.writeFileSync(
  fakeClaude,
  '#!/usr/bin/env node\nsetTimeout(() => console.log(JSON.stringify({ result: "done" })), 300);\n',
);
fs.chmodSync(fakeClaude, 0o755);
process.env.PATH = `${tmpBin}:${process.env.PATH}`;

const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'orbit-agent-project2-'));
const { executeMention, isExecuting } = await import('../src/claudeRunner.mjs');

const cfg = { projectDir, allowedTools: ['Read'], maxTurns: 3 };

assert.equal(isExecuting(), false);

const first = executeMention(cfg, { id: 'd1', task_id: 't1', mentionText: 'go' });
// Give the child a moment to actually spawn before asserting in-flight state.
await new Promise((r) => setTimeout(r, 50));
assert.equal(isExecuting(), true, 'a call should be reported as in-flight while its child is running');

await assert.rejects(
  executeMention(cfg, { id: 'd2', task_id: 't2', mentionText: 'go again' }),
  /already in progress/,
  'a second concurrent execution must be rejected, not queued or run in parallel',
);

const result = await first;
assert.equal(result.summary, 'done');
assert.equal(isExecuting(), false, 'in-flight state must clear once the run completes');

fs.rmSync(tmpBin, { recursive: true, force: true });
fs.rmSync(projectDir, { recursive: true, force: true });
console.log('test-single-inflight: OK');
