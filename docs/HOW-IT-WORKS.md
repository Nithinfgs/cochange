# How cochange works

## 1. Reading history

`git log -z --name-status -M --no-merges` is parsed newest-first. Merge commits are skipped. Renames (`R`) are folded: when a commit renames `old -> new`, every older commit's `old` is reported under the newest name, so a `git mv` does not reset what the tool knows.

Paths are NUL-separated, so spaces, quotes and non-ASCII names are safe. Git is always invoked with an argument array, never through a shell.

## 2. Filtering

A commit is dropped from the statistics when:

- it touches more than `maxFiles` files after ignore rules (formatters, renames of whole trees, vendoring), or
- every file in it is ignored (lockfiles, minified bundles, `node_modules`, `vendor`, `dist` by default).

Single-file commits are kept. They matter: they are the evidence that a file often changes _alone_, which lowers its confidence.

## 3. The index

Commits are fed oldest-first into `CoIndex`, which keeps, for every file, a commit count `n` and a recency-weighted count `s`, and the same pair of numbers for every pair of files that appeared in a commit together.

Weights are `2^((t - t0) / halfLife)`. This grows over time instead of decaying old evidence, which is equivalent for ratios (the common factor cancels) and avoids recomputing on every query. When the exponent would overflow a double (very short half-life, very long history) all tallies are rescaled and the origin moves.

## 4. Scoring

For a changed file `A` and candidate `B` (not in the change, still tracked by git):

```
confidence = s(A and B) / s(A)
support    = n(A and B)
lift       = confidence / (n(B) / total commits)
```

A candidate is reported when `confidence >= minConfidence`, `support >= minSupport` and `lift >= minLift`. If several changed files imply the same `B`, the highest confidence is used and up to three reasons are kept.

`ignorePairs` entries are blocked in both directions.

## 5. Which history is used

| Mode         | Changes                                 | History        |
| ------------ | --------------------------------------- | -------------- |
| default      | `git diff HEAD` plus untracked files    | `HEAD`         |
| `--staged`   | `git diff --cached`                     | `HEAD`         |
| `--base REF` | merge-base..HEAD, plus uncommitted work | the merge-base |

In `--base` mode the branch's own commits are excluded from training. Otherwise a PR that edits `A` and `B` together would count as evidence that they belong together, and would justify itself.

For a renamed file in the change set, the old path's history is used.

## 6. Backtesting

`cochange backtest` takes the last N multi-file commits (default 300). For each one it uses an index containing only _earlier_ commits, then:

- **recall / precision**: removes each file in turn (up to 8 per commit), runs the check on the rest, and records whether the removed file was flagged and how many other flags appeared;
- **nag rate**: runs the check on the whole commit and counts how often it still produces a warning.

Known biases, all documented in [VALIDATION.md](VALIDATION.md): candidate files must exist at `HEAD`, and renames are resolved using the full history.
