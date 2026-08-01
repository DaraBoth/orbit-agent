// Proves config (which holds the dgm_pat_ token) is always written 0600,
// never more permissive, regardless of the process umask or a pre-existing
// world-readable file.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'orbit-agent-test-'));
process.env.ORBIT_AGENT_HOME = tmpHome;

const { saveConfig, loadConfig, CONFIG_PATH, CONFIG_DIR } = await import('../src/config.mjs');

function mode(p) {
  return fs.statSync(p).mode & 0o777;
}

// 1) Fresh write.
saveConfig({ token: 'dgm_pat_testtoken', goalId: 'g1', role: 'dev-agent', instance: 'test' });
assert.equal(mode(CONFIG_PATH), 0o600, `config file must be 0600, got ${mode(CONFIG_PATH).toString(8)}`);
assert.equal(mode(CONFIG_DIR), 0o700, `config dir must be 0700, got ${mode(CONFIG_DIR).toString(8)}`);

const loaded = loadConfig();
assert.equal(loaded.token, 'dgm_pat_testtoken');

// 2) A pre-existing world-readable file must be tightened back to 0600 on
// the next save, not left permissive.
fs.chmodSync(CONFIG_PATH, 0o644);
assert.equal(mode(CONFIG_PATH), 0o644, 'sanity check: chmod actually widened it');
saveConfig({ token: 'dgm_pat_testtoken2', goalId: 'g1', role: 'dev-agent', instance: 'test' });
assert.equal(mode(CONFIG_PATH), 0o600, 'config file must be re-tightened to 0600 on every save, even over a widened existing file');

// 3) No stray file in the config dir is left group/world-readable — only
// config.json (0600, checked above) and the hooks/ dir should exist, and
// nothing here should be readable by anyone but the owner.
const entries = fs.readdirSync(CONFIG_DIR);
for (const entry of entries) {
  if (entry === 'hooks') continue;
  const full = path.join(CONFIG_DIR, entry);
  if (fs.statSync(full).isFile()) {
    assert.equal(mode(full) & 0o077, 0, `${entry} must not be group/world readable, got ${mode(full).toString(8)}`);
  }
}

fs.rmSync(tmpHome, { recursive: true, force: true });
console.log('test-config-permissions: OK');
