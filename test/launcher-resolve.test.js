const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  parseCmdShim,
  probeKnownLayout,
  resolveClaudeEntry,
} = require('../src/launcher');

// ── Fixtures: exact output of npm's cmd-shim template (npm/node_modules/cmd-shim/lib/index.js) ──

const HEAD =
  '@ECHO off\r\n' +
  'GOTO start\r\n' +
  ':find_dp0\r\n' +
  'SET dp0=%~dp0\r\n' +
  'EXIT /b\r\n' +
  ':start\r\n' +
  'SETLOCAL\r\n' +
  'CALL :find_dp0\r\n';

/** JS-target era (claude ≤ 2.0): shebang script → node + cli.js invocation line. */
function jsEraShim(relTarget) {
  return (
    HEAD +
    '\r\n' +
    'IF EXIST "%dp0%\\node.exe" (\r\n' +
    '  SET "_prog=%dp0%\\node.exe"\r\n' +
    ') ELSE (\r\n' +
    '  SET "_prog=node"\r\n' +
    '  SET PATHEXT=%PATHEXT:;.JS;=;%\r\n' +
    ')\r\n' +
    '\r\n' +
    'endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & ' +
    `"%_prog%"  "%dp0%\\${relTarget}" %*\r\n`
  );
}

/** EXE-target era (claude ≥ 2.1): native binary, no shebang → bare target line. */
function exeEraShim(relTarget) {
  return HEAD + `"%dp0%\\${relTarget}"   %*\r\n`;
}

const PKG_REL = path.join('node_modules', '@anthropic-ai', 'claude-code');
const PKG_REL_WIN = 'node_modules\\@anthropic-ai\\claude-code';

function makeTree(t, { shim, files = [], nodeExe = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccs-shim-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  if (shim !== null && shim !== undefined) {
    fs.writeFileSync(path.join(dir, 'claude.cmd'), shim);
  }
  for (const rel of files) {
    const p = path.join(dir, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, '');
  }
  if (nodeExe) fs.writeFileSync(path.join(dir, 'node.exe'), '');
  return dir;
}

// ── parseCmdShim ──

test('parseCmdShim: JS-target era (cli.js) shim', () => {
  const parsed = parseCmdShim(jsEraShim(PKG_REL_WIN + '\\cli.js'), 'C:\\npm');
  assert.equal(parsed.kind, 'node-script');
  assert.equal(parsed.script, path.join('C:\\npm', PKG_REL, 'cli.js'));
});

test('parseCmdShim: EXE-target era (bin/claude.exe) shim', () => {
  const parsed = parseCmdShim(exeEraShim(PKG_REL_WIN + '\\bin\\claude.exe'), 'C:\\npm');
  assert.equal(parsed.kind, 'executable');
  assert.equal(parsed.exe, path.join('C:\\npm', PKG_REL, 'bin', 'claude.exe'));
});

test('parseCmdShim: ignores the node.exe IF-EXIST setup lines', () => {
  // The JS-era invocation line must win over earlier "%dp0%\node.exe" refs —
  // those live on IF EXIST / SET lines which never contain %*.
  const parsed = parseCmdShim(jsEraShim(PKG_REL_WIN + '\\cli.js'), 'C:\\npm');
  assert.equal(parsed.kind, 'node-script');
});

test('parseCmdShim: unparseable shims return null', () => {
  assert.equal(parseCmdShim('@echo off\r\necho hello\r\n', 'C:\\x'), null);
  assert.equal(parseCmdShim('', 'C:\\x'), null);
  // pnpm-style shim: forwards through a non-%dp0% absolute path — no %dp0% ref
  assert.equal(
    parseCmdShim('@"C:\\pnpm\\nodejs\\node.exe" "C:\\pnpm\\claude" %*\r\n', 'C:\\x'),
    null
  );
});

// ── probeKnownLayout ──

test('probeKnownLayout: finds exe-era and js-era packages under the prefix', (t) => {
  const exeDir = makeTree(t, {
    shim: null,
    files: [path.join(PKG_REL, 'bin', 'claude.exe')],
  });
  assert.equal(probeKnownLayout(exeDir).kind, 'executable');

  const jsDir = makeTree(t, { shim: null, files: [path.join(PKG_REL, 'cli.js')] });
  assert.equal(probeKnownLayout(jsDir).kind, 'node-script');

  const emptyDir = makeTree(t, { shim: null });
  assert.equal(probeKnownLayout(emptyDir), null);
});

// ── resolveClaudeEntry ──

function fakeEnv(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ccs-home-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  return { USERPROFILE: home };
}

test('resolveClaudeEntry: exe-era shim resolves to the native binary', (t) => {
  const dir = makeTree(t, {
    shim: exeEraShim(PKG_REL_WIN + '\\bin\\claude.exe'),
    files: [path.join(PKG_REL, 'bin', 'claude.exe')],
  });
  const entry = resolveClaudeEntry(fakeEnv(t), () => [path.join(dir, 'claude.cmd')]);
  assert.equal(entry.kind, 'executable');
  assert.equal(entry.exe, path.join(dir, PKG_REL, 'bin', 'claude.exe'));
});

test('resolveClaudeEntry: js-era shim resolves to node + cli.js, bundled node.exe preferred', (t) => {
  const plain = makeTree(t, {
    shim: jsEraShim(PKG_REL_WIN + '\\cli.js'),
    files: [path.join(PKG_REL, 'cli.js')],
  });
  const e1 = resolveClaudeEntry(fakeEnv(t), () => [path.join(plain, 'claude.cmd')]);
  assert.equal(e1.kind, 'node-script');
  assert.equal(e1.nodeExe, 'node'); // PATH resolution, same semantics as the shim
  assert.equal(e1.script, path.join(plain, PKG_REL, 'cli.js'));

  const bundled = makeTree(t, {
    shim: jsEraShim(PKG_REL_WIN + '\\cli.js'),
    files: [path.join(PKG_REL, 'cli.js')],
    nodeExe: true,
  });
  const e2 = resolveClaudeEntry(fakeEnv(t), () => [path.join(bundled, 'claude.cmd')]);
  assert.equal(e2.nodeExe, path.join(bundled, 'node.exe'));
});

test('resolveClaudeEntry: unparseable shim falls back to probing the known layout', (t) => {
  const dir = makeTree(t, {
    shim: '@echo off\r\nsome-custom-wrapper %*\r\n',
    files: [path.join(PKG_REL, 'bin', 'claude.exe')],
  });
  const entry = resolveClaudeEntry(fakeEnv(t), () => [path.join(dir, 'claude.cmd')]);
  assert.equal(entry.kind, 'executable');
  assert.equal(entry.exe, path.join(dir, PKG_REL, 'bin', 'claude.exe'));
});

test('resolveClaudeEntry: native installer location is picked up without where.exe hits', (t) => {
  const env = fakeEnv(t);
  const nativeDir = path.join(env.USERPROFILE, '.local', 'bin');
  fs.mkdirSync(nativeDir, { recursive: true });
  const nativeExe = path.join(nativeDir, 'claude.exe');
  fs.writeFileSync(nativeExe, '');
  const entry = resolveClaudeEntry(env, () => []);
  assert.equal(entry.kind, 'executable');
  assert.equal(entry.exe, nativeExe);
});

test('resolveClaudeEntry: a real .exe on PATH wins directly', (t) => {
  const dir = makeTree(t, { shim: null, files: ['claude.exe'] });
  const entry = resolveClaudeEntry(fakeEnv(t), () => [path.join(dir, 'claude.exe')]);
  assert.equal(entry.kind, 'executable');
  assert.equal(entry.exe, path.join(dir, 'claude.exe'));
});

test('resolveClaudeEntry: returns null when nothing resolves (caller uses temp-file fallback)', (t) => {
  const dir = makeTree(t, { shim: '@echo off\r\nunknown %*\r\n' }); // no layout either
  const env = fakeEnv(t);
  const noNpm = () => null;
  assert.equal(resolveClaudeEntry(env, () => [path.join(dir, 'claude.cmd')], noNpm), null);
  // extensionless sh-shim hits are skipped, not mistaken for executables
  const ext = path.join(dir, 'claude');
  fs.writeFileSync(ext, '#!/bin/sh\n');
  assert.equal(resolveClaudeEntry(env, () => [ext], noNpm), null);
});

test('resolveClaudeEntry: npm root -g fallback resolves when where.exe finds nothing', (t) => {
  // Simulates a stripped-PATH shell: no where hits, but npm knows the prefix.
  const prefix = makeTree(t, {
    shim: null,
    files: [path.join(PKG_REL, 'bin', 'claude.exe')],
  });
  const env = fakeEnv(t);
  const entry = resolveClaudeEntry(
    env,
    () => [],
    () => path.join(prefix, 'node_modules') // npm root -g returns <prefix>/node_modules
  );
  assert.equal(entry.kind, 'executable');
  assert.equal(entry.exe, path.join(prefix, PKG_REL, 'bin', 'claude.exe'));
});

// ── Argument round-trip through the resolved node-script entry ──

test('node-script entry passes hostile inline JSON through argv intact', async (t) => {
  // Unparseable shim + valid known layout → resolution goes through the probe.
  const dir = makeTree(t, {
    shim: '@echo off\r\nweird-wrapper %*\r\n',
    files: [path.join(PKG_REL, 'cli.js')],
  });
  const dumper = path.join(dir, PKG_REL, 'cli.js');
  const outFile = path.join(dir, 'argv.json');
  const dumpCode =
    "require('fs').writeFileSync(process.env.CCS_ARGV_OUT, JSON.stringify(process.argv.slice(2)));";
  fs.writeFileSync(dumper, dumpCode);

  const entry = resolveClaudeEntry(fakeEnv(t), () => [path.join(dir, 'claude.cmd')]);
  assert.equal(entry.kind, 'node-script');

  const nasty =
    '{"env":{"KEY":"va&lue|pipe^caret%PATH%with \\"quotes\\" 空格","URL":"https://x?a=1&b=2"}}';
  const crossSpawn = require('cross-spawn');
  const child = crossSpawn(
    process.execPath,
    [entry.script, '--settings', nasty, '--version'],
    { stdio: 'ignore', env: { ...process.env, CCS_ARGV_OUT: outFile } }
  );
  await new Promise((res) => child.on('exit', res));

  const received = JSON.parse(fs.readFileSync(outFile, 'utf8'));
  assert.deepEqual(received, ['--settings', nasty, '--version']);
});
