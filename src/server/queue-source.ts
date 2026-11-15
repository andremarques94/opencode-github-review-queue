import { applyQueueRules } from "../domain/queue-filter.js"
import { sortQueue } from "../domain/queue-order.js"
import { type ReviewedRecord, withFollowUps } from "../domain/review-history.js"
import type { QueueError } from "../domain/review-queue.js"
import { hostField, hostOf, type ReviewRequest } from "../domain/review-request.js"
import type { PluginOptions } from "../shared/options.js"
import { GhError } from "./github/cli.js"
import { checkGhVersion, discoverHosts, type GitHubHost } from "./github/hosts.js"
import {
  fetchAuthoredPullRequests,
  fetchReviewedPullRequests,
  fetchReviewRequests,
  type SearchResult,
} from "./github/review-requests.js"
import type { FetchQueue, FetchResult } from "./review-queue-poller.js"

const NOTHING: SearchResult = { items: [] }

const latest = (...times: (string | undefined)[]) =>
  times.reduce<string | undefined>((last, time) => (time && (!last || time > last) ? time : last), undefined)

type HostQueue = { items: ReviewRequest[]; authored?: ReviewRequest[]; retryAt?: string }

/** Any search failing fails the host, so its saved items stay whole instead of losing part of them for one poll. */
async function fetchHost(
  host: string,
  options: PluginOptions,
  records: readonly ReviewedRecord[],
  signal: AbortSignal,
): Promise<HostQueue> {
  const [requested, candidates, authored] = await Promise.all([
    fetchReviewRequests(host, signal),
    records.length > 0 ? fetchReviewedPullRequests(host, signal) : NOTHING,
    options.myPullRequests ? fetchAuthoredPullRequests(host, signal) : undefined,
  ])
  const retryAt = latest(requested.retryAt, candidates.retryAt, authored?.retryAt)
  return {
    items: applyQueueRules(withFollowUps(requested.items, candidates.items, records), options),
    ...(authored ? { authored: authored.items } : {}),
    ...(retryAt ? { retryAt } : {}),
  }
}

type Health = { failures: number; nextAt: number; error?: QueueError; retryAt?: string }

const detail = (error: unknown): QueueError => {
  if (error instanceof GhError) {
    return error.detail
  }
  return { kind: "unknown", message: error instanceof Error ? error.message : "GitHub refresh failed." }
}

type Failure = { host: string; error: QueueError }

/** One host's failure reads as before; several name their hosts. */
function combined(failures: readonly [Failure, ...Failure[]], partial: boolean): QueueError {
  const [first] = failures
  const message =
    failures.length === 1 && !partial
      ? first.error.message
      : failures.map(({ host, error }) => `${host}: ${error.message}`).join(" ")
  return {
    kind: first.error.kind,
    message,
    ...(first.error.retryAt ? { retryAt: first.error.retryAt } : {}),
    ...(partial ? { hosts: failures.map(({ host }) => host) } : {}),
  }
}

/**
 * Queries every host `gh` is logged into on its own. A failing host keeps its last items, backs off alone, and leaves
 * the others fresh; only when every host fails does the refresh fail.
 */
export function queueSource(
  options: PluginOptions,
  reviewed: { list(): Promise<ReviewedRecord[]> },
  now: () => number = Date.now,
): FetchQueue {
  let versionChecked = false
  let hosts: GitHubHost[] | undefined
  const health = new Map<string, Health>()
  const due = (host: string, manual: boolean) => manual || now() >= (health.get(host)?.nextAt ?? 0)
  const backoff = (failures: number) => Math.min(options.maxBackoffMs, options.intervalMs * 2 ** Math.min(failures, 6))

  /**
   * `gh auth status` checks every host over the network, so it runs at start, on demand, after a login failure, and
   * again for a host whose last check failed, once its backoff lapses.
   */
  const rediscover = (manual: boolean) =>
    !hosts ||
    manual ||
    hosts.some(
      ({ host, error }) =>
        (error !== undefined || health.get(host)?.error?.kind === "authentication") && due(host, false),
    )

  const record = (host: string, outcome: HostQueue | QueueError) => {
    if ("kind" in outcome) {
      const failures = (health.get(host)?.failures ?? 0) + 1
      const until = outcome.retryAt ? Date.parse(outcome.retryAt) : Number.NaN
      const nextAt = Math.max(now() + backoff(failures), Number.isFinite(until) ? until : 0)
      health.set(host, { failures, nextAt, error: outcome })
      return
    }
    const until = outcome.retryAt ? Date.parse(outcome.retryAt) : Number.NaN
    health.set(host, {
      failures: 0,
      nextAt: Number.isFinite(until) ? until : 0,
      ...(outcome.retryAt ? { retryAt: outcome.retryAt } : {}),
    })
  }

  return async (signal, { manual, previous }) => {
    if (!versionChecked) {
      await checkGhVersion(signal)
      versionChecked = true
    }
    const discovered = rediscover(manual)
    if (discovered) {
      hosts = await discoverHosts(signal)
    }
    const current = hosts ?? []
    const records = options.followUps ? await reviewed.list() : []
    const onHost = <T extends { host?: string }>(list: readonly T[] | undefined, host: string) =>
      (list ?? []).filter((entry) => hostOf(entry) === hostOf(hostField(host)))

    const outcomes = await Promise.all(
      current.map(async ({ host, error }): Promise<{ host: string; queue: HostQueue; error?: QueueError }> => {
        const retained = { items: onHost(previous.items, host), authored: onHost(previous.authored, host) }
        if (error) {
          // Counted once per check, so the backoff that gates the next check can lapse.
          if (discovered) {
            record(host, error)
          }
          return { host, queue: retained, error }
        }
        if (!due(host, manual)) {
          const last = health.get(host)?.error
          return { host, queue: retained, ...(last ? { error: last } : {}) }
        }
        const own = onHost(records, host)
        try {
          const queue = await fetchHost(host, options, own, signal)
          record(host, queue)
          return { host, queue }
        } catch (failure) {
          if (signal.aborted) {
            throw failure
          }
          record(host, detail(failure))
          return { host, queue: retained, error: detail(failure) }
        }
      }),
    )

    const failures = outcomes.flatMap(({ host, error }) => (error ? [{ host, error }] : []))
    const [first, ...rest] = failures
    if (first && failures.length === outcomes.length) {
      throw new GhError(combined([first, ...rest], false))
    }
    const items = outcomes.flatMap(({ queue }) => queue.items)
    const authored = outcomes.flatMap(({ queue }) => queue.authored ?? [])
    // The poller only waits for a rate limit when every host is held back by one.
    const limits = current.map(({ host }) => health.get(host)?.retryAt)
    const retryAt = limits.every((limit) => limit !== undefined) ? limits.sort()[0] : undefined
    return {
      items: sortQueue(items, options.sort),
      ...(options.myPullRequests ? { authored: sortQueue(authored, options.sort) } : {}),
      ...(retryAt ? { retryAt } : {}),
      ...(first ? { error: combined([first, ...rest], true) } : {}),
    } satisfies FetchResult
  }
}
