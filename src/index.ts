import type { Commit } from './git.js';
import type { Config } from './config.js';
import { makeMatcher } from './glob.js';

const MAX_EXP = 400;

interface Tally {
  /** Raw commit count. */
  n: number;
  /** Recency-weighted count (scaled by a constant factor that cancels in ratios). */
  s: number;
}

export interface Reason {
  file: string;
  support: number;
  total: number;
  confidence: number;
}

export interface Suggestion {
  file: string;
  confidence: number;
  support: number;
  lift: number;
  because: Reason[];
}

/** Incremental co-change statistics. Feed commits oldest-first. */
export class CoIndex {
  private files = new Map<string, Tally>();
  private adj = new Map<string, Map<string, Tally>>();
  private commits = 0;
  private t0: number | undefined;
  private readonly isIgnored: (p: string) => boolean;
  private readonly pairBlock = new Set<string>();

  constructor(private readonly cfg: Config) {
    this.isIgnored = makeMatcher(cfg.ignore);
    for (const [a, b] of cfg.ignorePairs) {
      this.pairBlock.add(`${a}\0${b}`);
      this.pairBlock.add(`${b}\0${a}`);
    }
  }

  get commitCount(): number {
    return this.commits;
  }

  get fileCount(): number {
    return this.files.size;
  }

  /** Files that survive ignore rules, or undefined when the commit is a bulk edit. */
  usableFiles(c: Commit): string[] | undefined {
    const files = c.files.filter((f) => !this.isIgnored(f));
    if (files.length === 0 || files.length > this.cfg.maxFiles) return undefined;
    return files;
  }

  add(c: Commit): void {
    const files = this.usableFiles(c);
    if (!files) return;
    this.t0 ??= c.time;
    let w = 1;
    if (this.cfg.halfLifeDays > 0) {
      const halfLife = this.cfg.halfLifeDays * 86400;
      let exp = (c.time - this.t0) / halfLife;
      if (exp > MAX_EXP) {
        // Rebase so weights stay finite for very long histories with short half-lives.
        this.rescale(2 ** -exp);
        this.t0 = c.time;
        exp = 0;
      }
      w = 2 ** exp;
    }
    this.commits++;
    for (const a of files) {
      bump(this.files, a, w);
      if (files.length < 2) continue;
      let row = this.adj.get(a);
      if (!row) this.adj.set(a, (row = new Map()));
      for (const b of files) if (b !== a) bump(row, b, w);
    }
  }

  private rescale(factor: number): void {
    for (const t of this.files.values()) t.s *= factor;
    for (const row of this.adj.values()) for (const t of row.values()) t.s *= factor;
  }

  /** Total raw commits that touched a file. */
  touches(file: string): number {
    return this.files.get(file)?.n ?? 0;
  }

  /** Files that usually change with `file`, strongest first. */
  partners(file: string, minSupport = 1): Suggestion[] {
    const base = this.files.get(file);
    const row = this.adj.get(file);
    if (!base || !row) return [];
    const out: Suggestion[] = [];
    for (const [other, t] of row) {
      if (t.n < minSupport) continue;
      out.push(this.make(file, base, other, t));
    }
    return out.sort((x, y) => y.confidence - x.confidence || y.support - x.support);
  }

  /**
   * Companions of the changed files that are missing from the change set.
   * `exists` filters candidates (e.g. to files still present in the repository).
   */
  suggest(
    changed: ReadonlySet<string>,
    exists: (p: string) => boolean,
    thresholds: Pick<Config, 'minConfidence' | 'minSupport' | 'minLift'> = this.cfg,
  ): Suggestion[] {
    const best = new Map<string, Suggestion>();
    for (const a of changed) {
      const base = this.files.get(a);
      const row = this.adj.get(a);
      if (!base || !row || base.n < thresholds.minSupport) continue;
      for (const [b, t] of row) {
        if (changed.has(b) || t.n < thresholds.minSupport || !exists(b)) continue;
        if (this.pairBlock.has(`${a}\0${b}`)) continue;
        const s = this.make(a, base, b, t);
        if (s.confidence < thresholds.minConfidence || s.lift < thresholds.minLift) continue;
        const prev = best.get(b);
        if (!prev) {
          best.set(b, s);
        } else {
          prev.because.push(...s.because);
          if (s.confidence > prev.confidence) {
            prev.confidence = s.confidence;
            prev.support = s.support;
            prev.lift = s.lift;
          }
        }
      }
    }
    const list = [...best.values()];
    for (const s of list) {
      s.because.sort((x, y) => y.confidence - x.confidence || y.support - x.support);
      s.because = s.because.slice(0, 3);
    }
    return list.sort((x, y) => y.confidence - x.confidence || y.support - x.support);
  }

  /** Strongest undirected pairs (confidence is the higher of the two directions). */
  pairs(limit: number): { a: string; b: string; support: number; confidence: number }[] {
    const out: { a: string; b: string; support: number; confidence: number }[] = [];
    for (const [a, row] of this.adj) {
      const baseA = this.files.get(a) as Tally;
      for (const [b, t] of row) {
        if (a >= b || t.n < this.cfg.minSupport) continue;
        const baseB = this.files.get(b) as Tally;
        const ab = this.make(a, baseA, b, t);
        const ba = this.make(b, baseB, a, t);
        const best = ab.confidence >= ba.confidence ? ab : ba;
        if (best.confidence < this.cfg.minConfidence || best.lift < this.cfg.minLift) continue;
        out.push({ a, b, support: t.n, confidence: best.confidence });
      }
    }
    return out.sort((x, y) => y.support - x.support || y.confidence - x.confidence).slice(0, limit);
  }

  /** Files ranked by how many strong partners they have. */
  hubs(limit: number): { file: string; touches: number; partners: number }[] {
    const rows: { file: string; touches: number; partners: number }[] = [];
    for (const [file, t] of this.files) {
      const partners = this.partners(file, this.cfg.minSupport).filter(
        (p) => p.confidence >= this.cfg.minConfidence && p.lift >= this.cfg.minLift,
      ).length;
      if (partners > 0) rows.push({ file, touches: t.n, partners });
    }
    return rows.sort((a, b) => b.partners - a.partners || b.touches - a.touches).slice(0, limit);
  }

  private make(a: string, base: Tally, b: string, t: Tally): Suggestion {
    const confidence = Math.min(1, t.s / base.s);
    const bTouches = this.files.get(b)?.n ?? 1;
    const lift = confidence / (bTouches / this.commits);
    return {
      file: b,
      confidence,
      support: t.n,
      lift,
      because: [{ file: a, support: t.n, total: base.n, confidence }],
    };
  }
}

function bump(map: Map<string, Tally>, key: string, w: number): void {
  const t = map.get(key);
  if (t) {
    t.n++;
    t.s += w;
  } else {
    map.set(key, { n: 1, s: w });
  }
}

/** Builds an index from a newest-first history list. */
export function buildIndex(history: readonly Commit[], cfg: Config): CoIndex {
  const idx = new CoIndex(cfg);
  for (let i = history.length - 1; i >= 0; i--) idx.add(history[i] as Commit);
  return idx;
}
