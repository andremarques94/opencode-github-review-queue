import { describe, expect, it } from "vitest"
import { ADDRESS_PERMISSIONS, REVIEW_PERMISSIONS } from "../src/server/review/agent/permissions.js"

type Rule = { action: string; resource: string; effect: "allow" | "deny" | "ask" }

/** OpenCode's matching, as documented: whole-value `*` and `?`, and a trailing ` *` also matches the bare command. */
function matches(pattern: string, value: string): boolean {
  const regex = (text: string) =>
    new RegExp(
      `^${text
        .replace(/[.+^${}()|[\]\\]/g, "\\$&")
        .replaceAll("*", ".*")
        .replaceAll("?", ".")}$`,
      "s",
    )
  return regex(pattern).test(value) || (pattern.endsWith(" *") && regex(pattern.slice(0, -2)).test(value))
}

const denied = (rules: readonly Rule[], command: string) =>
  rules.some((rule) => rule.action === "shell" && rule.effect === "deny" && matches(rule.resource, command))

const WRITES = [
  "git push",
  "git push origin feature/b",
  "git -C /work/api push --force",
  "gh pr review 7 --approve",
  "gh pr comment 7 --body 'Done'",
  "gh pr merge 7 --squash",
  "gh pr edit 7 --title x",
  "gh pr ready 7",
  "gh issue comment 3 --body hi",
  "gh api -X POST repos/acme/api/pulls/7/reviews",
  "gh api repos/acme/api/pulls/7/comments/9/replies -f body=Done",
  "gh api repos/acme/api/pulls/7 --method PATCH -F state=closed",
  "gh api repos/acme/api/pulls/7/reviews --input review.json",
  "gh api graphql -f query='mutation { resolveReviewThread(input: {threadId: \"x\"}) { thread { id } } }'",
]

describe("review session permissions", () => {
  it.each(WRITES)("denies %s", (command) => {
    expect(denied(REVIEW_PERMISSIONS, command)).toBe(true)
  })

  it.each([
    'gh api repos/acme/api/compare/aaa...bbb -H "Accept: application/vnd.github.diff"',
    "gh api repos/acme/api/pulls/7/reviews --paginate",
    "gh api repos/acme/api/pulls/7/comments --paginate --jq '.[] | select(.user.login == \"me\")'",
    "gh pr view 7 --repo acme/api --json title,body",
    "gh pr diff 7 --repo acme/api",
    "git log --oneline main..HEAD",
    "git fetch origin",
  ])("still reads with %s", (command) => {
    expect(denied(REVIEW_PERMISSIONS, command)).toBe(false)
  })

  it("keeps file edits denied", () => {
    expect(REVIEW_PERMISSIONS).toContainEqual({ action: "edit", resource: "*", effect: "deny" })
  })
})

describe("address session permissions", () => {
  it.each([...WRITES, "gh api repos/acme/api/pulls/7/comments --paginate"])("denies %s", (command) => {
    expect(denied(ADDRESS_PERMISSIONS, command)).toBe(true)
  })

  it.each(["git status", "git commit -m 'Rename b to total'", "pnpm test", "gh pr view 7", "gh pr checks 7"])(
    "allows %s",
    (command) => {
      expect(denied(ADDRESS_PERMISSIONS, command)).toBe(false)
    },
  )

  it("lets the agent edit files", () => {
    expect(ADDRESS_PERMISSIONS.some((rule) => rule.action === "edit")).toBe(false)
  })
})
