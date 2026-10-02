import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULTS } from '../src/config.js';
import { CoIndex, buildIndex } from '../src/index.js';
import { parseLog, parseNameStatus } from '../src/git.js';
import { globToRegExp, makeMatcher } from '../src/glob.js';

const cfg = { ...DEFAULTS, minSupport: 2, minConfidence: 0.6, minLift: 1 };
const commit = (i: number, ...files: string[]) => ({
  hash: `h${i}`,
  time: 1_700_000_000 + i * 86400,
  files,
});
const all = () => true;

test('glob: basename patterns match anywhere, path patterns are anchored', () => {
  assert.ok(globToRegExp('*.min.js').test('a/b/x.min.js'));
  assert.ok(!globToRegExp('*.min.js').test('x.min.jsx'));
  assert.ok(globToRegExp('**/dist/**').test('pkg/dist/a/b.js'));
  assert.ok(globToRegExp('docs/*.md').test('docs/a.md'));
  assert.ok(!globToRegExp('docs/*.md').test('docs/x/a.md'));
  assert.ok(makeMatcher(['go.sum'])('svc/go.sum'));
});

test('parseLog follows renames back through history', () => {
  const out = '\x01h2 200\0R100\0old.ts\0new.ts\0M\0b.ts\0' + '\x01h1 100\0M\0old.ts\0M\0b.ts\0';
  const commits = parseLog(out);
  assert.equal(commits.length, 2);
  assert.deepEqual(commits[0]?.files.sort(), ['b.ts', 'new.ts']);
  assert.deepEqual(commits[1]?.files.sort(), ['b.ts', 'new.ts']);
});

test('parseNameStatus handles renames and plain changes', () => {
  const ch = parseNameStatus('M\0a.ts\0R087\0x.ts\0y.ts\0A\0z.ts\0');
  assert.deepEqual(ch, [
    { path: 'a.ts', status: 'M' },
    { path: 'y.ts', oldPath: 'x.ts', status: 'R087' },
    { path: 'z.ts', status: 'A' },
  ]);
});

test('suggest flags the missing companion with evidence', () => {
  const h = [1, 2, 3, 4].map((i) => commit(i, 'a.ts', 'a.test.ts'));
  h.push(commit(5, 'other.ts'));
  const idx = buildIndex(h.reverse(), cfg);
  const s = idx.suggest(new Set(['a.ts']), all);
  assert.equal(s.length, 1);
  assert.equal(s[0]?.file, 'a.test.ts');
  assert.equal(s[0]?.confidence, 1);
  assert.equal(s[0]?.because[0]?.support, 4);
  assert.deepEqual(idx.suggest(new Set(['a.ts', 'a.test.ts']), all), []);
});

test('single-file commits dilute confidence', () => {
  const idx = new CoIndex(cfg);
  idx.add(commit(1, 'a', 'b'));
  idx.add(commit(2, 'a', 'b'));
  idx.add(commit(3, 'a'));
  idx.add(commit(4, 'a'));
  assert.deepEqual(idx.suggest(new Set(['a']), all), []); // 2/4 = 0.5 < 0.6
});

test('bulk commits and ignored files are skipped', () => {
  const idx = new CoIndex({ ...cfg, maxFiles: 3 });
  const bulk = ['a', 'b', 'c', 'd'];
  for (let i = 0; i < 5; i++) idx.add(commit(i, ...bulk));
  assert.equal(idx.commitCount, 0);
  for (let i = 0; i < 3; i++) idx.add(commit(10 + i, 'a', 'package-lock.json', 'b'));
  assert.deepEqual(
    idx.suggest(new Set(['a']), all).map((s) => s.file),
    ['b'],
  );
});

test('lift removes files that change in nearly every commit', () => {
  const idx = new CoIndex({ ...cfg, minLift: 1.5, minConfidence: 0.5 });
  for (let i = 0; i < 10; i++) idx.add(commit(i, 'x' + i, 'CHANGELOG'));
  for (let i = 0; i < 5; i++) idx.add(commit(20 + i, 'a', 'CHANGELOG'));
  assert.deepEqual(idx.suggest(new Set(['a']), all), []);
});

test('recency decay prefers current habits', () => {
  const decayed = { ...cfg, halfLifeDays: 10, minConfidence: 0.7 };
  const idx = new CoIndex(decayed);
  for (let i = 0; i < 6; i++) idx.add(commit(i, 'a', 'old')); // long ago, together
  for (let i = 100; i < 106; i++) idx.add(commit(i, 'a')); // recently alone
  assert.deepEqual(idx.suggest(new Set(['a']), all), []);
  const flat = new CoIndex({ ...decayed, halfLifeDays: 0 });
  for (let i = 0; i < 6; i++) flat.add(commit(i, 'a', 'old'));
  for (let i = 100; i < 106; i++) flat.add(commit(i, 'a'));
  assert.equal(flat.suggest(new Set(['a']), all, { ...decayed, minConfidence: 0.4 }).length, 1);
});

test('very short half-life on long history stays finite', () => {
  const idx = new CoIndex({ ...cfg, halfLifeDays: 1 });
  for (let i = 0; i < 3000; i += 5) idx.add(commit(i, 'a', 'b'));
  const s = idx.suggest(new Set(['a']), all);
  assert.equal(s[0]?.file, 'b');
  assert.ok(Number.isFinite(s[0]?.confidence));
});

test('ignorePairs blocks both directions', () => {
  const idx = new CoIndex({ ...cfg, ignorePairs: [['a', 'b']] });
  for (let i = 0; i < 4; i++) idx.add(commit(i, 'a', 'b'));
  assert.deepEqual(idx.suggest(new Set(['a']), all), []);
  assert.deepEqual(idx.suggest(new Set(['b']), all), []);
});
