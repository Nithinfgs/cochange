#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { check } from './analyze.js';
import { backtest } from './backtest.js';
import { ConfigError, loadConfig, type Config } from './config.js';
import { formatBacktest, formatCheck, formatPartners, makeStyle, type Format } from './format.js';
import { GitError, type DiffMode, readHistory, repoRoot, trackedFiles } from './git.js';
import { snippet } from './hooks.js';
import { buildIndex } from './index.js';
import { renderReport } from './report.js';

const HELP = `cochange: flag the files you forgot to change, learned from your git history

Usage
  cochange [check] [options]       Compare your current change with history
  cochange of <file>               Show what usually changes with a file
  cochange backtest [--sweep]      Measure accuracy on this repo's own history
  cochange report [-o file.html]   Write a shareable HTML coupling report
  cochange hook <claude|pre-commit|github>   Print integration snippets

Check scope (default: all uncommitted changes)
  --staged             only staged changes
  --base <ref>         changes since the merge-base with <ref> (for PRs)
  --files a,b          treat these paths as the change

Options
  --repo <dir>             repository (default: current directory)
  --format <fmt>           text | json | markdown | github
  --strict                 exit 1 when something looks forgotten
  --hook claude-stop       Claude Code Stop hook mode (exit 2 + stderr)
  --min-confidence <0-1>   --min-support <n>   --min-lift <x>
  --max-commits <n>        --since <date>      --max-files <n>
  --half-life <days>       recency half-life, 0 disables
  --config <path>          config file (default: .cochange.json)
  --limit <n>              rows for "of" (default 12)
  --commits <n>            backtest window (default 300)
  --color / --no-color     force or disable ANSI colors
  -v, --version  -h, --help
`;

interface Args {
  cmd: string;
  positional: string[];
  flags: Map<string, string | true>;
}

const VALUE_FLAGS = new Set([
  'repo',
  'format',
  'hook',
  'min-confidence',
  'min-support',
  'min-lift',
  'max-commits',
  'since',
  'max-files',
  'half-life',
  'config',
  'limit',
  'commits',
  'base',
  'files',
  'o',
  'output',
]);

function parseArgs(argv: string[]): Args {
  const flags = new Map<string, string | true>();
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] as string;
    if (a === '-h') flags.set('help', true);
    else if (a === '-v') flags.set('version', true);
    else if (a === '-o') flags.set('o', argv[++i] ?? '');
    else if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      const name = eq > 0 ? a.slice(2, eq) : a.slice(2);
      if (VALUE_FLAGS.has(name)) {
        const v = eq > 0 ? a.slice(eq + 1) : argv[++i];
        if (v === undefined) throw new UsageError(`--${name} needs a value`);
        flags.set(name, v);
      } else {
        flags.set(name, true);
      }
    } else positional.push(a);
  }
  const first = positional[0];
  const cmds = ['check', 'of', 'backtest', 'report', 'hook'];
  if (first && cmds.includes(first)) positional.shift();
  return { cmd: first && cmds.includes(first) ? first : 'check', positional, flags };
}

class UsageError extends Error {}

function numFlag(
  flags: Args['flags'],
  name: string,
  min: number,
  max = Infinity,
): number | undefined {
  const v = flags.get(name);
  if (v === undefined) return undefined;
  const n = Number(v);
  if (typeof v !== 'string' || !Number.isFinite(n) || n < min || n > max) {
    throw new UsageError(`--${name} must be a number between ${min} and ${max}`);
  }
  return n;
}

function applyOverrides(cfg: Config, flags: Args['flags']): Config {
  const out = { ...cfg };
  out.minConfidence = numFlag(flags, 'min-confidence', 0, 1) ?? out.minConfidence;
  out.minSupport = numFlag(flags, 'min-support', 1) ?? out.minSupport;
  out.minLift = numFlag(flags, 'min-lift', 0) ?? out.minLift;
  out.maxCommits = numFlag(flags, 'max-commits', 10) ?? out.maxCommits;
  out.maxFiles = numFlag(flags, 'max-files', 2) ?? out.maxFiles;
  out.halfLifeDays = numFlag(flags, 'half-life', 0) ?? out.halfLifeDays;
  const since = flags.get('since');
  if (typeof since === 'string') out.since = since;
  return out;
}

function diffMode(flags: Args['flags']): DiffMode {
  const files = flags.get('files');
  if (typeof files === 'string') return { kind: 'files', files: files.split(',').filter(Boolean) };
  const base = flags.get('base');
  if (typeof base === 'string') return { kind: 'base', base };
  if (flags.get('staged')) return { kind: 'staged' };
  return { kind: 'working' };
}

function readStdinJson(): Record<string, unknown> {
  if (process.stdin.isTTY) return {};
  try {
    return JSON.parse(readFileSync(0, 'utf8')) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function main(argv: string[]): number {
  const { cmd, positional, flags } = parseArgs(argv);
  if (flags.get('help')) {
    process.stdout.write(HELP);
    return 0;
  }
  if (flags.get('version')) {
    const pkg = createRequire(import.meta.url)('../../package.json') as { version: string };
    process.stdout.write(`${pkg.version}\n`);
    return 0;
  }
  if (cmd === 'hook') {
    const text = snippet(positional[0] ?? '');
    if (!text) throw new UsageError('usage: cochange hook <claude|pre-commit|github>');
    process.stdout.write(`${text}\n`);
    return 0;
  }

  const hookMode = flags.get('hook');
  if (hookMode !== undefined && hookMode !== 'claude-stop') {
    throw new UsageError('--hook only supports "claude-stop"');
  }
  if (hookMode === 'claude-stop' && readStdinJson().stop_hook_active === true) return 0;

  const root = repoRoot(resolve(String(flags.get('repo') ?? '.')));
  const configFlag = flags.get('config');
  const cfg = applyOverrides(
    loadConfig(root, typeof configFlag === 'string' ? configFlag : undefined),
    flags,
  );
  const color =
    !flags.get('no-color') &&
    !process.env.NO_COLOR &&
    (Boolean(flags.get('color')) || Boolean(process.stdout.isTTY));
  const style = makeStyle(color);

  if (cmd === 'of') {
    const file = positional[0];
    if (!file) throw new UsageError('usage: cochange of <file>');
    const idx = buildIndex(
      readHistory(root, { maxCommits: cfg.maxCommits, since: cfg.since }),
      cfg,
    );
    const tracked = trackedFiles(root);
    const limit = numFlag(flags, 'limit', 1) ?? 12;
    const list = idx
      .partners(file.replace(/^\.\//, ''), cfg.minSupport)
      .filter((p) => tracked.has(p.file));
    process.stdout.write(`${formatPartners(file, list, limit, style)}\n`);
    return 0;
  }

  if (cmd === 'backtest') {
    const history = readHistory(root, { maxCommits: cfg.maxCommits, since: cfg.since });
    const tracked = trackedFiles(root);
    const sweep = flags.get('sweep') ? [0.5, 0.6, 0.7, 0.8, 0.9] : [];
    const res = backtest(history, (p) => tracked.has(p), cfg, {
      testCommits: numFlag(flags, 'commits', 20) ?? 300,
      trialsPerCommit: 8,
      sweep,
    });
    if (flags.get('format') === 'json') process.stdout.write(`${JSON.stringify(res, null, 2)}\n`);
    else if (res.trials === 0) {
      process.stdout.write('Not enough multi-file commits in this history to backtest.\n');
    } else process.stdout.write(`${formatBacktest(res, cfg, style)}\n`);
    return 0;
  }

  if (cmd === 'report') {
    const out = String(flags.get('o') ?? flags.get('output') ?? 'cochange-report.html');
    const history = readHistory(root, { maxCommits: cfg.maxCommits, since: cfg.since });
    const tracked = trackedFiles(root);
    const html = renderReport(root, history, tracked, cfg);
    writeFileSync(out, html);
    process.stdout.write(`Wrote ${out}\n`);
    return 0;
  }

  const fmt = String(flags.get('format') ?? 'text') as Format;
  if (!['text', 'json', 'markdown', 'github'].includes(fmt)) {
    throw new UsageError('--format must be text, json, markdown or github');
  }
  const res = check(root, diffMode(flags), cfg);
  const found = res.suggestions.length > 0;
  if (hookMode === 'claude-stop') {
    if (!found) return 0;
    const lines = res.suggestions
      .slice(0, 8)
      .map(
        (s) =>
          `- ${s.file} (${Math.round(s.confidence * 100)}%, usually changes with ${s.because[0]?.file})`,
      );
    process.stderr.write(
      `cochange: files that usually change together with your edits were not touched:\n${lines.join('\n')}\n` +
        'Check whether they need updating. If not, say why and finish.\n',
    );
    return 2;
  }
  const out = formatCheck(res, cfg, fmt, style);
  if (out) process.stdout.write(`${out}\n`);
  return found && flags.get('strict') ? 1 : 0;
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (err) {
  if (err instanceof UsageError || err instanceof ConfigError || err instanceof GitError) {
    process.stderr.write(`cochange: ${err.message}\n`);
    process.exitCode = 64;
  } else {
    throw err;
  }
}
