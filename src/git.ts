import { execFileSync } from 'node:child_process';

export class GitError extends Error {}

export function git(cwd: string, args: string[], opts: { allowFail?: boolean } = {}): string {
  try {
    return execFileSync('git', ['-c', 'core.quotepath=false', ...args], {
      cwd,
      encoding: 'utf8',
      maxBuffer: 1024 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (err) {
    if (opts.allowFail) return '';
    const e = err as { stderr?: Buffer | string; code?: string };
    if (e.code === 'ENOENT') throw new GitError('git was not found on PATH');
    const stderr = String(e.stderr ?? '').trim();
    throw new GitError(stderr || `git ${args.join(' ')} failed`);
  }
}

export function repoRoot(cwd: string): string {
  try {
    return git(cwd, ['rev-parse', '--show-toplevel']).trim();
  } catch {
    throw new GitError(`${cwd} is not inside a git repository`);
  }
}

export interface Commit {
  hash: string;
  /** Unix seconds (committer date). */
  time: number;
  /** Paths touched, mapped onto their newest name so renames do not split history. */
  files: string[];
}

export interface HistoryOptions {
  rev?: string;
  maxCommits: number;
  since?: string;
}

/**
 * Reads history newest-first. Renames are followed: when a commit renames `old -> new`, every
 * older commit's `old` is reported as `new` (or whatever `new` later became).
 */
export function readHistory(cwd: string, opts: HistoryOptions): Commit[] {
  const args = [
    'log',
    '-z',
    '--name-status',
    '-M',
    '--no-merges',
    `--max-count=${opts.maxCommits}`,
    '--format=%x01%H %ct',
  ];
  if (opts.since) args.push(`--since=${opts.since}`);
  args.push(opts.rev ?? 'HEAD', '--');
  const out = git(cwd, args, { allowFail: true });
  return parseLog(out);
}

export function parseLog(out: string): Commit[] {
  const alias = new Map<string, string>();
  const canon = (p: string): string => alias.get(p) ?? p;
  const commits: Commit[] = [];
  for (const block of out.split('\x01')) {
    if (!block.trim()) continue;
    const tokens = block.split('\0');
    const header = (tokens.shift() ?? '').trim().split(' ');
    const hash = header[0] ?? '';
    const time = Number(header[1]);
    if (!hash || !Number.isFinite(time)) continue;
    const files = new Set<string>();
    for (let i = 0; i < tokens.length; i++) {
      const status = (tokens[i] ?? '').trim();
      if (!status) continue;
      const kind = status[0];
      if (kind === 'R' || kind === 'C') {
        const oldPath = tokens[++i] ?? '';
        const newPath = tokens[++i] ?? '';
        const target = canon(newPath);
        if (kind === 'R') alias.set(oldPath, target);
        files.add(target);
      } else {
        const p = tokens[++i] ?? '';
        if (p) files.add(canon(p));
      }
    }
    commits.push({ hash, time, files: [...files] });
  }
  return commits;
}

export function trackedFiles(cwd: string): Set<string> {
  return new Set(git(cwd, ['ls-files', '-z']).split('\0').filter(Boolean));
}

export interface Change {
  path: string;
  /** Previous path when the change is a rename. */
  oldPath?: string;
  status: string;
}

export type DiffMode =
  | { kind: 'working' }
  | { kind: 'staged' }
  | { kind: 'base'; base: string }
  | { kind: 'files'; files: string[] };

export function parseNameStatus(out: string): Change[] {
  const t = out.split('\0');
  const changes: Change[] = [];
  for (let i = 0; i < t.length; i++) {
    const status = (t[i] ?? '').trim();
    if (!status) continue;
    if (status[0] === 'R' || status[0] === 'C') {
      const oldPath = t[++i] ?? '';
      const path = t[++i] ?? '';
      changes.push({ path, oldPath: status[0] === 'R' ? oldPath : undefined, status });
    } else {
      changes.push({ path: t[++i] ?? '', status });
    }
  }
  return changes.filter((c) => c.path);
}

/** Returns the changes to analyze and the revision whose history should be mined. */
export function collectChanges(cwd: string, mode: DiffMode): { changes: Change[]; rev: string } {
  const ns = ['diff', '-z', '--name-status', '-M'];
  const untracked = (): Change[] =>
    git(cwd, ['ls-files', '-z', '--others', '--exclude-standard'])
      .split('\0')
      .filter(Boolean)
      .map((path) => ({ path, status: 'A' }));
  switch (mode.kind) {
    case 'files':
      return { changes: mode.files.map((path) => ({ path, status: 'M' })), rev: 'HEAD' };
    case 'staged':
      return { changes: parseNameStatus(git(cwd, [...ns, '--cached'])), rev: 'HEAD' };
    case 'working': {
      const tracked = parseNameStatus(git(cwd, [...ns, 'HEAD'], { allowFail: true }));
      return { changes: [...tracked, ...untracked()], rev: 'HEAD' };
    }
    case 'base': {
      const mb = git(cwd, ['merge-base', mode.base, 'HEAD']).trim();
      const committed = parseNameStatus(git(cwd, [...ns, mb, 'HEAD']));
      const pending = parseNameStatus(git(cwd, [...ns, 'HEAD'], { allowFail: true }));
      const seen = new Set(committed.map((c) => c.path));
      return {
        changes: [...committed, ...pending.filter((c) => !seen.has(c.path)), ...untracked()],
        rev: mb,
      };
    }
  }
}
