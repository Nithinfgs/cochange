import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface Config {
  /** Minimum weighted P(companion changes | file changes). */
  minConfidence: number;
  /** Minimum number of commits that touched both files. */
  minSupport: number;
  /** Minimum lift over the companion's base rate (filters files that change in every commit). */
  minLift: number;
  /** Commits touching more files than this are treated as bulk edits and skipped. */
  maxFiles: number;
  /** Older evidence counts for half as much every N days. 0 disables decay. */
  halfLifeDays: number;
  maxCommits: number;
  since?: string;
  ignore: string[];
  /** Pairs that must never be reported, in either direction. */
  ignorePairs: [string, string][];
}

export const DEFAULT_IGNORE = [
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'bun.lockb',
  'bun.lock',
  'Cargo.lock',
  'poetry.lock',
  'uv.lock',
  'Pipfile.lock',
  'go.sum',
  'Gemfile.lock',
  'composer.lock',
  'flake.lock',
  '*.min.js',
  '*.min.css',
  '*.map',
  '**/node_modules/**',
  '**/vendor/**',
  '**/dist/**',
];

export const DEFAULTS: Config = {
  minConfidence: 0.8,
  minSupport: 4,
  minLift: 2,
  maxFiles: 25,
  halfLifeDays: 365,
  maxCommits: 3000,
  ignore: [...DEFAULT_IGNORE],
  ignorePairs: [],
};

export class ConfigError extends Error {}

const num = (v: unknown, name: string, min: number, max = Infinity): number => {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) {
    throw new ConfigError(`"${name}" must be a number between ${min} and ${max}`);
  }
  return v;
};

/** Reads `.cochange.json` from the repo root (if present) on top of the defaults. */
export function loadConfig(root: string, explicitPath?: string): Config {
  const path = explicitPath ?? join(root, '.cochange.json');
  const cfg: Config = { ...DEFAULTS, ignore: [...DEFAULT_IGNORE], ignorePairs: [] };
  if (!existsSync(path)) {
    if (explicitPath) throw new ConfigError(`config file not found: ${explicitPath}`);
    return cfg;
  }
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  } catch (e) {
    throw new ConfigError(`${path} is not valid JSON: ${(e as Error).message}`);
  }
  if (raw.minConfidence !== undefined)
    cfg.minConfidence = num(raw.minConfidence, 'minConfidence', 0, 1);
  if (raw.minSupport !== undefined) cfg.minSupport = num(raw.minSupport, 'minSupport', 1);
  if (raw.minLift !== undefined) cfg.minLift = num(raw.minLift, 'minLift', 0);
  if (raw.maxFiles !== undefined) cfg.maxFiles = num(raw.maxFiles, 'maxFiles', 2);
  if (raw.halfLifeDays !== undefined) cfg.halfLifeDays = num(raw.halfLifeDays, 'halfLifeDays', 0);
  if (raw.maxCommits !== undefined) cfg.maxCommits = num(raw.maxCommits, 'maxCommits', 10);
  if (typeof raw.since === 'string') cfg.since = raw.since;
  if (raw.ignore !== undefined) {
    if (!Array.isArray(raw.ignore) || raw.ignore.some((x) => typeof x !== 'string')) {
      throw new ConfigError('"ignore" must be an array of glob strings');
    }
    cfg.ignore.push(...(raw.ignore as string[]));
  }
  if (raw.ignorePairs !== undefined) {
    const ok =
      Array.isArray(raw.ignorePairs) &&
      raw.ignorePairs.every(
        (p) => Array.isArray(p) && p.length === 2 && p.every((x) => typeof x === 'string'),
      );
    if (!ok) throw new ConfigError('"ignorePairs" must be an array of [fileA, fileB] pairs');
    cfg.ignorePairs = raw.ignorePairs as [string, string][];
  }
  return cfg;
}
