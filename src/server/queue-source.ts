import { applyQueueRules } from "../domain/queue-filter.js"
import { type ReviewedRecord, withFollowUps } from "../domain/review-history.js"
import type { PluginOptions } from "../shared/options.js"
import { fetchReviewedPullRequests, fetchReviewRequests, type SearchResult } from "./github/review-requests.js"
import type { FetchQueue } from "./review-queue-poller.js"

const NOTHING: SearchResult = { items: [] }

const later = (a: string | undefined, b: string | undefined) => (a && b ? (a > b ? a : b) : (a ?? b))

/**
 * The review requests plus the follow-ups, filtered by the user's rules. Without a posted review there is nothing to
 * follow up on, so the second search only runs once one is recorded. Either search failing fails the refresh, so the
 * saved queue stays whole instead of losing its follow-ups for one poll.
 */
export function queueSource(options: PluginOptions, reviewed: { list(): Promise<ReviewedRecord[]> }): FetchQueue {
  return async (signal) => {
    const records = options.followUps ? await reviewed.list() : []
    const [requested, candidates] = await Promise.all([
      fetchReviewRequests(signal),
      records.length > 0 ? fetchReviewedPullRequests(signal) : NOTHING,
    ])
    const items = applyQueueRules(withFollowUps(requested.items, candidates.items, records), options)
    const retryAt = later(requested.retryAt, candidates.retryAt)
    return { items, ...(retryAt ? { retryAt } : {}) }
  }
}
