<div align="center">

# OpenCode GitHub Review Queue

**Every pull request waiting on your review, inside OpenCode.**

A review queue for the TUI and the Desktop app, so checking GitHub never
breaks your flow.

[![CI](https://github.com/andremarques94/opencode-github-review-queue/actions/workflows/ci.yml/badge.svg)](https://github.com/andremarques94/opencode-github-review-queue/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![OpenCode 2.3](https://img.shields.io/badge/OpenCode-2.3-000000.svg)](https://opencode.ai)
[![npm](https://img.shields.io/npm/v/opencode-github-review-queue.svg)](https://www.npmjs.com/package/opencode-github-review-queue)


</div>

## Why

Review requests arrive when you are in the middle of something. The usual answer is another tab, another search,
another context switch. This plugin puts them where you already are: one queue, grouped by repository, kept current
in the background, with a notification only when something actually needs you.

## Features

- **One queue, both surfaces.** The TUI panel and the Desktop side panel read the same server-side poller.
- **Grouped by repository**, with a **Current** scope for the repository in the session.
- **Notifications that respect you.** New requests are batched into one notification; a request that briefly drops
  out of GitHub's search index does not notify twice.
- **Keyboard and mouse.** Move, open, copy, filter and refresh, or click and right-click.
- **Review with a human in the loop.** Start a review from the queue: the plugin checks the pull request out into
  its own worktree and opens an agent session that drafts findings. You decide on each one, and only you can post.
- **Stays useful offline.** The last successful queue is shown, marked stale, while GitHub is unreachable.
- **Polite to the API.** Paginated search, request timeouts, bounded backoff, and GitHub's rate-limit reset time.
- **No tokens touched.** The GitHub CLI is spawned directly; the plugin reads and stores no credentials.

## Requirements

- **OpenCode 2.3.0** (the version this plugin is built and tested against).
- **[GitHub CLI](https://cli.github.com/)** installed and authenticated.

```sh
gh auth status   # if this fails:
gh auth login
```

## Install

Add the plugin to the `plugins` array in your **global** `~/.config/opencode/opencode.jsonc`:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    {
      "package": "opencode-github-review-queue"
    }
  ]
}
```

OpenCode downloads the package and loads its server, TUI and Desktop parts. The global config is required for the
Desktop part. Run `/reload` if an already-open client does not pick it up.

Then open the queue with `/reviews`, or **Show GitHub review requests** from the command palette.

## Usage

### TUI

| Key       | Action                                                        |
| --------- | ------------------------------------------------------------- |
| `j` / `k` | Move the selection                                            |
| `Enter`   | Start a review of the selected pull request, or resume it     |
| `o`       | Open the pull request on GitHub                               |
| `p`       | Post the selected review, after a preview                     |
| `m`       | Actions menu: open, copy, post, or reset                      |
| `y`       | Copy `owner/repo#123`                                         |
| `u`       | Copy the URL                                                  |
| `f`       | Switch between **Current** and **All**                        |
| `r`       | Refresh                                                       |
| `Shift+F` | Toggle full screen                                            |
| `Esc`     | Close the panel                                               |

With mouse support enabled in your terminal, click a request to select it, click it again to start or resume its
review, and right-click for the actions menu. **All** / **Current** and the footer hints are clickable, and the wheel scrolls the list.
Copying uses OSC 52, so it needs a terminal that supports it.

### Desktop

Open the pinned **Review requests** tab in the side panel, or **Show GitHub review requests** from the command palette.
Click a row to start or resume its review. Its menu (or a right-click) opens it on GitHub, copies its reference or
link, and posts or resets its review. New requests also raise a toast with a **Show reviews** button.

### Reviews

**Start review** asks which model should review, listing the enabled chat models of your connected providers with
your last pick selected, then prepares a local review and opens its session:

1. It finds a local clone of the repository. That is the session's own checkout when it is a clone of the pull
   request's repository, or a clone the plugin made earlier. Otherwise it asks before making a bare, blobless clone
   in the cache directory, which later reviews reuse.
2. It fetches the pull request head into a detached worktree under the cache directory. Your checkout and branch are
   never touched.
3. It opens a session in that worktree with the review instructions. The agent investigates, records findings with
   the `review_*` tools, and walks you through them one at a time. Lines outside the diff are rejected, and file
   edits are denied in the session.

The row shows where the review stands: _reviewing_, _N to decide_, _ready to post_, or _posted_. **Resume review**
returns to the same session.

**Post review** shows the verdict, summary, and every retained comment, and posts only after you confirm. It refuses
while findings are undecided, and asks again if new commits were pushed since the draft. The agent cannot post.
After posting, the worktree is removed.

**Reset review** deletes the draft and its worktree. The session's chat history and anything already on GitHub
stay.

The default review guidelines cover readability, naming, dead code, duplication, error handling, tests, and types,
in a direct tone. Point `reviewGuidelines` at a Markdown file to replace them with your own quality bar and tone.

### Notifications

Desktop notifications follow **Settings › Notifications**; TUI notifications follow the TUI's attention settings.
Set `"notifications": false` to keep the in-app toasts but silence native ones.

## Configuration

```jsonc
{
  "plugins": [
    {
      "package": "opencode-github-review-queue",
      "options": {
        "intervalMs": 60000,
        "timeoutMs": 20000,
        "maxBackoffMs": 900000,
        "notifications": true,
        "cacheDirectory": "~/.cache/opencode-github-review-queue",
        "reviewGuidelines": "/path/to/review-guidelines.md"
      }
    }
  ]
}
```

| Option          | Default   | Description                                                       |
| --------------- | --------- | ----------------------------------------------------------------- |
| `intervalMs`    | `60000`   | Poll interval; minimum 10 seconds                                 |
| `timeoutMs`     | `20000`   | Timeout for each GitHub CLI request                               |
| `maxBackoffMs`  | `900000`  | Longest delay after transient failures                            |
| `notifications` | `true`    | Native and terminal-attention notifications                       |
| `cacheDirectory` | `$XDG_CACHE_HOME/opencode-github-review-queue` | Plugin-made clones and review worktrees; falls back to `~/.cache` |
| `reviewGuidelines` | built-in | Path to a Markdown file that replaces the review quality bar and tone |


## Development

```sh
git clone https://github.com/andremarques94/opencode-github-review-queue.git
cd opencode-github-review-queue
pnpm install     # also installs the Husky hooks
pnpm check       # typecheck, lint, test, build
pnpm fallow      # full repository audit
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for the hook and commit conventions.

Releases use Conventional Commits and Release Please: merging the release PR tags the version and publishes it to
npm.

## Contributing

Issues and pull requests are welcome. [CONTRIBUTING.md](CONTRIBUTING.md) covers setup, hooks and commit style.

## License

[MIT](LICENSE) © André Marques

---

<sub>An independent plugin. Not built by, or affiliated with, the OpenCode team.</sub>
