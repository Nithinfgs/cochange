import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

export interface TestRepo {
  dir: string;
  commit(files: Record<string, string>, msg?: string, dayOffset?: number): void;
  git(...args: string[]): string;
  cleanup(): void;
}

const DAY = 86400;
const START = 1_700_000_000;

export function makeRepo(): TestRepo {
  const dir = mkdtempSync(join(tmpdir(), 'cochange-'));
  let n = 0;
  const run = (args: string[], date?: number): string =>
    execFileSync('git', args, {
      cwd: dir,
      encoding: 'utf8',
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: 't',
        GIT_AUTHOR_EMAIL: 't@example.com',
        GIT_COMMITTER_NAME: 't',
        GIT_COMMITTER_EMAIL: 't@example.com',
        ...(date ? { GIT_AUTHOR_DATE: `${date} +0000`, GIT_COMMITTER_DATE: `${date} +0000` } : {}),
      },
    });
  run(['init', '-q', '-b', 'main']);
  run(['config', 'commit.gpgsign', 'false']);
  return {
    dir,
    commit(files, msg = `c${n}`, dayOffset = n) {
      n++;
      for (const [p, content] of Object.entries(files)) {
        const full = join(dir, p);
        mkdirSync(dirname(full), { recursive: true });
        writeFileSync(full, content);
      }
      run(['add', '-A']);
      run(['commit', '-q', '-m', msg], START + dayOffset * DAY);
    },
    git: (...args) => run(args),
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

/** A repo where src/a.ts always moves with a.test.ts and docs/a.md, plus unrelated noise. */
export function coupledRepo(rounds = 8): TestRepo {
  const r = makeRepo();
  r.commit({
    'src/a.ts': 'v0',
    'src/a.test.ts': 'v0',
    'docs/a.md': 'v0',
    'src/b.ts': 'v0',
    README: 'v0',
  });
  for (let i = 1; i <= rounds; i++) {
    r.commit({ 'src/a.ts': `v${i}`, 'src/a.test.ts': `v${i}`, 'docs/a.md': `v${i}` });
    r.commit({ 'src/b.ts': `v${i}` });
    if (i % 3 === 0) r.commit({ README: `v${i}`, 'src/b.ts': `w${i}` });
  }
  return r;
}
