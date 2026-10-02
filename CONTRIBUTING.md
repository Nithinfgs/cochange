# Contributing

Thanks for taking a look. The project is small on purpose.

## Setup

```sh
git clone https://github.com/Nithinfgs/cochange && cd cochange
npm install
npm test          # builds, then runs the suite against real temporary git repos
npm run lint
npm run format:check
```

Node 20+ and git are required. Tests create throwaway repositories, so they need `git` on `PATH`.

## What helps most

1. **A repo where the signal is wrong.** Run `cochange backtest --sweep` and share the numbers (no code needed) plus what kind of repo it is.
2. **A false alarm or a miss you can reproduce.** `cochange of <file>` output and your `.cochange.json` are enough.
3. **Hook recipes** for other coding agents or CI systems.
4. Items on the roadmap in the README. Comment on an issue first so we don't duplicate work.

## Guidelines

- Keep runtime dependencies at zero. If something needs a library, open an issue first.
- Every behavior change needs a test. Prefer tests that build a small real git repo (`test/helpers.ts`) over mocks.
- Don't claim accuracy you haven't measured. If a change affects scoring, include before and after backtest numbers from `scripts/validate-oss.sh`.
- Run `npm run format` before committing. Commit messages follow `type: summary` (`feat`, `fix`, `docs`, `test`, `chore`, `ci`).
- Never put real credentials, personal paths or repository contents in issues, fixtures or tests.
