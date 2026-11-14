# OpenCode GitHub Review Queue

See GitHub review requests without leaving OpenCode.

This plugin adds a pending-review queue to the OpenCode TUI and Desktop app. It uses the authenticated GitHub CLI
account, keeps the last successful queue available while offline, and notifies you when a new review request appears.

## Features

- One shared review queue for the TUI and Desktop.
- Current-repository and all-repositories views.
- Native and in-app notifications for new requests.
- Direct GitHub opening and copy actions.
- Paginated GitHub search with timeouts, backoff, and rate-limit handling.
- Persistent state that avoids duplicate notifications after restarting OpenCode.

## Requirements

- OpenCode 2.3.0.
- [GitHub CLI](https://cli.github.com/) installed and authenticated.

Verify GitHub authentication before enabling the plugin:

```sh
gh auth status
```

If needed, authenticate with:

```sh
gh auth login
```

## Installation

Add the package to the `plugins` array in your global `~/.config/opencode/opencode.jsonc`:

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

OpenCode downloads the package and loads its server, TUI, and Desktop integrations automatically. The global
configuration is required for the Desktop integration.

OpenCode watches its configuration. Run `/reload` only if you need to force an already-open client to reload.

## Usage

### TUI

Run `/reviews` or choose **Show GitHub review requests** from the command palette.

- `j` / `k`: move selection
- `Enter`: open the selected pull request
- `c`: copy the pull request number
- `y`: copy `owner/repo#123`
- `u`: copy the URL
- `f`: switch between the current repository and all repositories
- `r`: refresh
- `Shift+F`: toggle full screen

Clipboard actions use OSC 52 and require terminal support.

### Desktop

Open the pinned **Review requests** side-panel tab or choose **Show GitHub review requests** from the command palette.
Use **Current** and **All** to change scope. Click a review request to open it, or use its menu to copy its number,
qualified reference, or URL.

## Configuration

Pass options with the object form of the plugin entry:

```jsonc
{
  "plugins": [
    {
      "package": "opencode-github-review-queue",
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

- `intervalMs`: polling interval. Defaults to 60 seconds; minimum 10 seconds.
- `timeoutMs`: timeout for GitHub CLI requests. Defaults to 20 seconds.
- `maxBackoffMs`: maximum delay after transient failures. Defaults to 15 minutes.
- `notifications`: enables native and terminal-attention notifications. Defaults to `true`; in-app toasts remain
  enabled when this is `false`.

Desktop notifications also follow **Settings > Notifications**. TUI notifications follow its attention preferences.

## How it works

The server plugin runs one non-overlapping poller using GitHub's
`is:pr is:open review-requested:@me` search. The first successful refresh establishes a silent baseline. Later queue
additions produce notifications, including a request that leaves the queue and is requested again.

Malformed, partial, timed-out, or failed responses never replace the last successful queue. The plugin spawns `gh`
directly without a shell and does not read or persist GitHub tokens.

## Development

```sh
git clone https://github.com/andremarques94/opencode-github-review-queue.git
cd opencode-github-review-queue
pnpm install
pnpm check
```

To load a development checkout, replace the package name in the global configuration with the checkout's absolute
path. Run `pnpm build` after changing the Desktop integration.

The source tree is organized by runtime boundary:

- `src/server`: server entry, GitHub adapter, and polling state machine
- `src/rpc`: shared RPC contract
- `src/tui`: TUI entry and components
- `src/gui`: Desktop entry and components
- `src/domain`: review queue domain types and comparison rules
- `src/shared`: runtime-neutral options and presentation helpers

Releases use Conventional Commits and Release Please. Merging a release PR creates a GitHub release and publishes the
same version to npm.

## Limitations

- GitHub search returns at most 1,000 results.
- Polling cannot observe a request added and removed entirely between successful refreshes.
- Separate OpenCode server processes maintain separate live pollers and persisted baselines.
- The current-repository filter requires `gh repo view` to resolve the session directory.
- TUI URL opening runs `gh pr view --web` on the machine hosting the OpenCode server.

## License

[MIT](LICENSE)
