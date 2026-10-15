#!/usr/bin/env node
/**
 * verify-win.js — Windows environment probe + issue #5 reproduction / fix
 * verification for cc-switch-helper. Zero dependencies; Node.js only.
 *
 * Run (PowerShell or CMD):
 *   node verify-win.js > ccs-win-report.txt 2>&1
 * then send ccs-win-report.txt back to the maintainer.
 *
 * What it does:
 *   Part 1  Environment probe: node/npm versions, how `claude` is installed
 *           on this machine (npm .cmd shim content, native exe, versions).
 *           Claude Code does NOT need to be installed for Parts 2A–2C.
 *   Part 2A Reproduces issue #5 without claude: builds a fake npm-style
 *           .cmd shim in a temp dir and pushes hostile inline JSON through
 *           cmd.exe `%*` forwarding — the exact path that mangles settings.
 *   Part 2B Fix check, EXE-target era (claude ≥ 2.1): resolves a simulated
 *           native-binary shim and spawns the exe directly, asserting the
 *           inline JSON survives CreateProcess quoting intact.
 *   Part 2C Fix check, JS-target era (claude ≤ 2.0): resolves a simulated
 *           cli.js shim to node + script and asserts the same.
 *   Part 3  Real claude check (only if claude IS installed): resolves the
 *           real entry and runs `claude --version` through it. Harmless —
 *           no session, no login needed.
 *
 * Parts 2B/2C/3 need the FIXED ccs installed globally:
 *   npm i -g luckybilly/cc-switch-helper#fix_issue_5
 * Part 2A needs any global cc-switch-helper install (for its cross-spawn).
 */

'use strict';

const { execSync, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const results = [];

function record(name, status, detail) {
  results.push({ name, status });
  console.log(`[${status}] ${name}${detail ? ` — ${detail}` : ''}`);
}

function banner(title) {
  console.log(`\n${'='.repeat(72)}\n${title}\n${'='.repeat(72)}`);
}

function tryRequire(p) {
  try {
    return require(p);
  } catch {
    return null;
  }
}

// ── Locate the global cc-switch-helper install (provides launcher + cross-spawn) ──

function globalRoot() {
  try {
    return execSync('npm root -g', { encoding: 'utf8', windowsHide: true }).trim();
  } catch {
    return null;
  }
}

const ROOT = globalRoot();
const CCS_PKG = ROOT ? tryRequire(path.join(ROOT, 'cc-switch-helper', 'package.json')) : null;
const launcher = ROOT ? tryRequire(path.join(ROOT, 'cc-switch-helper', 'src', 'launcher.js')) : null;
const crossSpawn =
  (ROOT && tryRequire(path.join(ROOT, 'cc-switch-helper', 'node_modules', 'cross-spawn'))) ||
  (ROOT && tryRequire(path.join(ROOT, 'cross-spawn'))) ||
  tryRequire('cross-spawn');
const HAS_FIX = !!(launcher && typeof launcher.resolveClaudeEntry === 'function');

// ── Simulation fixtures: exact npm cmd-shim template output ──

const HEAD =
  '@ECHO off\r\n' +
  'GOTO start\r\n' +
  ':find_dp0\r\n' +
  'SET dp0=%~dp0\r\n' +
  'EXIT /b\r\n' +
  ':start\r\n' +
  'SETLOCAL\r\n' +
  'CALL :find_dp0\r\n';

const JS_ERA_SHIM =
  HEAD +
  '\r\n' +
  'IF EXIST "%dp0%\\node.exe" (\r\n' +
  '  SET "_prog=%dp0%\\node.exe"\r\n' +
  ') ELSE (\r\n' +
  '  SET "_prog=node"\r\n' +
  '  SET PATHEXT=%PATHEXT:;.JS;=%\r\n' +
  ')\r\n' +
  '\r\n' +
  'endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & ' +
  '"%_prog%"  "%dp0%\\node_modules\\@anthropic-ai\\claude-code\\cli.js" %*\r\n';

const EXE_ERA_SHIM =
  HEAD + '"%dp0%\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe"   %*\r\n';

// Hostile payload: quotes, cmd metacharacters, env-var expansion, spaces, CJK.
const NASTY =
  '{"env":{"A":"x&y|z^w%COMPUTERNAME%<v>","B":"quote\\"inside","C":"space 空格","D":"100%"}}';
const EXPECTED_ARGV = ['--settings', NASTY, '--version'];

const SIM = fs.mkdtempSync(path.join(os.tmpdir(), 'ccs-verify-'));

function buildJsTree() {
  const dir = path.join(SIM, 'js-era');
  const pkg = path.join(dir, 'node_modules', '@anthropic-ai', 'claude-code');
  fs.mkdirSync(pkg, { recursive: true });
  fs.writeFileSync(
    path.join(pkg, 'cli.js'),
    "require('fs').writeFileSync(process.env.CCS_ARGV_OUT, JSON.stringify(process.argv.slice(2)));"
  );
  fs.writeFileSync(path.join(dir, 'claude.cmd'), JS_ERA_SHIM);
  return dir;
}

function buildExeTree() {
  const dir = path.join(SIM, 'exe-era');
  const bin = path.join(dir, 'node_modules', '@anthropic-ai', 'claude-code', 'bin');
  fs.mkdirSync(bin, { recursive: true });
  // Stand-in PE binary: node.exe itself. It parses its command line with the
  // same standard Windows rules claude.exe does, which is what we're testing.
  fs.copyFileSync(process.execPath, path.join(bin, 'claude.exe'));
  fs.writeFileSync(path.join(dir, 'claude.cmd'), EXE_ERA_SHIM);
  return dir;
}

function readArgvDump(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function intact(received) {
  return JSON.stringify(received) === JSON.stringify(EXPECTED_ARGV);
}

// ── Part 0: platform gate ──

if (process.platform !== 'win32') {
  console.log('This script must run on Windows (win32). Detected: ' + process.platform);
  process.exit(2);
}

console.log('cc-switch-helper Windows verification — issue #5');
console.log('Generated: ' + new Date().toISOString());

// ── Part 1: environment probe ──

banner('Part 1  Environment probe');
record('platform', 'INFO', `${os.platform()} ${os.arch()} ${os.release()}`);
record('node', 'INFO', `${process.version} @ ${process.execPath}`);
try {
  record('npm', 'INFO', execSync('npm -v', { encoding: 'utf8', windowsHide: true }).trim());
} catch {
  record('npm', 'SKIP', 'npm not callable');
}
record('ccs global install', CCS_PKG ? 'INFO' : 'SKIP',
  CCS_PKG ? `cc-switch-helper@${CCS_PKG.version} @ ${ROOT}` : 'not installed');
record('ccs has fix (resolveClaudeEntry)', HAS_FIX ? 'INFO' : 'SKIP',
  HAS_FIX ? 'yes' : 'no — install with: npm i -g luckybilly/cc-switch-helper#fix_issue_5');

let whereHits = [];
try {
  whereHits = execSync('where claude', { encoding: 'utf8', windowsHide: true })
    .split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
} catch { /* not found */ }
record('where claude', whereHits.length ? 'INFO' : 'SKIP',
  whereHits.length ? whereHits.join(' | ') : 'claude not on PATH (simulation parts still run)');

for (const hit of whereHits) {
  const ext = path.extname(hit).toLowerCase();
  if (ext === '.cmd' || ext === '.bat') {
    try {
      console.log(`--- shim content: ${hit} ---`);
      console.log(fs.readFileSync(hit, 'utf8'));
      console.log('--- end shim ---');
    } catch (e) {
      console.log(`(unreadable shim ${hit}: ${e.message})`);
    }
  } else {
    try {
      const st = fs.statSync(hit);
      console.log(`--- ${hit}: binary, ${st.size} bytes ---`);
    } catch { /* ignore */ }
  }
}

const nativeExe = path.join(os.homedir(), '.local', 'bin', 'claude.exe');
record('native installer exe', fs.existsSync(nativeExe) ? 'INFO' : 'SKIP', nativeExe);

if (ROOT) {
  const ccPkg = tryRequire(path.join(ROOT, '@anthropic-ai', 'claude-code', 'package.json'));
  if (ccPkg) {
    record('claude npm package', 'INFO', `v${ccPkg.version}, bin=${JSON.stringify(ccPkg.bin)}`);
  }
}

// ── Part 2A: reproduce the bug through a simulated .cmd shim ──

banner('Part 2A  Reproduce issue #5 (simulated npm shim, no claude needed)');
if (crossSpawn) {
  const dir = buildJsTree();
  const outFile = path.join(dir, 'argv-repro.json');
  const r = crossSpawn.sync(path.join(dir, 'claude.cmd'), EXPECTED_ARGV, {
    stdio: ['ignore', 'ignore', 'pipe'],
    encoding: 'utf8',
    timeout: 30000,
    env: { ...process.env, CCS_ARGV_OUT: outFile },
  });
  const received = readArgvDump(outFile);
  if (intact(received)) {
    record('2A bug repro', 'NOT-REPRODUCED',
      'inline JSON survived the shim on this machine (unusual) — fix checks below still apply');
  } else {
    record('2A bug repro', 'REPRODUCED',
      `exit=${r.status} stderr="${(r.stderr || '').trim().split(/\r?\n/)[0] || ''}" ` +
      `target argv=${JSON.stringify(received)}`);
  }
} else {
  record('2A bug repro', 'SKIP', 'cross-spawn unavailable — install cc-switch-helper globally');
}

// ── Part 2B/2C: verify the fix on simulated installs ──

banner('Part 2B/2C  Verify fix (simulated installs, no claude needed)');
if (HAS_FIX && crossSpawn) {
  const fakeHome = path.join(SIM, 'home');
  fs.mkdirSync(fakeHome, { recursive: true });
  const fakeEnv = { USERPROFILE: fakeHome };

  // 2C — JS-target era: shim → node + cli.js, direct spawn
  {
    const dir = buildJsTree();
    const outFile = path.join(dir, 'argv-fix-js.json');
    const entry = launcher.resolveClaudeEntry(fakeEnv, () => [path.join(dir, 'claude.cmd')]);
    if (!entry || entry.kind !== 'node-script') {
      record('2C js-era resolve', 'FAIL', `resolver returned ${JSON.stringify(entry)}`);
    } else {
      record('2C js-era resolve', 'INFO',
        `nodeExe=${entry.nodeExe} script=${entry.script}`);
      crossSpawn.sync(entry.nodeExe, [entry.script, ...EXPECTED_ARGV], {
        stdio: 'ignore',
        timeout: 30000,
        env: { ...process.env, CCS_ARGV_OUT: outFile },
      });
      const received = readArgvDump(outFile);
      record('2C js-era argv round-trip', intact(received) ? 'PASS' : 'FAIL',
        `received=${JSON.stringify(received)}`);
    }
  }

  // 2B — EXE-target era: shim → native binary, direct spawn.
  // The stand-in exe is node.exe; `-e <dumper> --` makes it echo back argv.
  {
    const dir = buildExeTree();
    const outFile = path.join(dir, 'argv-fix-exe.json');
    const entry = launcher.resolveClaudeEntry(fakeEnv, () => [path.join(dir, 'claude.cmd')]);
    if (!entry || entry.kind !== 'executable') {
      record('2B exe-era resolve', 'FAIL', `resolver returned ${JSON.stringify(entry)}`);
    } else {
      record('2B exe-era resolve', 'INFO', `exe=${entry.exe}`);
      const dumpCode =
        "require('fs').writeFileSync(process.env.CCS_ARGV_OUT, JSON.stringify(process.argv.slice(1)));";
      crossSpawn.sync(entry.exe, ['-e', dumpCode, '--', ...EXPECTED_ARGV], {
        stdio: 'ignore',
        timeout: 30000,
        env: { ...process.env, CCS_ARGV_OUT: outFile },
      });
      const received = readArgvDump(outFile);
      record('2B exe-era argv round-trip', intact(received) ? 'PASS' : 'FAIL',
        `received=${JSON.stringify(received)}`);
    }
  }
} else {
  record('2B/2C fix checks', 'SKIP',
    'needs the fixed ccs: npm i -g luckybilly/cc-switch-helper#fix_issue_5');
}

// ── Part 3: real claude (only when installed) ──

banner('Part 3  Real claude check (skipped when claude is not installed)');
if (whereHits.length && HAS_FIX) {
  // Raw diagnostics: show exactly what the resolver's own eyes see, so a
  // failure pinpoints the broken stage (where.exe vs parsing vs file probe).
  try {
    const rawWhere = require('child_process')
      .execFileSync('where.exe', ['claude'], { encoding: 'utf8', windowsHide: true })
      .trim();
    console.log('launcher-side where.exe sees: ' + JSON.stringify(rawWhere.split(/\r?\n/)));
  } catch (e) {
    console.log('launcher-side where.exe FAILED: ' + e.message);
  }
  let entry = null;
  try {
    entry = launcher.resolveClaudeEntry(process.env);
  } catch (e) {
    console.log('resolveClaudeEntry THREW: ' + (e && e.stack ? e.stack : e));
  }
  console.log('resolveClaudeEntry => ' + JSON.stringify(entry));
  if (!entry) {
    record('3 real resolve', 'FAIL',
      'resolver returned null on the real install — temp-file fallback would engage; ' +
      'the diagnostics above show which stage broke');
  } else {
    record('3 real resolve', 'INFO', JSON.stringify(entry));
    const cmd = entry.kind === 'executable'
      ? [entry.exe, ['--version']]
      : [entry.nodeExe, [entry.script, '--version']];
    const r = spawnSync(cmd[0], cmd[1], { encoding: 'utf8', timeout: 60000, windowsHide: true });
    const firstLine = ((r.stdout || '') + (r.stderr || '')).trim().split(/\r?\n/)[0] || '';
    const ok = r.status === 0 && /\d+\.\d+/.test(firstLine);
    record('3 real claude --version', ok ? 'PASS' : 'FAIL', `exit=${r.status} out="${firstLine}"`);
  }
} else {
  record('Part 3', 'SKIP', whereHits.length ? 'fixed ccs not installed' : 'claude not installed');
}

// ── Summary ──

banner('Summary');
for (const r of results) console.log(`  [${r.status}] ${r.name}`);
const fails = results.filter((r) => r.status === 'FAIL').length;
console.log(`\nFAIL count: ${fails}`);

try {
  fs.rmSync(SIM, { recursive: true, force: true });
} catch { /* best effort */ }

console.log('\nDone. 请把本文件全部内容发回给维护者 / Send this entire file back to the maintainer.');
process.exit(fails > 0 ? 1 : 0);
