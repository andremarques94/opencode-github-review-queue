# Contributing

## Setup

Install Node.js 22 or newer, pnpm, and Gitleaks. Then install the project
dependencies:

```sh
pnpm install
```

The `prepare` script installs the Husky hooks. They scan staged changes for
secrets, format supported files with Biome, and validate commit messages.

## Changes

Create a branch from `main` and open a pull request. Direct pushes to `main`
are blocked.

Before opening a pull request, run:

```sh
pnpm check
pnpm fallow:audit
gitleaks git --redact --no-banner
```

## Commits

Commit messages follow
[Conventional Commits](https://www.conventionalcommits.org/):

```text
<type>(<optional scope>): <summary>
```

Common types are `feat`, `fix`, `docs`, `refactor`, `test`, `perf`, `build`,
`ci`, and `chore`. Release Please uses `feat` for minor releases and `fix` for
patch releases.
