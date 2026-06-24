#!/usr/bin/env node

const path = require('path');
const fs = require('fs');
const os = require('os');
const initSqlJs = require('sql.js');

const DB_PATH = path.join(os.homedir(), '.cc-switch', 'cc-switch.db');

const SQL_QUERY = `
  SELECT name, settings_config, is_current
  FROM providers
  WHERE app_type = 'claude'
  ORDER BY is_current DESC, sort_index ASC, name ASC
`;

/**
 * Read all Claude providers from CC-Switch SQLite database.
 * Opens the DB in read-only mode (loads into memory via sql.js).
 * @returns {Promise<Array<{name: string, config: object, isCurrent: boolean}>>}
 */
async function getProviders() {
  if (!fs.existsSync(DB_PATH)) {
    throw new Error(
      `CC-Switch database not found: ${DB_PATH}\n` +
      'Please install CC-Switch and configure at least one provider first.'
    );
  }

  const buffer = fs.readFileSync(DB_PATH);
  const SQL = await initSqlJs();
  const db = new SQL.Database(buffer);

  try {
    const results = db.exec(SQL_QUERY);
    if (!results.length || !results[0].values.length) {
      throw new Error('No Claude providers found in CC-Switch database.');
    }

    return results[0].values.map(([name, settingsConfig, isCurrent]) => {
      let config;
      try {
        config = JSON.parse(settingsConfig);
      } catch {
        config = { env: {} };
      }
      return {
        name,
        config,
        isCurrent: !!isCurrent,
      };
    });
  } finally {
    db.close();
  }
}

module.exports = { getProviders, DB_PATH };
