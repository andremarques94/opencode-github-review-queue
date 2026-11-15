import { applyQueueRules } from "../domain/queue-filter.js"
import { sortQueue } from "../domain/queue-order.js"
import { type ReviewedRecord, withFollowUps } from "../domain/review-history.js"
import type { PluginOptions } from "../shared/options.js"
import {
  fetchAuthoredPullRequests,
  fetchReviewedPullRequests,
  fetchReviewRequests,
  type SearchResult,
} from "./github/review-requests.js"
import type { FetchQueue } from "./review-queue-poller.js"

const NOTHING: SearchResult = { items: [] }

const latest = (...times: (string | undefined)[]) =>
  times.reduce<string | undefined>((last, time) => (time && (!last || time > last) ? time : last), undefined)

/** Any search failing fails the refresh, so the saved queue stays whole instead of losing part of it for one poll. */
export function queueSource(options: PluginOptions, reviewed: { list(): Promise<ReviewedRecord[]> }): FetchQueue {
  return async (signal) => {
    const records = options.followUps ? await reviewed.list() : []
    const [requested, candidates, authored] = await Promise.all([
      fetchReviewRequests(signal),
      records.length > 0 ? fetchReviewedPullRequests(signal) : NOTHING,
      options.myPullRequests ? fetchAuthoredPullRequests(signal) : undefined,
    ])
    const queued = applyQueueRules(withFollowUps(requested.items, candidates.items, records), options)
    const retryAt = latest(requested.retryAt, candidates.retryAt, authored?.retryAt)
    return {
      items: sortQueue(queued, options.sort),
      ...(authored ? { authored: sortQueue(authored.items, options.sort) } : {}),
      ...(retryAt ? { retryAt } : {}),
    }
  }
}
