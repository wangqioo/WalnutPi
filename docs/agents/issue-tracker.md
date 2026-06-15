# Issue Tracker: GitHub

Issues and PRDs for this repo live as GitHub issues in `wangqioo/WalnutPi`. Use the `gh` CLI for all issue operations.

## Conventions

- Create an issue: `gh issue create --title "..." --body "..."`
- Read an issue: `gh issue view <number> --comments`
- List issues: `gh issue list --state open --json number,title,body,labels,comments`
- Comment on an issue: `gh issue comment <number> --body "..."`
- Apply or remove labels: `gh issue edit <number> --add-label "..."` or `--remove-label "..."`
- Close an issue: `gh issue close <number> --comment "..."`

Infer the repo from `git remote -v`. The `gh` CLI does this automatically when run inside this clone.

## Skill behavior

When a skill says "publish to the issue tracker", create a GitHub issue.

When a skill says "fetch the relevant ticket", run `gh issue view <number> --comments`.
