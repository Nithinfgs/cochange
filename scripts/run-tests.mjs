// Cross-platform test runner: `node --test` only expands globs on newer Node versions.
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const dir = resolve(import.meta.dirname, '../dist/test');
const files = readdirSync(dir)
  .filter((f) => f.endsWith('.test.js'))
  .map((f) => join(dir, f));
const res = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' });
process.exit(res.status ?? 1);
