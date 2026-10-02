import { type Change, type DiffMode, collectChanges, readHistory, trackedFiles } from './git.js';
import { type Config } from './config.js';
import { buildIndex, type CoIndex, type Suggestion } from './index.js';
import { makeMatcher } from './glob.js';

export interface CheckResult {
  changed: string[];
  suggestions: Suggestion[];
  historyCommits: number;
  /** True when no changed file had enough history to say anything. */
  insufficientHistory: boolean;
}

export function check(root: string, mode: DiffMode, cfg: Config): CheckResult {
  const { changes, rev } = collectChanges(root, mode);
  const history = readHistory(root, { rev, maxCommits: cfg.maxCommits, since: cfg.since });
  const idx = buildIndex(history, cfg);
  const tracked = trackedFiles(root);
  return evaluate(idx, changes, tracked, cfg);
}

export function evaluate(
  idx: CoIndex,
  changes: Change[],
  tracked: ReadonlySet<string>,
  cfg: Config,
): CheckResult {
  const ignored = makeMatcher(cfg.ignore);
  const inDiff = new Set<string>();
  const lookups = new Set<string>();
  for (const c of changes) {
    inDiff.add(c.path);
    if (c.oldPath) inDiff.add(c.oldPath);
    if (!ignored(c.path)) lookups.add(c.oldPath ?? c.path);
  }
  const suggestions = idx
    .suggest(new Set([...lookups, ...inDiff]), (p) => tracked.has(p) && !inDiff.has(p), cfg)
    .filter((s) => !inDiff.has(s.file));
  const known = [...lookups].some((f) => idx.touches(f) >= cfg.minSupport);
  return {
    changed: [...inDiff],
    suggestions,
    historyCommits: idx.commitCount,
    insufficientHistory: lookups.size > 0 && !known,
  };
}
