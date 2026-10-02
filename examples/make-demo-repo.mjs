// Builds a small, deterministic "invoice-api" repository whose history follows realistic
// conventions (route <-> test <-> OpenAPI <-> docs, migrations <-> schema).
// Usage: node examples/make-demo-repo.mjs [target-dir]
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

export function makeDemoRepo(dir = mkdtempSync(join(tmpdir(), 'cochange-demo-'))) {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  let seed = 7;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const START = 1_735_689_600; // 2025-01-01
  let n = 0;
  const git = (args, date) =>
    execFileSync('git', args, {
      cwd: dir,
      encoding: 'utf8',
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: 'Demo Dev',
        GIT_AUTHOR_EMAIL: 'demo@example.com',
        GIT_COMMITTER_NAME: 'Demo Dev',
        GIT_COMMITTER_EMAIL: 'demo@example.com',
        ...(date ? { GIT_AUTHOR_DATE: `${date} +0000`, GIT_COMMITTER_DATE: `${date} +0000` } : {}),
      },
    });
  const commit = (msg, files) => {
    n++;
    for (const f of files) {
      const full = join(dir, f);
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, `// ${f} revision ${n}\n`);
    }
    git(['add', '-A']);
    git(['commit', '-q', '-m', msg], START + n * 86400 * 2);
  };
  git(['init', '-q', '-b', 'main']);
  git(['config', 'commit.gpgsign', 'false']);

  const resources = ['invoices', 'customers', 'payments', 'refunds'];
  commit('chore: scaffold', [
    'README.md',
    'package.json',
    'openapi.yaml',
    'db/schema.sql',
    'src/utils.ts',
    ...resources.flatMap((r) => [`src/routes/${r}.ts`, `tests/${r}.test.ts`, `docs/api/${r}.md`]),
  ]);
  let migration = 0;
  for (let i = 0; i < 70; i++) {
    const r = resources[Math.floor(rnd() * resources.length)];
    const roll = rnd();
    if (roll < 0.55) {
      const files = [`src/routes/${r}.ts`];
      if (rnd() < 0.93) files.push(`tests/${r}.test.ts`);
      if (rnd() < 0.9) files.push('openapi.yaml');
      if (rnd() < 0.88) files.push(`docs/api/${r}.md`);
      commit(`feat(${r}): update endpoint`, files);
    } else if (roll < 0.7) {
      migration++;
      commit('feat(db): add migration', [
        `db/migrations/${String(migration).padStart(3, '0')}_change.sql`,
        'db/schema.sql',
      ]);
    } else if (roll < 0.85) {
      commit(`fix(${r}): handle edge case`, [`src/routes/${r}.ts`, `tests/${r}.test.ts`]);
    } else {
      const solo = ['README.md', 'package.json', 'src/utils.ts'];
      commit('chore: tidy', [solo[Math.floor(rnd() * solo.length)]]);
    }
  }
  return dir;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(makeDemoRepo(process.argv[2]));
}
