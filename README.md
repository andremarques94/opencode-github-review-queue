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

- **One queue, both surfaces.** The TUI panel and the Desktop side panel read the same server-side poller, and only
  one OpenCode location polls GitHub however many review sessions are open.
- **Readiness at a glance.** Each row shows its checks (✓ passing, ✗ failing, ● running), merge conflicts, and
  unresolved review threads.
- **Re-reviews that focus on what changed.** When a pull request you reviewed comes back with new commits, the row
  says so, and the next review can cover only the commits since.
- **Snooze** a pull request until its checks finish, until the author pushes, or until a time you pick.
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
| `j` / `k` | Move the selection (or `↓` / `↑`)                              |
| `Enter`   | Start a review of the selected pull request, or resume it     |
| `o`       | Open the pull request on GitHub                               |
| `p`       | Post the selected review, after a preview                     |
| `s`       | Snooze the selected pull request, or wake it                  |
| `z`       | Show or hide snoozed pull requests                            |
| `m`       | Actions menu, listing every action with its key               |
| `y`       | Copy `owner/repo#123`                                         |
| `u`       | Copy the URL                                                  |
| `f`       | Switch between **Current** and **All** (or `←` / `→`)          |
| `r`       | Refresh                                                       |
| `Shift+F` | Toggle full screen                                            |
| `Esc`     | Close the panel                                               |

The footer only shows `enter` and `m`, so it fits a narrow panel; the actions menu lists the rest. With mouse support
enabled in your terminal, click a request to select it, click it again to start or resume its review, and right-click
for the actions menu. **All** / **Current**, the footer hints, and **N snoozed** in the header are clickable, and the
wheel scrolls the list. The actions menu's **Open on GitHub** entry spells out the row's readiness.
Copying uses OSC 52, so it needs a terminal that supports it.

### Desktop

Open the pinned **Review requests** tab in the side panel, or **Show GitHub review requests** from the command palette.
Click a row to start or resume its review. Its menu (or a right-click) opens it on GitHub, copies its reference or
link, snoozes or wakes it, and posts or resets its review. Hover a readiness mark for its meaning, and
click **N snoozed** under the title to show snoozed requests. New requests also raise a toast with a **Show reviews**
button.

### Readiness

Rows show what GitHub reports about the pull request's last commit and mergeability: ✓, ✗, or ● for checks that
pass, fail, or are still running, _conflicts_ when it cannot merge cleanly, and _N threads_ for unresolved review
threads. Anything GitHub does not know yet, such as a pull request without checks or mergeability still being
computed, shows nothing.

### Snooze

**Snooze** hides a pull request until a condition is met: **Until checks finish** (offered while checks are running),
**Until the author pushes**, **For 1 hour**, **Until tomorrow** (9:00), or **Until…** a duration (`45m`, `3h`, `2d`),
a time (`14:30`), or a date (`2026-11-20 09:00`). A snoozed request comes back on its own when its condition is met.
The header counts the snoozed requests; show them to see what each waits for, or to wake one early. A snooze is
dropped when its pull request leaves the queue.

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

After you post, the plugin remembers the commit you reviewed and your verdict until the pull request is closed or
merged. When the author pushes and the request comes back, the row shows _new commits since your review_, and
starting a review offers **Review changes since last review** (the default) or **Full review**. A follow-up review
fetches both commits, looks only at the changes between them, reads your earlier comments on GitHub, and its summary
says which of them the changes address and which they leave unresolved.

Each finding ends with a question: **Keep**, **Edit wording**, **Drop**, **Explain**, or **Investigate**, with the
agent's recommendation first. Click one or type a reply. Explain and Investigate answer about that finding and ask
again.

Inside a review session you can also triage without the chat:

- **Desktop:** the **Review** pill above the composer shows _N of M decided_ and the verdict, with **Post review…** and
  **Show findings**, which opens a **Findings** side tab (close it like any other tab). It lists every finding in
  walkthrough order with its comment and decision, and buttons to keep, drop, edit the comment, ask the agent about
  it, or read its evidence in a dialog.
- **TUI:** the line above the composer shows the same progress; click **findings** or run `/findings` to open the list,
  and **post review…** to post. The list shows one line per finding and opens the selected one with its comment
  rendered as Markdown. `j`/`k` move, `y` keeps, `d` drops, `e` edits the comment (`ctrl+s` saves), `a` asks the
  agent, `enter` shows the evidence, `p` posts, and `shift+f` toggles full screen.

A decision made there is yours: the agent skips it and moves on instead of asking again. Saving an edited comment keeps
the finding. The `review_*` tools only appear in review sessions.

**Post review** shows the verdict, summary, and every retained comment, and posts only after you confirm. It refuses
while findings are undecided, and asks again if new commits were pushed since the draft. The agent cannot post.
After posting, the worktree is removed, and so is a clone the plugin made once no other review uses it (set
`keepClones` to keep clones for faster re-reviews). If cleanup fails, the review still counts as posted and a warning
names the folder left behind.

**Reset review** deletes the draft and its worktree. The session's chat history and anything already on GitHub
stay.

When a reviewed pull request leaves the queue, its draft is forgotten once the review was posted or the pull request
was closed or merged, and any worktree left is cleaned up. A pull request that is still open keeps its draft, so you
can still post it.

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
        "reviewGuidelines": "/path/to/review-guidelines.md",
        "keepClones": false
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
| `keepClones` | `false` | Keep the plugin's clones after their last review instead of deleting them |


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
