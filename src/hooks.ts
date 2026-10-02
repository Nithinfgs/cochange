export const CLAUDE_SNIPPET = `{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          { "type": "command", "command": "npx -y cochange check --hook claude-stop" }
        ]
      }
    ]
  }
}`;

export const PRECOMMIT_SNIPPET = `#!/bin/sh
# .git/hooks/pre-commit  (chmod +x). Warns only; add --strict to block the commit.
npx -y cochange check --staged
exit 0`;

export const GITHUB_SNIPPET = `name: cochange
on: pull_request
jobs:
  cochange:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0 # cochange needs history
      - run: npx -y cochange check --base origin/\${{ github.base_ref }} --format github`;

export function snippet(kind: string): string | undefined {
  switch (kind) {
    case 'claude':
      return `# Add to .claude/settings.json (or ~/.claude/settings.json):\n${CLAUDE_SNIPPET}`;
    case 'pre-commit':
      return PRECOMMIT_SNIPPET;
    case 'github':
      return `# .github/workflows/cochange.yml\n${GITHUB_SNIPPET}`;
    default:
      return undefined;
  }
}
