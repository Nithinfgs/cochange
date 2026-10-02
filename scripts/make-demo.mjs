// Runs the real CLI against the sample repo and renders the session as an animated SVG.
// Usage: npm run demo   (writes docs/assets/demo.svg)
import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { makeDemoRepo } from '../examples/make-demo-repo.mjs';

const root = resolve(import.meta.dirname, '..');
const cli = join(root, 'dist/src/cli.js');
const repo = makeDemoRepo(join(mkdtempSync(join(tmpdir(), 'cc-rec-')), 'invoice-api'));
const sh = (cmd, args) => execFileSync(cmd, args, { cwd: repo, encoding: 'utf8' });
const run = (args) =>
  execFileSync(process.execPath, [cli, ...args, '--color'], { cwd: repo, encoding: 'utf8' });

const steps = [];
const record = (prompt, out) => steps.push({ prompt, out: out.replace(/\n+$/, '') });

appendFileSync(join(repo, 'src/routes/invoices.ts'), 'export const retries = 3;\n');
record('git status --short', sh('git', ['status', '--short']));
record('cochange', run([]));
for (const f of ['tests/invoices.test.ts', 'docs/api/invoices.md'])
  appendFileSync(join(repo, f), '// updated\n');
record('git status --short', sh('git', ['status', '--short']));
record('cochange', run([]));

const COLORS = { 31: '#ff7b72', 32: '#56d364', 33: '#e3b341', 36: '#79c0ff' };
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
function ansiToTspans(line) {
  let bold = false,
    dim = false,
    color = null,
    out = '';
  for (const part of line.split(/(\x1b\[[0-9;]*m)/)) {
    const m = part.match(/^\x1b\[([0-9;]*)m$/);
    if (m) {
      const c = Number(m[1]);
      if (c === 0 || c === 39) color = null;
      if (c === 22) {
        bold = false;
        dim = false;
      }
      if (c === 1) bold = true;
      if (c === 2) dim = true;
      if (COLORS[c]) color = COLORS[c];
    } else if (part) {
      const fill = color ?? (dim ? '#8b949e' : '#e6edf3');
      out += `<tspan fill="${fill}"${bold ? ' font-weight="700"' : ''}>${esc(part)}</tspan>`;
    }
  }
  return out;
}

const LH = 21,
  X = 24,
  TOP = 64;
const lines = [];
steps.forEach((s, i) => {
  if (i) lines.push({ html: '', gap: true });
  lines.push({
    html: `<tspan fill="#56d364">$</tspan> <tspan fill="#e6edf3">${esc(s.prompt)}</tspan>`,
    cmd: true,
  });
  for (const l of s.out.split('\n')) lines.push({ html: ansiToTspans(l) });
});
let t = 0.4;
const timed = lines.map((l) => {
  t += l.cmd ? 0.9 : l.gap ? 0.1 : 0.16;
  return { ...l, at: t };
});
const HOLD = 5;
const total = t + HOLD;
const maxChars = Math.max(
  ...steps.flatMap((s) => [
    s.prompt.length + 2,
    ...s.out.split('\n').map((l) => l.replace(/\x1b\[[0-9;]*m/g, '').length),
  ]),
);
const width = Math.max(760, Math.round(maxChars * 9.1 + X * 2));
const height = TOP + lines.length * LH + 24;

const css = timed
  .map((l, i) =>
    l.gap
      ? ''
      : `@keyframes s${i}{0%,${((l.at / total) * 100).toFixed(2)}%{opacity:0}${(((l.at + 0.01) / total) * 100).toFixed(2)}%,100%{opacity:1}}.l${i}{animation:s${i} ${total.toFixed(2)}s linear infinite}`,
  )
  .join('');
const body = timed
  .map((l, i) => (l.gap ? '' : `<text class="l${i}" x="${X}" y="${TOP + i * LH}">${l.html}</text>`))
  .join('\n');

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Terminal session: cochange warns that tests/invoices.test.ts and docs/api/invoices.md were not changed alongside src/routes/invoices.ts, then reports all clear after they are updated">
<style>text{font:14px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;white-space:pre}${css}@media (prefers-reduced-motion:reduce){text{animation:none!important;opacity:1!important}}</style>
<rect width="${width}" height="${height}" rx="10" fill="#0d1117"/>
<rect width="${width}" height="36" rx="10" fill="#161b22"/><rect y="26" width="${width}" height="10" fill="#161b22"/>
<circle cx="22" cy="18" r="6" fill="#ff5f56"/><circle cx="42" cy="18" r="6" fill="#ffbd2e"/><circle cx="62" cy="18" r="6" fill="#27c93f"/>
<text x="${width / 2}" y="23" text-anchor="middle" fill="#8b949e" style="font-size:12px">invoice-api (sample repo)</text>
${body}
</svg>
`;
writeFileSync(join(root, 'docs/assets/demo.svg'), svg);
console.log(
  `wrote docs/assets/demo.svg (${(svg.length / 1024).toFixed(1)} KB, ${lines.length} lines)`,
);
