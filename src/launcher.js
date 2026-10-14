#!/usr/bin/env node

const spawn = require('cross-spawn');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

/**
 * Claude Code's location under an npm global prefix. On Windows the npm bin
 * shim (claude.cmd) sits in the prefix root, so the package resolves to
 * <prefix>\node_modules\@anthropic-ai\claude-code.
 */
const CLAUDE_PKG_RELPATH = path.join('node_modules', '@anthropic-ai', 'claude-code');

/**
 * Deep-clone a JSON value (cc-switch's `Value::clone` equivalent).
 */
function cloneJson(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Mirror cc-switch's `json_deep_merge(target, source)` exactly
 * (src-tauri/src/services/provider/live.rs).
 *
 * `source` is merged into `target`:
 *  - object↔object: recurse per key — keys only in `source` are inserted,
 *    keys only in `target` are kept, shared keys recurse
 *  - any leaf or type mismatch: `source` OVERWRITES `target`
 *
 * So when called as `jsonDeepMerge(providerConfig, commonConfig)`, common
 * wins on leaf conflicts — matching cc-switch's effective-settings build.
 * Mutates and returns `target`.
 */
function jsonDeepMerge(target, source) {
  if (isPlainObject(target) && isPlainObject(source)) {
    for (const [key, sourceValue] of Object.entries(source)) {
      if (Object.prototype.hasOwnProperty.call(target, key)) {
        target[key] = jsonDeepMerge(target[key], sourceValue);
      } else {
        target[key] = cloneJson(sourceValue);
      }
    }
    return target;
  }
  return cloneJson(source);
}

/**
 * Build the effective settings object CC-Switch would write to
 * ~/.claude/settings.json for this provider.
 *
 * CC-Switch stores a shared `common_config_claude` (hooks, statusLine,
 * permissions, plugins, …) in its `settings` table. On switch it builds the
 * effective config as `json_deep_merge(provider.settings_config, common)`
 * when the provider's `meta.commonConfigEnabled` is true AND the common
 * config is non-empty; otherwise it uses the provider's settings_config
 * verbatim. We replicate that here so each `ccs` session matches what
 * CC-Switch produces — common wins on leaf conflicts, recursively.
 *
 * @param {object} commonConfig - parsed common_config_claude
 * @param {object} providerConfig - parsed settings_config from CC-Switch
 * @param {boolean} commonConfigEnabled - provider's meta.commonConfigEnabled
 * @returns {string} effective settings as compact JSON string
 */
function buildSettings(commonConfig, providerConfig, commonConfigEnabled) {
  const commonIsEmpty = !commonConfig || Object.keys(commonConfig).length === 0;
  if (!commonConfigEnabled || commonIsEmpty) {
    return JSON.stringify(providerConfig);
  }
  const result = cloneJson(providerConfig);
  jsonDeepMerge(result, commonConfig);
  return JSON.stringify(result);
}

// ── Windows: resolve claude's real entry point ───────────────────────────────
//
// Why this exists (issue #5): on Windows, `claude` installed via npm is a
// `.cmd` shim whose final line forwards arguments with `%*`. cmd.exe strips
// and re-parses quoting at every level, so an inline JSON payload passed to
// `--settings` arrives at claude.exe mangled ("系统找不到指定的路径", exit 255)
// — cross-spawn (added in 0.3.1 to fix `spawn EINVAL`) escapes the OUTER
// cmd.exe invocation correctly but cannot survive the INNER `%*` re-expansion.
// The fix: never go through the shim. Resolve what the shim points at — the
// native claude.exe (npm package ≥ 2.1 / native installer) or node.exe +
// cli.js (npm package ≤ 2.0) — and spawn that directly. A direct PE spawn
// passes arguments through CreateProcess with standard MSVCRT quoting rules,
// which round-trip embedded quotes and cmd metacharacters intact.

/**
 * Parse an npm-generated Windows .cmd shim (cmd-shim package template) and
 * find the real target it forwards to.
 *
 * Recognized invocation lines (the line containing `%*`):
 *   JS-target era (claude ≤ 2.0, cli.js has a `#!/usr/bin/env node` shebang):
 *     ... & "%_prog%"  "%dp0%\node_modules\@anthropic-ai\claude-code\cli.js" %*
 *     where _prog is "%dp0%\node.exe" when present, else bare `node`.
 *   EXE-target era (claude ≥ 2.1, bin is a native binary, no shebang):
 *     "%dp0%\node_modules\@anthropic-ai\claude-code\bin\claude.exe"  %*
 *
 * @param {string} content - raw .cmd file content
 * @param {string} shimDir - directory containing the shim (%dp0%)
 * @returns {{kind:'node-script',script:string}|{kind:'executable',exe:string}|null}
 *   null when the shim isn't npm-template shaped (pnpm shims, custom wrappers).
 */
function parseCmdShim(content, shimDir) {
  const lines = content.split(/\r?\n/);
  let invocation = null;
  for (const line of lines) {
    if (line.includes('%*')) invocation = line; // last %* line is the invocation
  }
  if (!invocation) return null;

  // Shim paths are always Windows-style; normalize so the resolver (and its
  // tests) behave identically on any platform.
  const toRel = (p) => p.split('\\').join(path.sep);
  const dp0Targets = [...invocation.matchAll(/"%dp0%\\([^"]+)"/g)].map((m) => m[1]);
  const script = dp0Targets.find((p) => p.toLowerCase().endsWith('.js'));
  if (script) {
    return { kind: 'node-script', script: path.join(shimDir, toRel(script)) };
  }
  const exe = dp0Targets.find((p) => p.toLowerCase().endsWith('.exe'));
  if (exe) {
    return { kind: 'executable', exe: path.join(shimDir, toRel(exe)) };
  }
  return null;
}

/**
 * Fallback for unparseable shims: probe npm's well-known global layout
 * relative to the shim's directory (the npm prefix root).
 */
function probeKnownLayout(shimDir) {
  const pkgDir = path.join(shimDir, CLAUDE_PKG_RELPATH);
  const exe = path.join(pkgDir, 'bin', 'claude.exe');
  if (fs.existsSync(exe)) return { kind: 'executable', exe };
  const script = path.join(pkgDir, 'cli.js');
  if (fs.existsSync(script)) return { kind: 'node-script', script };
  return null;
}

/**
 * Mirror the shim's own node selection: prefer node.exe sitting next to the
 * shim (npm does this when node was installed into the prefix), else bare
 * `node` resolved via PATH — same semantics the shim has.
 */
function nodeForShimDir(shimDir) {
  const bundled = path.join(shimDir, 'node.exe');
  return fs.existsSync(bundled) ? bundled : 'node';
}

/** Default `where.exe claude` runner; injectable for tests. */
function runWhereClaude(env) {
  try {
    const out = execFileSync('where.exe', ['claude'], {
      env,
      encoding: 'utf8',
      windowsHide: true,
      timeout: 5000,
    });
    return out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  } catch {
    return []; // not found
  }
}

/**
 * Resolve a direct (cmd.exe-free) entry point for claude on Windows.
 *
 * Candidate order: PATH hits from `where claude` (npm shim dirs, native
 * installer dirs), then the native installer's default location
 * %USERPROFILE%\.local\bin\claude.exe.
 *
 * @param {object} [env] - environment to resolve in (default process.env)
 * @param {function} [whereRunner] - injectable `where claude` (tests)
 * @returns {{kind:'executable',exe:string}|{kind:'node-script',nodeExe:string,script:string}|null}
 *   null when no direct entry could be resolved (caller falls back to the
 *   temp-file path through the shim).
 */
function resolveClaudeEntry(env = process.env, whereRunner = runWhereClaude) {
  const candidates = [...whereRunner(env)];
  const userProfile = env.USERPROFILE || os.homedir();
  candidates.push(path.join(userProfile, '.local', 'bin', 'claude.exe'));

  for (const cand of candidates) {
    const ext = path.extname(cand).toLowerCase();

    if (ext === '.exe') {
      if (fs.existsSync(cand)) {
        return { kind: 'executable', exe: cand, source: cand };
      }
      continue;
    }
    if (ext !== '.cmd' && ext !== '.bat') continue; // skip sh shims / .ps1 / extensionless
    if (!fs.existsSync(cand)) continue;

    const shimDir = path.dirname(cand);
    let parsed = null;
    try {
      parsed = parseCmdShim(fs.readFileSync(cand, 'utf8'), shimDir);
    } catch {
      parsed = null;
    }
    if (!parsed || !fs.existsSync(parsed.script ?? parsed.exe)) {
      parsed = probeKnownLayout(shimDir);
    }
    if (parsed) {
      return parsed.kind === 'node-script'
        ? { ...parsed, nodeExe: nodeForShimDir(shimDir), source: cand }
        : { ...parsed, source: cand };
    }
  }
  return null;
}

// ── Launch ────────────────────────────────────────────────────────────────────

/**
 * Resolve the claude command for the current platform.
 * On Windows, npm global bins are .cmd files. Only used by the temp-file
 * fallback path; the normal Windows path spawns the resolved entry directly.
 */
function getClaudeCmd() {
  return process.platform === 'win32' ? 'claude.cmd' : 'claude';
}

function spawnAndWait(command, args) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: 'inherit' });

    child.on('error', (err) => {
      console.error(`Failed to launch claude: ${err.message}`);
      resolve(1);
    });

    child.on('exit', (code) => {
      resolve(code ?? 0);
    });
  });
}

/**
 * Last-resort Windows path: settings JSON cannot be passed inline through the
 * .cmd shim (its `%*` forwarding mangles quotes), and no direct entry could be
 * resolved — so write the settings to a 0600 temp file, pass the FILE PATH
 * through the shim (plain quoted paths survive `%*`), and delete it on exit.
 *
 * Trade-off: provider secrets touch the disk briefly. This path should be rare
 * (unknown shim format AND unknown package layout); a warning is printed so
 * users can report their setup and get a proper resolver rule.
 */
function launchViaTempFile(tailArgs) {
  const settingsJson = tailArgs.settingsJson;
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccs-settings-'));
  const tmpFile = path.join(tmpDir, 'settings.json');
  fs.writeFileSync(tmpFile, settingsJson, { mode: 0o600 });

  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  };
  process.once('exit', cleanup);

  console.warn(
    '! Could not resolve a direct claude entry point on this system.\n' +
    `  Settings are temporarily written to ${tmpFile} (mode 600, deleted on exit).\n` +
    '  Please report your claude installation setup so ccs can resolve it directly:'
  );
  console.warn('  https://github.com/luckybilly/cc-switch-helper/issues');

  return spawnAndWait(getClaudeCmd(), [
    '--settings', tmpFile, ...tailArgs.args,
  ]).then((code) => {
    cleanup();
    return code;
  });
}

/**
 * Launch claude with the provider's effective settings passed as a JSON
 * string. `claude --settings` accepts either a file path or a JSON string.
 * @param {string} providerName - display name for log
 * @param {object} providerConfig - parsed settings_config from CC-Switch
 * @param {boolean} commonConfigEnabled - provider's meta.commonConfigEnabled
 * @param {object} commonConfig - parsed common_config_claude
 * @param {string[]} extraArgs - additional args passed to claude
 * @param {object} [opts] - options
 * @param {boolean} [opts.noSkip] - skip --dangerously-skip-permissions flag
 * @returns {Promise<number>} exit code
 */
function launch(providerName, providerConfig, commonConfigEnabled, commonConfig, extraArgs = [], opts = {}) {
  const settingsJson = buildSettings(commonConfig, providerConfig, commonConfigEnabled);

  const args = ['--settings', settingsJson];
  if (!opts.noSkip) {
    args.push('--dangerously-skip-permissions');
  }
  args.push(...extraArgs);

  console.log(`→ Launching [${providerName}]`);

  if (process.platform === 'win32') {
    // Bypass cmd.exe entirely: spawn claude's real entry point so the inline
    // JSON survives (see resolveClaudeEntry for the full rationale).
    let entry = null;
    try {
      entry = resolveClaudeEntry();
    } catch {
      entry = null;
    }

    if (entry && entry.kind === 'executable') {
      return spawnAndWait(entry.exe, args);
    }
    if (entry && entry.kind === 'node-script') {
      return spawnAndWait(entry.nodeExe, [entry.script, ...args]);
    }
    return launchViaTempFile({
      settingsJson,
      args: args.slice(2), // drop '--settings' + json; the file path replaces them
    });
  }

  // macOS / Linux: `claude` is a real executable or a shebang script handled by
  // the kernel — execve passes argv verbatim, so inline JSON is safe as-is.
  return spawnAndWait('claude', args);
}

module.exports = {
  launch,
  buildSettings,
  getClaudeCmd,
  parseCmdShim,
  probeKnownLayout,
  resolveClaudeEntry,
};
