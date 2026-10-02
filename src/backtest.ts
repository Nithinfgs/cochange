import type { Commit } from './git.js';
import type { Config } from './config.js';
import { CoIndex } from './index.js';

export interface BacktestRow {
  minConfidence: number;
  /** Share of deliberately omitted files that were flagged. */
  recall: number;
  /** Share of raised flags that pointed at the omitted file. */
  precision: number;
  /** Share of complete commits that would have drawn at least one warning. */
  nagRate: number;
}

export interface BacktestResult {
  commits: number;
  trials: number;
  trainingCommits: number;
  rows: BacktestRow[];
  /** Row for the configured threshold. */
  primary: BacktestRow;
}

export interface BacktestOptions {
  testCommits: number;
  /** Max files per commit to hold out. */
  trialsPerCommit: number;
  sweep: number[];
}

/**
 * Replays history: for each recent commit, trains only on earlier commits, then
 *  - hides one file at a time and checks whether it gets flagged (recall/precision), and
 *  - runs the check on the full commit to see how often a complete change would be nagged.
 */
export function backtest(
  history: readonly Commit[],
  exists: (p: string) => boolean,
  cfg: Config,
  opts: BacktestOptions,
): BacktestResult {
  const chrono = [...history].reverse();
  const idx = new CoIndex(cfg);
  const usable = chrono.map((c) => ({ c, files: idx.usableFiles(c) }));
  const eligible = usable.filter((u) => u.files && u.files.length >= 2).length;
  const testFrom = Math.max(0, eligible - opts.testCommits);

  const thresholds = [...new Set([...opts.sweep, cfg.minConfidence])].sort((a, b) => a - b);
  const floor = Math.min(...thresholds);
  const acc = new Map(thresholds.map((t) => [t, { hits: 0, flags: 0, nags: 0 }]));
  let trials = 0;
  let tested = 0;
  let seen = 0;
  let training = 0;

  for (const { c, files } of usable) {
    if (files && files.length >= 2) {
      if (seen >= testFrom) {
        tested++;
        const full = idx.suggest(new Set(files), exists, { ...cfg, minConfidence: floor });
        for (const t of thresholds) {
          if (full.some((s) => s.confidence >= t)) (acc.get(t) as { nags: number }).nags++;
        }
        const holdable = files.filter(exists).slice(0, opts.trialsPerCommit);
        for (const x of holdable) {
          trials++;
          const rest = new Set(files.filter((f) => f !== x));
          const flags = idx.suggest(rest, exists, { ...cfg, minConfidence: floor });
          for (const t of thresholds) {
            const a = acc.get(t) as { hits: number; flags: number };
            for (const s of flags) {
              if (s.confidence < t) continue;
              a.flags++;
              if (s.file === x) a.hits++;
            }
          }
        }
      } else {
        training++;
      }
      seen++;
    }
    idx.add(c);
  }

  const rows: BacktestRow[] = thresholds.map((t) => {
    const a = acc.get(t) as { hits: number; flags: number; nags: number };
    return {
      minConfidence: t,
      recall: trials ? a.hits / trials : 0,
      precision: a.flags ? a.hits / a.flags : 0,
      nagRate: tested ? a.nags / tested : 0,
    };
  });
  return {
    commits: tested,
    trials,
    trainingCommits: training,
    rows,
    primary: rows.find((r) => r.minConfidence === cfg.minConfidence) as BacktestRow,
  };
}
