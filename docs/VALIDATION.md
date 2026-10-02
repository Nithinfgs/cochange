# Validation

How well does co-change history predict forgotten files? It depends heavily on the repository, so `cochange` measures it rather than asserting it.

## Method

`cochange backtest --sweep` replays the most recent 300 multi-file commits. For each commit the index is built only from earlier commits. Then:

1. **Recall**: each file of the commit (up to 8) is hidden in turn. A hit means the hidden file was flagged.
2. **Precision**: among all flags raised in those trials, the share that pointed at the hidden file. This is conservative: a flag on a different file may be a real miss that was fixed in a later commit.
3. **Nag rate**: the check is run on the _complete_ commit. If it still warns, that is a false alarm from the commit author's point of view.

## Results (real repositories)

Run on 2 October 2026 with the default 3000-commit window, 300 test commits, default `minSupport=4`, `minLift=2`, half-life 365 days.

Commits: flask `d73fa1cd`, requests `611c6162`, django `3db0898eee`, rails `2f75a03b05`.

| Repo          | Confidence | Recall  | Precision | Nag rate |
| ------------- | ---------- | ------- | --------- | -------- |
| pallets/flask | 50%        | 36%     | 22%       | 46%      |
|               | 60%        | 23%     | 25%       | 31%      |
|               | 70%        | 15%     | 28%       | 14%      |
|               | **80%**    | **10%** | **28%**   | **7%**   |
|               | 90%        | 4%      | 36%       | 3%       |
| psf/requests  | 50%        | 19%     | 28%       | 16%      |
|               | 60%        | 14%     | 31%       | 9%       |
|               | 70%        | 10%     | 30%       | 7%       |
|               | **80%**    | **7%**  | **28%**   | **4%**   |
|               | 90%        | 2%      | 19%       | 2%       |
| django/django | 50%        | 15%     | 19%       | 26%      |
|               | 60%        | 12%     | 21%       | 17%      |
|               | 70%        | 9%      | 24%       | 10%      |
|               | **80%**    | **6%**  | **33%**   | **6%**   |
|               | 90%        | 5%      | 32%       | 4%       |
| rails/rails   | 50%        | 11%     | 18%       | 31%      |
|               | 60%        | 9%      | 24%       | 22%      |
|               | 70%        | 7%      | 28%       | 14%      |
|               | **80%**    | **5%**  | **34%**   | **10%**  |
|               | 90%        | 3%      | 36%       | 5%       |

Bold rows are the default.

## What this says

- Most forgotten files are **not** predictable from history. That is expected: most files in a commit are there because of the specific change, not a standing convention.
- The predictable minority is real: precision is consistently around 30%, against a base rate of a few percent for picking a random file.
- Lowering the threshold buys recall at the price of many more false alarms. In these repositories 70% was too noisy for a human-facing default, hence 80%.
- Treat the output as a prompt to double-check, not a verdict. It is cheap for an agent to answer "not needed", and a hook or an advisory CI annotation keeps humans in control.

## Biases and caveats

- Candidate files must exist at `HEAD`, so files deleted later cannot be predicted. Real-time use does not have this limit.
- Renames are resolved with the full history, which mildly flatters early test commits.
- The test window is the most recent commits, which may include release or bulk-change periods.
- These are mature, well-maintained projects with reviewers. A smaller team with looser habits may see a different tradeoff in either direction.
- Nothing here measures whether a flag _helped_ a real contributor. That needs user studies, not a backtest.

## Reproduce

```sh
npm install && npm run build
scripts/validate-oss.sh
```

The script makes blobless clones of the four repositories into a temp directory. Numbers will drift as those projects evolve.
