const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const Database = require('better-sqlite3');

const CLI_PATH = path.join(__dirname, '..', 'src', 'cli.js');

test('lists providers committed to an active WAL file', async (t) => {
  const tempHome = await fs.mkdtemp(path.join(os.tmpdir(), 'ccs-wal-'));
  const ccSwitchDir = path.join(tempHome, '.cc-switch');
  const dbPath = path.join(ccSwitchDir, 'cc-switch.db');
  await fs.mkdir(ccSwitchDir);

  const writer = new Database(dbPath);
  t.after(async () => {
    writer.close();
    await fs.rm(tempHome, { recursive: true, force: true });
  });

  writer.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA wal_autocheckpoint = 0;

    CREATE TABLE providers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      settings_config TEXT NOT NULL,
      meta TEXT NOT NULL,
      is_current INTEGER NOT NULL DEFAULT 0,
      app_type TEXT NOT NULL,
      sort_index INTEGER
    );
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);

    INSERT INTO providers
      (id, name, settings_config, meta, is_current, app_type, sort_index)
    VALUES
      ('old-provider', 'ModelScope', '{"env":{}}', '{}', 0, 'claude', 1);
    INSERT INTO settings (key, value)
    VALUES ('common_config_claude', '{}');
  `);

  // Put the initial provider in the main database file, then leave the
  // replacement committed only in WAL while the writer remains connected.
  writer.exec('PRAGMA wal_checkpoint(TRUNCATE);');
  writer.exec(`
    BEGIN;
    DELETE FROM providers WHERE id = 'old-provider';
    INSERT INTO providers
      (id, name, settings_config, meta, is_current, app_type, sort_index)
    VALUES
      ('new-provider', 'Bailian', '{"env":{}}', '{}', 0, 'claude', 1);
    COMMIT;
  `);

  const wal = await fs.stat(`${dbPath}-wal`);
  assert.ok(wal.size > 32, 'fixture must contain committed WAL frames');

  const stdout = execFileSync(process.execPath, [CLI_PATH, '--list'], {
    encoding: 'utf8',
    env: {
      ...process.env,
      HOME: tempHome,
      USERPROFILE: tempHome,
    },
  });

  assert.match(stdout, /Bailian/);
  assert.doesNotMatch(stdout, /ModelScope/);
});
