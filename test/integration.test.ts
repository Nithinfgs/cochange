import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { after, test } from 'node:test';
import { check } from '../src/analyze.js';
import { backtest } from '../src/backtest.js';
import { DEFAULTS, loadConfig, ConfigError } from '../src/config.js';
import { readHistory, trackedFiles } from '../src/git.js';
import { renderReport } from '../src/report.js';
import { coupledRepo, makeRepo, type TestRepo } from './helpers.js';

const repos: TestRepo[] = [];
const fresh = (r: TestRepo): TestRepo => (repos.push(r), r);
after(() => repos.forEach((r) => r.cleanup()));

const CLI = resolve(import.meta.dirname, '../src/cli.js');
const cli = (dir: string, args: string[], input?: string) =>
  spawnSync(process.execPath, [CLI, ...args, '--no-color'], { cwd: dir, encoding: 'utf8', input });

test('working-tree check flags the forgotten test and doc', () => {
  const r = fresh(coupledRepo());
  writeFileSync(join(r.dir, 'src/a.ts'), 'changed');
  const res = check(r.dir, { kind: 'working' }, DEFAULTS);
  assert.deepEqual(res.suggestions.map((s) => s.file).sort(), ['docs/a.md', 'src/a.test.ts']);
  assert.deepEqual(res.changed, ['src/a.ts']);
});

test('nothing is flagged when the whole group changes', () => {
  const r = fresh(coupledRepo());
  for (const f of ['src/a.ts', 'src/a.test.ts', 'docs/a.md']) writeFileSync(join(r.dir, f), 'x');
  assert.equal(check(r.dir, { kind: 'working' }, DEFAULTS).suggestions.length, 0);
});

test('staged mode ignores unstaged edits', () => {
  const r = fresh(coupledRepo());
  writeFileSync(join(r.dir, 'src/a.ts'), 'staged');
  r.git('add', 'src/a.ts');
  writeFileSync(join(r.dir, 'src/a.test.ts'), 'unstaged only');
  const res = check(r.dir, { kind: 'staged' }, DEFAULTS);
  assert.ok(res.suggestions.some((s) => s.file === 'src/a.test.ts'));
});

test('base mode analyzes a branch without learning from its own commits', () => {
  const r = fresh(coupledRepo());
  r.git('checkout', '-q', '-b', 'feature');
  r.commit({ 'src/a.ts': 'feature edit' });
  const res = check(r.dir, { kind: 'base', base: 'main' }, DEFAULTS);
  assert.deepEqual(res.suggestions.map((s) => s.file).sort(), ['docs/a.md', 'src/a.test.ts']);
});

test('a renamed file keeps its history', () => {
  const r = fresh(coupledRepo());
  r.git('mv', 'src/a.ts', 'src/alpha.ts');
  const res = check(r.dir, { kind: 'working' }, DEFAULTS);
  assert.ok(res.suggestions.some((s) => s.file === 'src/a.test.ts'));
});

test('untracked new files do not crash and unknown files report thin history', () => {
  const r = fresh(coupledRepo());
  writeFileSync(join(r.dir, 'brand-new.ts'), 'x');
  const res = check(r.dir, { kind: 'working' }, DEFAULTS);
  assert.equal(res.suggestions.length, 0);
  assert.equal(res.insufficientHistory, true);
});

test('files with spaces and unicode survive the round trip', () => {
  const r = fresh(makeRepo());
  for (let i = 0; i < 6; i++) {
    r.commit({ 'my file.ts': `${i}`, 'ünï/tést.ts': `${i}` });
    r.commit({ [`noise${i}.ts`]: 'x' });
  }
  writeFileSync(join(r.dir, 'my file.ts'), 'edit');
  const res = check(r.dir, { kind: 'working' }, DEFAULTS);
  assert.deepEqual(
    res.suggestions.map((s) => s.file),
    ['ünï/tést.ts'],
  );
});

test('backtest recovers the planted coupling and is honest about noise', () => {
  const r = fresh(coupledRepo(14));
  const h = readHistory(r.dir, { maxCommits: 1000 });
  const t = trackedFiles(r.dir);
  const res = backtest(h, (p) => t.has(p), DEFAULTS, {
    testCommits: 30,
    trialsPerCommit: 8,
    sweep: [0.5, 0.9],
  });
  assert.ok(res.trials > 5);
  assert.ok(res.primary.recall > 0.5, `recall ${res.primary.recall}`);
  assert.ok(res.primary.nagRate < 0.2, `nag ${res.primary.nagRate}`);
  assert.equal(res.rows.length, 3);
});

test('report renders self-contained HTML with escaped names', () => {
  // `<` is not a legal file name character on Windows, so use it only elsewhere.
  const tricky = process.platform === 'win32' ? "a&b'c.ts" : 'a<script>&b.ts';
  const r = fresh(makeRepo());
  for (let i = 0; i < 6; i++) r.commit({ [tricky]: `${i}`, 'b.ts': `${i}` });
  const html = renderReport(
    r.dir,
    readHistory(r.dir, { maxCommits: 100 }),
    trackedFiles(r.dir),
    DEFAULTS,
  );
  assert.ok(html.includes('<svg id="graph"'));
  assert.ok(!html.includes('<script>&b'), 'raw markup must not reach the page');
  assert.ok(html.includes('&#38;b'), 'names are HTML-escaped in tables');
  assert.ok(!/https?:\/\//.test(html.replace(/http:\/\/www\.w3\.org\/2000\/svg/g, '')));
});

test('config validation', () => {
  const r = fresh(makeRepo());
  r.commit({ '.cochange.json': '{"minConfidence": 7}' });
  assert.throws(() => loadConfig(r.dir), ConfigError);
  r.commit({ '.cochange.json': '{"minConfidence": 0.9, "ignore": ["docs/**"]}' });
  const cfg = loadConfig(r.dir);
  assert.equal(cfg.minConfidence, 0.9);
  assert.ok(cfg.ignore.includes('docs/**') && cfg.ignore.includes('go.sum'));
});

test('cli: exit codes, formats and hook mode', () => {
  const r = fresh(coupledRepo());
  writeFileSync(join(r.dir, 'src/a.ts'), 'changed');
  const plain = cli(r.dir, ['check']);
  assert.equal(plain.status, 0);
  assert.match(plain.stdout, /src\/a\.test\.ts/);
  assert.equal(cli(r.dir, ['--strict']).status, 1);
  const json = JSON.parse(cli(r.dir, ['--format', 'json']).stdout);
  assert.equal(json.suggestions.length, 2);
  assert.match(
    cli(r.dir, ['--format', 'github']).stdout,
    /^::warning file=src\/a\.ts,title=cochange::/m,
  );
  assert.match(cli(r.dir, ['--format', 'markdown']).stdout, /<!-- cochange -->/);
  const hook = cli(r.dir, ['--hook', 'claude-stop'], '{}');
  assert.equal(hook.status, 2);
  assert.match(hook.stderr, /src\/a\.test\.ts/);
  assert.equal(cli(r.dir, ['--hook', 'claude-stop'], '{"stop_hook_active": true}').status, 0);
  assert.match(cli(r.dir, ['of', 'src/a.ts']).stdout, /docs\/a\.md/);
  assert.match(cli(r.dir, ['backtest']).stdout, /forgotten files would have been flagged/);
  assert.match(cli(r.dir, ['hook', 'claude']).stdout, /"Stop"/);
});

test('cli: errors are friendly', () => {
  const bad = spawnSync(process.execPath, [CLI, '--no-color'], { cwd: '/', encoding: 'utf8' });
  assert.equal(bad.status, 64);
  assert.match(bad.stderr, /not inside a git repository/);
  const r = fresh(makeRepo());
  r.commit({ a: '1' });
  assert.equal(cli(r.dir, ['--min-confidence', '2']).status, 64);
  assert.equal(cli(r.dir, ['--format', 'xml']).status, 64);
  assert.equal(
    execFileSync(process.execPath, [CLI, '--version'], { encoding: 'utf8' }).trim(),
    '0.1.0',
  );
});
