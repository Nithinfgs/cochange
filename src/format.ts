import type { CheckResult } from './analyze.js';
import type { BacktestResult } from './backtest.js';
import type { Config } from './config.js';
import type { Suggestion } from './index.js';

export type Format = 'text' | 'json' | 'markdown' | 'github';

export interface Style {
  bold(s: string): string;
  dim(s: string): string;
  red(s: string): string;
  green(s: string): string;
  yellow(s: string): string;
  cyan(s: string): string;
}

export function makeStyle(color: boolean): Style {
  const wrap = (open: number, close: number) => (s: string) =>
    color ? `\x1b[${open}m${s}\x1b[${close}m` : s;
  return {
    bold: wrap(1, 22),
    dim: wrap(2, 22),
    red: wrap(31, 39),
    green: wrap(32, 39),
    yellow: wrap(33, 39),
    cyan: wrap(36, 39),
  };
}

export const pct = (x: number): string => `${Math.round(x * 100)}%`;
const plural = (n: number, one: string, many = `${one}s`): string => (n === 1 ? one : many);
const num = (n: number): string => n.toLocaleString('en-US');

function evidence(s: Suggestion): string {
  const r = s.because[0];
  return r ? `${r.support} of ${r.total} commits` : `${s.support} commits`;
}

export function formatCheck(res: CheckResult, cfg: Config, fmt: Format, style: Style): string {
  switch (fmt) {
    case 'json':
      return JSON.stringify(res, null, 2);
    case 'github':
      return res.suggestions
        .map((s) => {
          const r = s.because[0];
          const props = [r ? `file=${escapeProp(r.file)}` : '', 'title=cochange'].filter(Boolean);
          const msg = `Usually changed together with ${s.file} (${evidence(s)}, ${pct(s.confidence)}). It is not part of this change.`;
          return `::warning ${props.join(',')}::${escapeData(msg)}`;
        })
        .join('\n');
    case 'markdown':
      return markdown(res);
    default:
      return text(res, cfg, style);
  }
}

function text(res: CheckResult, cfg: Config, c: Style): string {
  const head = `${c.bold('cochange')} ${c.dim('·')} ${num(res.changed.length)} changed ${plural(res.changed.length, 'file')} ${c.dim('·')} learned from ${num(res.historyCommits)} commits`;
  if (res.suggestions.length === 0) {
    const note = res.insufficientHistory
      ? c.yellow(
          `Not enough history: none of the changed files appear in ${cfg.minSupport}+ commits, so nothing can be compared.`,
        )
      : c.green('✓ No forgotten companions.');
    return `${head}\n\n${note}`;
  }
  const w = Math.max(...res.suggestions.map((s) => s.file.length));
  const lines = res.suggestions.map((s) => {
    const r = s.because[0];
    const why = r ? `because you changed ${r.file}` : '';
    return `  ${c.cyan(s.file.padEnd(w))}  ${c.bold(pct(s.confidence).padStart(4))}  ${evidence(s).padEnd(18)} ${c.dim(why)}`;
  });
  const n = res.suggestions.length;
  return [
    head,
    '',
    c.yellow(`⚠ ${n} ${plural(n, 'file')} you may have forgotten:`),
    '',
    ...lines,
    '',
    c.dim('Wrong call? Add the pair to "ignorePairs" in .cochange.json.'),
  ].join('\n');
}

function markdown(res: CheckResult): string {
  const marker = '<!-- cochange -->';
  if (res.suggestions.length === 0) {
    return `${marker}\n**cochange**: no forgotten companions found in ${num(res.changed.length)} changed files.`;
  }
  const rows = res.suggestions.map((s) => {
    const r = s.because[0];
    return `| \`${s.file}\` | ${pct(s.confidence)} | ${evidence(s)} | \`${r?.file ?? ''}\` |`;
  });
  return [
    marker,
    `**cochange** found ${res.suggestions.length} ${plural(res.suggestions.length, 'file')} that usually change with this PR's files but are not in it:`,
    '',
    '| Missing file | Confidence | Evidence | Because you changed |',
    '| --- | --- | --- | --- |',
    ...rows,
    '',
    '<sub>Based on git history. Ignore any that do not apply.</sub>',
  ].join('\n');
}

export function formatPartners(file: string, list: Suggestion[], limit: number, c: Style): string {
  if (list.length === 0) return `${c.bold(file)}: no co-change history yet.`;
  const shown = list.slice(0, limit);
  const w = Math.max(...shown.map((s) => s.file.length));
  const total = shown[0]?.because[0]?.total ?? 0;
  return [
    `${c.bold(file)} ${c.dim(`changed in ${num(total)} commits; usually together with:`)}`,
    '',
    ...shown.map(
      (s) =>
        `  ${c.cyan(s.file.padEnd(w))}  ${c.bold(pct(s.confidence).padStart(4))}  ${String(s.support).padStart(4)} commits  ${c.dim(`lift ${s.lift.toFixed(1)}×`)}`,
    ),
  ].join('\n');
}

export function formatBacktest(res: BacktestResult, cfg: Config, c: Style): string {
  const p = res.primary;
  const lines = [
    `${c.bold('cochange backtest')} ${c.dim('·')} ${num(res.commits)} recent commits, ${num(res.trials)} held-out files, trained on earlier history only`,
    '',
    `  At ${c.bold(pct(cfg.minConfidence))} confidence (your current setting):`,
    `    ${c.green(pct(p.recall).padStart(4))}  of forgotten files would have been flagged`,
    `    ${c.green(pct(p.precision).padStart(4))}  of flags pointed at the forgotten file`,
    `    ${c.yellow(pct(p.nagRate).padStart(4))}  of complete commits would still draw a warning`,
  ];
  if (res.rows.length > 1) {
    lines.push('', c.dim('  confidence   recall   precision   nag rate'));
    for (const r of res.rows) {
      const mark = r.minConfidence === cfg.minConfidence ? '›' : ' ';
      lines.push(
        `  ${mark} ${pct(r.minConfidence).padStart(6)}     ${pct(r.recall).padStart(5)}    ${pct(r.precision).padStart(7)}     ${pct(r.nagRate).padStart(6)}`,
      );
    }
  }
  lines.push(
    '',
    c.dim(
      'Precision is conservative: a flag outside the original commit may still be a real miss fixed later.',
    ),
  );
  return lines.join('\n');
}

const escapeData = (s: string): string =>
  s.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
const escapeProp = (s: string): string => escapeData(s).replace(/:/g, '%3A').replace(/,/g, '%2C');
