import * as v from "valibot"
import type { ReviewPayload } from "../../domain/review-draft.js"
import { runGh } from "./cli.js"

const PullRequestInfo = v.object({
  title: v.string(),
  state: v.string(),
  headRefOid: v.string(),
  baseRefOid: v.string(),
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
    [
      "pr",
      "view",
      String(number),
      "--repo",
      repository,
      "--json",
      "title,state,headRefOid,baseRefOid,baseRefName,author",
    ],
    { signal },
  )
  return parseJson(PullRequestInfo, result.stdout, `${repository}#${number}`)
}

const PullRequestText = v.object({ title: v.string(), body: v.string() })

export async function fetchPullRequestText(repository: string, number: number, signal: AbortSignal) {
  const result = await runGh(["pr", "view", String(number), "--repo", repository, "--json", "title,body"], { signal })
  return parseJson(PullRequestText, result.stdout, `${repository}#${number}`)
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

const StatesResponse = v.object({
  data: v.record(v.string(), v.nullable(v.object({ pullRequest: v.nullable(v.object({ state: v.string() })) }))),
})
const STATES_PER_QUERY = 50

/** The state of each pull request by key, in one GraphQL request per batch; unknown ones are left out. */
export async function pullRequestStates(
  pullRequests: readonly { key: string; repository: string; number: number }[],
  signal: AbortSignal,
): Promise<Map<string, string>> {
  const states = new Map<string, string>()
  for (let start = 0; start < pullRequests.length; start += STATES_PER_QUERY) {
    const batch = pullRequests.slice(start, start + STATES_PER_QUERY)
    // Repository names and numbers travel as variables, never inside the query text.
    const variables = batch.map((_, index) => `$o${index}: String!, $r${index}: String!, $n${index}: Int!`)
    const fields = batch.map(
      (_, index) =>
        `p${index}: repository(owner: $o${index}, name: $r${index}) { pullRequest(number: $n${index}) { state } }`,
    )
    const args = batch.flatMap((pullRequest, index) => {
      const [owner = "", name = ""] = pullRequest.repository.split("/")
      return ["-f", `o${index}=${owner}`, "-f", `r${index}=${name}`, "-F", `n${index}=${pullRequest.number}`]
    })
    const result = await runGh(
      ["api", "graphql", "-f", `query=query(${variables.join(", ")}) { ${fields.join(" ")} }`, ...args],
      { signal },
    )
    const data = parseJson(StatesResponse, result.stdout, "pull request states").data
    batch.forEach((pullRequest, index) => {
      const state = data[`p${index}`]?.pullRequest?.state
      if (state) {
        states.set(pullRequest.key, state)
      }
    })
  }
  return states
}
