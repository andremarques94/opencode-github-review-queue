import { beforeEach, describe, expect, it, vi } from "vitest"
import type { ReviewRequest } from "../src/domain/review-request.js"

const github = vi.hoisted(() => ({ fetchDiff: vi.fn(), fetchPullRequestText: vi.fn() }))
vi.mock("../src/server/github/pull-request.js", () => github)

const { capDiff, summarize } = await import("../src/server/review/summary.js")
const { summaryFlow } = await import("../src/shared/review/summary.js")
type SummaryFlowHost = import("../src/shared/review/summary.js").SummaryFlowHost

const item: ReviewRequest = {
  key: "acme/api#7",
  repository: "acme/api",
  number: 7,
  title: "Add b",
  author: "octocat",
  draft: false,
  createdAt: "2026-01-01T00:00:00Z",
  url: "https://github.com/acme/api/pull/7",
}
const signal = new AbortController().signal

beforeEach(() => {
  github.fetchPullRequestText.mockResolvedValue({ title: "Add b", body: "Adds b." })
  github.fetchDiff.mockResolvedValue("+const b = 2\n")
})

describe("capDiff", () => {
  it("keeps a small diff whole", () => {
    expect(capDiff("a\nb\n", 10)).toEqual({ diff: "a\nb\n", truncated: false })
  })

  it("cuts a large diff at a line break", () => {
    expect(capDiff("line one\nline two\n", 12)).toEqual({ diff: "line one", truncated: true })
  })
})

describe("summarize", () => {
  it("sends the title, description, and diff, and returns the model's text", async () => {
    const generate = vi.fn(async (_prompt: string, _signal: AbortSignal) => "  ## Intent\nAdds b.  ")

    expect(await summarize(item, generate, signal)).toEqual({ summary: "## Intent\nAdds b.", truncated: false })
    const prompt = generate.mock.calls[0]?.[0]
    expect(prompt).toContain("Adds b.")
    expect(prompt).toContain("+const b = 2")
    expect(prompt).not.toContain("cut short")
  })

  it("tells the model and the user when the diff was cut", async () => {
    github.fetchDiff.mockResolvedValue(`${"+x\n".repeat(40_000)}`)
    const generate = vi.fn(async (_prompt: string, _signal: AbortSignal) => "Summary")

    expect((await summarize(item, generate, signal)).truncated).toBe(true)
    expect(generate.mock.calls[0]?.[0]).toContain("The diff was cut short")
  })

  it("refuses an empty answer", async () => {
    await expect(summarize(item, async () => " ", signal)).rejects.toThrow(/empty summary/)
  })
})

describe("summaryFlow", () => {
  const model = { providerID: "acme", id: "fast", name: "Fast", provider: "Acme" }
  const host = (summarize: SummaryFlowHost["summarize"], picked: typeof model | undefined) => ({
    models: async () => ({ models: [model], preferred: null }),
    select: vi.fn(async () => picked) as SummaryFlowHost["select"],
    notify: vi.fn(),
    summarize: vi.fn(summarize),
    showSummary: vi.fn(),
  })

  it("summarizes with the picked model and says when the diff was cut", async () => {
    const flow = host(async () => ({ summary: "## Intent", truncated: true }), model)

    await summaryFlow(flow, item)

    expect(flow.summarize).toHaveBeenCalledWith({ key: item.key, model: { providerID: "acme", id: "fast" } })
    expect(flow.showSummary).toHaveBeenCalledWith({
      title: "acme/api#7 · Add b",
      note: "By Fast · The diff was too large and was cut short, so this covers only part of it.",
      markdown: "## Intent",
    })
  })

  it("warns before picking a model when the diff will not fit", async () => {
    const flow = host(async () => ({ summary: "", truncated: false }), undefined)

    await summaryFlow(flow, { ...item, additions: 1_400, deletions: 200 })
    await summaryFlow(flow, { ...item, additions: 10, deletions: 2 })

    const titles = vi.mocked(flow.select).mock.calls.map(([input]) => input.title)
    expect(titles).toEqual([
      "Summarize acme/api#7? It changes 1,600 lines, so only part of the diff will fit. Pick the model",
      "Summarize acme/api#7? Pick the model",
    ])
  })

  it("does nothing when no model is picked", async () => {
    const flow = host(async () => ({ summary: "", truncated: false }), undefined)

    await summaryFlow(flow, item)

    expect(flow.summarize).not.toHaveBeenCalled()
  })

  it("names the model when it fails", async () => {
    const flow = host(async () => {
      throw { type: "failed", message: "Free usage limit reached." }
    }, model)

    await expect(summaryFlow(flow, item)).rejects.toThrow("Fast (Acme): Free usage limit reached.")
  })
})
