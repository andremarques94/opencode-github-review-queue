# OpenCode GitHub Review Queue

An OpenCode v2 plugin that polls GitHub for open pull requests where the authenticated user is a requested reviewer.
It provides a compact queue in both the TUI and OpenCode Desktop, plus one-time review-request notifications.

## Requirements and compatibility

- OpenCode **v2.3.0** (the version this plugin is built and verified against).
- Node.js 22 or newer and pnpm.
- [GitHub CLI](https://cli.github.com/) authenticated with an account that can read the relevant repositories.
- OpenCode Desktop's GUI plugin API is experimental. Rebuild and re-test before using a different OpenCode minor
  version.

The server, TUI, and Desktop parts use their separate official v2.3.0 APIs. The TUI is not assumed to support Desktop
components, and the Desktop bundle is built with OpenCode's required Vite preset.

## Architecture

The source tree follows the plugin's runtime boundaries:

- `src/domain/`: review queue data and comparison rules.
- `src/server/`: the OpenCode server entry, GitHub CLI adapter, persistence, and polling state machine.
- `src/rpc/`: the contract shared by the server and clients.
- `src/shared/`: runtime-neutral options and presentation helpers.
- `src/tui/`: the TUI entry, local state, and TUI components.
- `src/gui/`: the Desktop entry and Solid components.

The poller remains local rather than wrapping a generic retry package. Retry libraries can calculate backoff, but this
module must also persist successful baselines, detect queue transitions, coalesce overlapping refreshes, honor GitHub's
rate-reset timestamp, and schedule indefinitely. A dependency would not remove those responsibilities or materially
reduce the implementation.

## Install

```sh
pnpm install
pnpm build
gh auth status
```

If `gh auth status` fails, run:

```sh
gh auth login
```

Add the plugin's absolute directory to the **global** `~/.config/opencode/opencode.jsonc`. Desktop loads GUI plugins
only from global OpenCode configuration.

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    {
      "package": "/absolute/path/to/opencode-github-review-queue",
      "options": {
        "intervalMs": 60000,
        "timeoutMs": 20000,
        "maxBackoffMs": 900000,
        "notifications": true
      }
    }
  ]
}
```

OpenCode watches configuration and local plugin builds. Use `/reload` if you want to force a reload.

### Options

- `intervalMs`: polling interval; defaults to 60 seconds and has a 10-second minimum.
- `timeoutMs`: timeout for each GitHub CLI request; defaults to 20 seconds.
- `maxBackoffMs`: maximum transient-failure backoff; defaults to 15 minutes.
- `notifications`: set to `false` to suppress this plugin's attention/native notifications. In-app toasts still show.

Desktop native notifications additionally follow **Settings > Notifications**. Terminal notifications follow the
TUI's configured attention preferences.

## Use

### TUI

Open a session, then run `/reviews` or choose **Show GitHub review requests** from the command palette.

- `j` / `k`: move selection
- `Enter`: open the selected PR on GitHub
- `c`: copy its numeric PR number
- `y`: copy `owner/repo#123`
- `u`: copy its URL
- `f`: switch between the current repository and all repositories
- `r`: refresh manually
- `Shift+F`: toggle full-screen presentation

TUI copying uses the terminal's OSC 52 clipboard support. A terminal that blocks OSC 52 cannot accept these copy
actions.

### Desktop

Open the pinned GitHub review tab in a session's side panel, or choose **Show GitHub review requests** from the command
palette. Use **Current** / **All** to filter, click a row to open it, and use its menu to copy the PR number,
`owner/repo#123`, or URL.

The panel requests the SDK's compact `narrow` side-panel width. The host still lets the user resize it.

## Behaviour and reliability

- One server-side poller supplies both panels and notifications, preventing separate UI polling loops.
- The query is `is:pr is:open review-requested:@me`, not assignment. GraphQL pagination fetches 100 results per page
  without a per-PR metadata request.
- The first successful refresh is silent. The complete queue and last successful refresh are persisted as the baseline.
- A PR that is observed leaving the queue and later returning is notified again.
- Failed, timed-out, malformed, or partial responses never replace the last successful queue or persisted baseline.
- Refreshes cannot overlap. Transient failures use bounded exponential backoff, and reported rate-limit reset times are
  respected.
- `gh` is spawned directly with an argument array; no PR content is interpolated into a shell command. Tokens are
  neither read nor persisted by the plugin.
- Polling and subprocesses stop when the server plugin unloads.

## Limitations

- GitHub's search API caps one search at 1,000 results. Pagination is complete up to that service limit.
- Polling cannot detect a review request that is both added and removed entirely between two successful refreshes.
- OpenCode Desktop deduplicates native notifications across windows using the plugin's event ID. The v2.3.0 TUI
  attention API has no equivalent event-ID facility, so multiple TUI clients attached to the same server may each show
  an alert. Desktop's window API also has no supported "active window only" toast target, so an in-app toast can appear
  in each open Desktop window; the native notification remains deduplicated.
- Separate OpenCode server processes cannot share a live poller. Each process uses its own plugin runtime, though each
  retains a durable baseline to suppress restart duplicates.
- The current-repository filter is unavailable when `gh repo view` cannot resolve the session directory; the all-repos
  queue remains usable.
- The TUI has no client-side URL-opening API in v2.3.0. Its Open action runs `gh pr view --web` where the OpenCode
  server is running, which is normally the local machine; Desktop opens the URL directly on the client.
