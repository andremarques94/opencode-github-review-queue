/**
 * Shell commands the agent may not run, because they push or write to GitHub; the user does those. OpenCode matches
 * each pattern against the whole command, for every subcommand its scanner extracts (`cd x && git push` included), and
 * a pattern ending in ` *` also matches the bare command. The agent can still reach GitHub another way, such as `curl`
 * with a token, so its instructions say the same.
 */
const PUSH = [
  "git push *",
  // `git -C dir push`; a commit whose message holds the word "push" is refused too, which is safe.
  "git * push *",
]

const GITHUB_WRITES = [
  ...["merge", "review", "comment", "edit", "close", "reopen", "ready", "create", "lock", "unlock"].map(
    (command) => `gh pr ${command} *`,
  ),
  ...["create", "comment", "edit", "close", "reopen", "delete", "lock", "unlock"].map(
    (command) => `gh issue ${command} *`,
  ),
]

/** `gh api` posts when given a method, a field, or a body; GraphQL can mutate, and these sessions only read REST. */
const API_WRITES = [
  "gh api graphql *",
  "gh api *-X*",
  "gh api *--method*",
  "gh api *-f *",
  "gh api *-F *",
  "gh api *--field*",
  "gh api *--raw-field*",
  "gh api *--input*",
]

const deny = (resources: readonly string[]) =>
  resources.map((resource) => ({ action: "shell", resource, effect: "deny" as const }))

/** Review sessions read GitHub through `gh api` (the pinned diff, earlier comments), and never edit files. */
export const REVIEW_PERMISSIONS = [
  { action: "edit", resource: "*", effect: "deny" as const },
  ...deny([...PUSH, ...GITHUB_WRITES, ...API_WRITES]),
]

/** Address sessions edit the user's checkout, and get the review threads up front, so they need no `gh api` at all. */
export const ADDRESS_PERMISSIONS = deny([...PUSH, ...GITHUB_WRITES, "gh api *"])
