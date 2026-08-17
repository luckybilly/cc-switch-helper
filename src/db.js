#!/usr/bin/env node

const path = require('path');
const fs = require('fs');
const os = require('os');
const Database = require('better-sqlite3');

const DB_PATH = path.join(os.homedir(), '.cc-switch', 'cc-switch.db');

const SQL_QUERY = `
  SELECT name, settings_config, meta, is_current
  FROM providers
  WHERE app_type = 'claude'
  ORDER BY is_current DESC, sort_index ASC, name ASC
`;

const COMMON_CONFIG_KEY = 'common_config_claude';

/**
 * Open the CC-Switch SQLite database in read-only mode.
 * Opening the database by path lets SQLite include committed changes from an
 * active write-ahead log instead of reading a stale main database snapshot.
 * @returns {import('better-sqlite3').Database}
 */
function openDb() {
  if (!fs.existsSync(DB_PATH)) {
    throw new Error(
      `CC-Switch database not found: ${DB_PATH}\n` +
      'Please install CC-Switch and configure at least one provider first.'
    );
  }
  return new Database(DB_PATH, { readonly: true, fileMustExist: true });
}

/**
 * Read the Claude common config that CC-Switch merges into every provider
 * whose meta.commonConfigEnabled is true. Stored as JSON in the `settings`
 * table under the `common_config_claude` key.
 * @returns {Promise<object>} parsed common config (empty object if absent)
 */
async function getCommonConfig() {
  const db = openDb();
  try {
    const row = db
      .prepare('SELECT value FROM settings WHERE key = ?')
      .get(COMMON_CONFIG_KEY);
    if (!row) return {};
    try {
      return JSON.parse(row.value);
    } catch {
      return {};
    }
  } finally {
    db.close();
  }
}

/**
 * Read all Claude providers from CC-Switch SQLite database.
 * @returns {Promise<Array<{name: string, config: object, commonConfigEnabled: boolean, isCurrent: boolean}>>}
 */
async function getProviders() {
  const db = openDb();
  try {
    const rows = db.prepare(SQL_QUERY).all();
    if (!rows.length) {
      throw new Error('No Claude providers found in CC-Switch database.');
    }

    return rows.map(
      ({ name, settings_config: settingsConfig, meta, is_current: isCurrent }) => {
        let config;
        try {
          config = JSON.parse(settingsConfig);
        } catch {
          config = { env: {} };
        }

        let commonConfigEnabled = false;
        try {
          commonConfigEnabled = JSON.parse(meta).commonConfigEnabled === true;
        } catch {
          /* leave false */
        }

        return {
          name,
          config,
          commonConfigEnabled,
          isCurrent: !!isCurrent,
        };
      }
    );
  } finally {
    db.close();
  }
}

module.exports = { getProviders, getCommonConfig, DB_PATH };
