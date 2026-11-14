import { afterEach, describe, expect, it, vi } from "vitest"
import { type ReviewRequest, requestKey } from "@/domain/review-request.js"
import { createDiscoveryBatcher } from "@/shared/notifications/discovery-batcher.js"
import { notificationText } from "@/shared/notifications/notification-text.js"

const item = (repository: string, number: number, title = `PR ${number}`): ReviewRequest => ({
  key: requestKey(repository, number),
  repository,
  number,
  title,
  author: "octocat",
  draft: false,
  createdAt: "2026-01-01T00:00:00.000Z",
  url: `https://github.com/${repository}/pull/${number}`,
})

afterEach(() => {
  vi.useRealTimers()
})

describe("createDiscoveryBatcher", () => {
  it("delivers one batch and drops relayed duplicates", () => {
    vi.useFakeTimers()
    const deliver = vi.fn()
    const batcher = createDiscoveryBatcher(deliver, { delayMs: 100 })
    const one = item("acme/api", 1)
    const two = item("acme/web", 2)

    batcher.push(one)
    batcher.push(one)
    batcher.push(two)
    vi.advanceTimersByTime(100)
    batcher.push(one)
    vi.advanceTimersByTime(100)

    expect(deliver).toHaveBeenCalledTimes(1)
    expect(deliver).toHaveBeenCalledWith([one, two])
  })

  it("delivers a key again after the window", () => {
    vi.useFakeTimers()
    let now = 0
    const deliver = vi.fn()
    const batcher = createDiscoveryBatcher(deliver, { delayMs: 10, windowMs: 1_000, now: () => now })
    const one = item("acme/api", 1)

    batcher.push(one)
    vi.advanceTimersByTime(10)
    now = 2_000
    batcher.push(one)
    vi.advanceTimersByTime(10)

    expect(deliver).toHaveBeenCalledTimes(2)
  })
})

describe("notificationText", () => {
  it("keeps a single request compact", () => {
    expect(notificationText([item("acme/api", 7, "Fix login")])).toEqual({
      title: "Review requested · api #7",
      message: "Fix login",
    })
  })

  it("summarizes several requests", () => {
    const items = [1, 2, 3, 4].map((number) => item("acme/api", number))
    expect(notificationText(items)).toEqual({
      title: "4 new review requests",
      message: "api #1, api #2, api #3 +1 more",
    })
  })
})
