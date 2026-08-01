// Runs every test/*.mjs file (except this one) as a separate process, each
// exiting non-zero on failure — so a single `npm test` both isolates state
// between tests (each sets its own ORBIT_AGENT_HOME/PATH) and reports a
// clear pass/fail per file.
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const files = readdirSync(__dirname)
  .filter((f) => f.endsWith('.mjs') && f !== 'run-all.mjs')
  .sort();

let failed = 0;
for (const file of files) {
  const full = path.join(__dirname, file);
  const res = spawnSync(process.execPath, [full], { stdio: 'inherit' });
  if (res.status !== 0) {
    failed += 1;
    console.error(`FAILED: ${file}`);
  }
}

if (failed > 0) {
  console.error(`\n${failed} of ${files.length} test file(s) failed.`);
  process.exit(1);
} else {
  console.log(`\nAll ${files.length} test files passed.`);
}
