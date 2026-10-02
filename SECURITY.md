# Security policy

## Supported versions

Only the latest release receives fixes.

## Reporting a vulnerability

Please report privately through GitHub: **Security → Report a vulnerability** on this repository. Do not open a public issue for security problems. You can expect an acknowledgement within a few days.

## Design notes relevant to security

- `cochange` is read-only. It runs `git log`, `git diff`, `git ls-files` and `git merge-base`, and writes a file only when you run `report -o <path>` or redirect output yourself.
- Git is spawned with an argument array, never through a shell. User input (`--base`, `--since`, paths) is passed as arguments, and `--` separates revisions from paths where relevant.
- It makes no network requests and has no runtime dependencies.
- The HTML report is self-contained and escapes repository file names before embedding them.
- Repository contents are never read, only file names and commit metadata.
