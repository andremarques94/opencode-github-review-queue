import * as v from "valibot"
import type { ReviewPayload } from "../../domain/review-draft.js"
import { runGh } from "./cli.js"

const PullRequestInfo = v.object({
  title: v.string(),
  state: v.string(),
  headRefOid: v.string(),
  baseRefName: v.string(),
  author: v.fallback(v.object({ login: v.string() }), { login: "ghost" }),
})

function parseJson<T>(schema: v.GenericSchema<unknown, T>, stdout: string, what: string): T {
  let value: unknown
  try {
    value = JSON.parse(stdout)
  } catch {
    throw new Error(`GitHub returned malformed JSON for ${what}.`)
  }
  const parsed = v.safeParse(schema, value)
  if (!parsed.success) {
    throw new Error(`GitHub returned an unexpected response for ${what}.`)
  }
  return parsed.output
}

export async function fetchPullRequest(repository: string, number: number, signal: AbortSignal) {
  const result = await runGh(
    ["pr", "view", String(number), "--repo", repository, "--json", "title,state,headRefOid,baseRefName,author"],
    { signal },
  )
  return parseJson(PullRequestInfo, result.stdout, `${repository}#${number}`)
}

export async function viewerLogin(signal: AbortSignal): Promise<string> {
  const result = await runGh(["api", "user", "--jq", ".login"], { signal })
  return result.stdout.trim()
}

export async function fetchDiff(repository: string, number: number, signal: AbortSignal): Promise<string> {
  const result = await runGh(["pr", "diff", String(number), "--repo", repository], { signal })
  return result.stdout
}

const PostedReview = v.object({ html_url: v.string() })

export async function postReview(
  repository: string,
  number: number,
  payload: ReviewPayload,
  signal: AbortSignal,
): Promise<string> {
  const result = await runGh(
    ["api", `repos/${repository}/pulls/${number}/reviews`, "--method", "POST", "--input", "-"],
    { signal, input: JSON.stringify(payload) },
  )
  return parseJson(PostedReview, result.stdout, "the posted review").html_url
}
