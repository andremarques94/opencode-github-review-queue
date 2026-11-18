<div align="center">

# OpenCode GitHub Review Queue

**Every pull request waiting on your review, inside OpenCode.**

[![CI](https://github.com/andremarques94/opencode-github-review-queue/actions/workflows/ci.yml/badge.svg)](https://github.com/andremarques94/opencode-github-review-queue/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![OpenCode 2.3](https://img.shields.io/badge/OpenCode-2.3-000000.svg)](https://opencode.ai)
[![npm](https://img.shields.io/npm/v/opencode-github-review-queue.svg)](https://www.npmjs.com/package/opencode-github-review-queue)

</div>

A review queue for the OpenCode TUI and Desktop app. It lists the pull requests waiting on you, keeps them current in
the background, and lets you review them with an agent without leaving your editor.

## Features

- **One queue** in the TUI and the Desktop side panel, grouped by repository, with checks, conflicts, unresolved
  threads, size, and how long each has waited.
- **Agent-assisted reviews.** Each review runs in its own worktree. The agent drafts findings, you keep or drop each
  one, and only you can post.
- **Choose review skills.** The agent discovers available skills and opens a toggle list with relevant skills
  preselected. Deselect any recommendation, add other skills, or select none; only your confirmed choices are loaded.
- **Follow-ups.** A pull request you reviewed comes back when the author pushes, and the next review covers only the
  new commits.
- **Your own pull requests** under **Mine**, with a notification when one gets changes requested or is ready to merge.
  **Address review** opens a session that works through the open comments.
- **Summaries, snoozes, and filters** for drafts, bots, repositories, and team requests.
- **GitHub Enterprise.** Every host `gh` is logged into feeds the same queue.
- **No tokens touched.** Everything goes through the GitHub CLI.

## Requirements

- OpenCode 2.3.0
- [GitHub CLI](https://cli.github.com/) 2.81.0 or later, logged in (`gh auth login`)

## Install

Add the plugin to your **global** `~/.config/opencode/opencode.jsonc` (the Desktop app only loads it from there):

```jsonc
{
  "plugins": [{ "package": "opencode-github-review-queue" }]
}
```

Open the queue with `/reviews`, or **Review requests** in the Desktop side panel.

## Usage

| Key       | Action                                       |
| --------- | -------------------------------------------- |
| `Enter`   | Start or resume a review                     |
| `d`       | Show details: size, checks, reviewers        |
| `o`       | Open on GitHub                               |
| `p`       | Post the review, after a preview             |
| `i`       | Summarize                                    |
| `a`       | Address the review of your own pull request  |
| `s` / `z` | Snooze or wake, show snoozed                 |
| `f` / `←` `→` | Switch between **All**, **Current**, **Mine** |
| `r`       | Refresh                                      |
| `m`       | Every action                                 |

On the Desktop, click a row to start its review, its chevron to show its details, or right-click it for the other
actions.

Inside a review session, `/findings` (TUI) or the **Review** pill (Desktop) lists the findings and posts the review.
On the Desktop, **Open in** opens the review's worktree in your editor, so you can run the changes.

## Configuration

Options go in the plugin entry's `options`. All of them are optional.

| Option                   | Type                                  | Default    | Description                                                 |
| ------------------------ | ------------------------------------- | ---------- | ----------------------------------------------------------- |
| `intervalMs`             | `number`                              | `60000`    | Poll interval in milliseconds (minimum 10 seconds)          |
| `timeoutMs`              | `number`                              | `20000`    | Timeout for each GitHub CLI call, in milliseconds           |
| `maxBackoffMs`           | `number`                              | `900000`   | Longest delay after failures, in milliseconds               |
| `notifications`          | `boolean`                             | `true`     | Native notifications                                        |
| `followUps`              | `boolean`                             | `true`     | Re-queue pull requests you reviewed when new commits arrive |
| `myPullRequests`         | `boolean`                             | `true`     | Show your own pull requests under **Mine**                  |
| `notifyOnMyPullRequests` | `boolean`                             | `true`     | Notify about changes on your own pull requests              |
| `sort`                   | `"oldest"` \| `"smallest"` \| `"ready"` | `"oldest"` | Queue order                                                 |
| `staleAfter`             | `string` (`45m`, `3h`, `2d`)          | none       | Highlight requests waiting longer than this                 |
| `includeDrafts`          | `boolean`                             | `true`     | Show draft pull requests                                    |
| `excludeAuthors`         | `string[]`                            | `[]`       | Logins to hide, such as `["dependabot"]`                    |
| `excludeRepositories`    | `string[]`                            | `[]`       | `owner/repo` or `owner/*` patterns to hide                  |
| `teamRequests`           | `"show"` \| `"hide"`                  | `"show"`   | `"hide"` drops requests made only to your teams             |
| `reviewGuidelines`       | `string` (path)                       | built-in   | Markdown file that replaces the review guidelines           |
| `cacheDirectory`         | `string` (path)                       | `~/.cache/opencode-github-review-queue` | Where clones and worktrees go  |
| `keepClones`             | `boolean`                             | `false`    | Keep the plugin's clones after a review                     |

### GitHub Enterprise

There is nothing to configure. The plugin queries every host `gh` is logged into:

```sh
gh auth login --hostname github.example.com
```

If one host is down, its last results stay listed and the other hosts keep refreshing.

If your company uses Enterprise Cloud on github.com itself, your work and personal accounts share one host, and the
queue follows the active one. Switch with `gh auth switch --hostname github.com --user <login>`.

## Development

```sh
pnpm install
pnpm check   # typecheck, lint, test, build
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for hooks and commit conventions.

## License

[MIT](LICENSE) © André Marques

<sub>An independent plugin, not affiliated with the OpenCode team.</sub>
