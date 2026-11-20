import { describe, expect, it, vi } from "vitest"
import type { ReviewRequest } from "../src/domain/review-request.js"
import { pullRequestOptions } from "../src/ui/tui/actions/menu-options.js"
import type { ReviewActions } from "../src/ui/tui/actions/review-actions.js"

const item: ReviewRequest = {
  key: "acme/api#7",
  repository: "acme/api",
  number: 7,
  title: "Update API",
  author: "octocat",
  draft: false,
  createdAt: "2026-01-01T00:00:00Z",
  url: "https://github.com/acme/api/pull/7",
  headRefName: "feature/orion-123/api-client",
}

describe("copy branch action", () => {
  it("offers the source branch and invokes its clipboard action", () => {
    const copy = vi.fn()
    const options = pullRequestOptions({ copy } as unknown as ReviewActions, item, undefined, undefined, false)
    const branch = options.find((option) => option.title === "Copy branch name")
    expect(branch).toMatchObject({ description: item.headRefName, footer: "b", category: "Pull request" })
    branch?.value()
    expect(copy).toHaveBeenCalledWith("branch")
  })

  it("explains how to fetch a branch missing from an older queue", () => {
    const { headRefName: _, ...older } = item
    const options = pullRequestOptions({} as ReviewActions, older, undefined, undefined, false)
    expect(options.find((option) => option.title === "Copy branch name")?.description).toContain("Refresh the queue")
  })

  it("keeps the existing reference and link clipboard actions", () => {
    const copy = vi.fn()
    const options = pullRequestOptions({ copy } as unknown as ReviewActions, item, undefined, undefined, false)
    options.find((option) => option.title === "Copy reference")?.value()
    options.find((option) => option.title === "Copy link")?.value()
    expect(copy.mock.calls).toEqual([["reference"], ["link"]])
  })
})
