#!/usr/bin/env node

const { getProviders } = require('./db');
const { launch } = require('./launcher');

// ── Colors (ANSI, works on all terminals including Windows Terminal) ──────────
const c = {
  green:  (s) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  red:    (s) => `\x1b[31m${s}\x1b[0m`,
  dim:    (s) => `\x1b[2m${s}\x1b[0m`,
  bold:   (s) => `\x1b[1m${s}\x1b[0m`,
  cyan:   (s) => `\x1b[36m${s}\x1b[0m`,
};

// ── Argument parsing ─────────────────────────────────────────────────────────
function parseArgs(argv) {
  // Strip node and script path
  const args = argv.slice(2);

  // Split on '--' separator: before = ccs args, after = claude args
  const sepIdx = args.indexOf('--');
  const ccsArgs  = sepIdx >= 0 ? args.slice(0, sepIdx) : args;
  const claudeArgs = sepIdx >= 0 ? args.slice(sepIdx + 1) : [];

  let showHelp = false;
  let showList = false;
  let query = null;

  for (const arg of ccsArgs) {
    if (arg === '-h' || arg === '--help') {
      showHelp = true;
    } else if (arg === '-l' || arg === '--list') {
      showList = true;
    } else if (!arg.startsWith('-')) {
      query = arg;
    }
  }

  return { showHelp, showList, query, claudeArgs };
}

// ── Help ─────────────────────────────────────────────────────────────────────
function printHelp() {
  console.log(`
${c.bold('ccs')} — CC-Switch CLI companion: switch Claude Code providers

${c.bold('USAGE')}
  ccs                       Interactive provider selection
  ccs <name>                Fuzzy-match provider by name
  ccs <name> -- <args...>   Pass extra arguments to claude
  ccs --list                List all configured providers

${c.bold('OPTIONS')}
  -l, --list    List providers without launching
  -h, --help    Show this help message

${c.bold('EXAMPLES')}
  ccs                   # pick from interactive menu
  ccs zcy               # launch with provider matching "zcy"
  ccs DeepSeek -- -r    # launch DeepSeek provider with --resume

${c.bold('PREREQUISITES')}
  Install CC-Switch and configure at least one Claude provider.
`);
}

// ── List ─────────────────────────────────────────────────────────────────────
function printList(providers) {
  console.log(c.bold('Configured Claude providers:\n'));
  providers.forEach((p, i) => {
    const marker = p.isCurrent ? c.green(' ● current') : '';
    console.log(`  ${c.dim(String(i + 1).padStart(2))}  ${p.name}${marker}`);
  });
  console.log();
}

// ── Fuzzy match ──────────────────────────────────────────────────────────────
function fuzzyMatch(providers, query) {
  const q = query.toLowerCase();
  const matches = providers.filter((p) => p.name.toLowerCase().includes(q));

  if (!matches.length) {
    const available = providers.map((p) => p.name).join(' / ');
    console.error(c.red(`No provider matching "${query}".`));
    console.error(c.dim(`Available: ${available}`));
    return null;
  }

  // Prefer is_current among matches, then first match
  const preferred = matches.find((m) => m.isCurrent) || matches[0];

  if (matches.length > 1) {
    const names = matches.map((m) => m.name).join(', ');
    console.log(c.yellow(`Multiple matches: ${names}`));
    console.log(c.dim(`Using: ${preferred.name}${preferred.isCurrent ? ' (current)' : ''}`));
  }

  return preferred;
}

// ── Interactive menu ─────────────────────────────────────────────────────────
async function interactiveSelect(providers) {
  const prompts = require('prompts');

  const choices = providers.map((p) => ({
    title: p.isCurrent ? `${p.name} ${c.green('(current)')}` : p.name,
    value: p,
  }));

  const { selected } = await prompts({
    type: 'select',
    name: 'selected',
    message: 'Select a provider',
    choices,
  });

  return selected || null;
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const { showHelp, showList, query, claudeArgs } = parseArgs(process.argv);

  if (showHelp) {
    printHelp();
    process.exit(0);
  }

  let providers;
  try {
    providers = await getProviders();
  } catch (err) {
    console.error(c.red(err.message));
    process.exit(1);
  }

  if (showList) {
    printList(providers);
    process.exit(0);
  }

  let selected;
  if (query) {
    selected = fuzzyMatch(providers, query);
  } else {
    selected = await interactiveSelect(providers);
  }

  if (!selected) {
    process.exit(0);
  }

  const code = await launch(selected.name, selected.config, claudeArgs);
  process.exit(code);
}

main();
