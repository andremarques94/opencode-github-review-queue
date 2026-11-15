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

/** Refuses a name git could read as an option or that leaves the refs namespace; GitHub's own names pass. */
const BranchName = v.pipe(
  v.string(),
  v.regex(/^[\w.][\w./-]*$/),
  v.check((name) => !name.includes("..") && !name.endsWith("/") && !name.endsWith(".lock")),
)

const PullRequestBranch = v.object({
  state: v.string(),
  headRefName: BranchName,
  isCrossRepository: v.boolean(),
})

export async function fetchPullRequestBranch(repository: string, number: number, signal: AbortSignal) {
  const result = await runGh(
    ["pr", "view", String(number), "--repo", repository, "--json", "state,headRefName,isCrossRepository"],
    { signal },
  )
  return parseJson(PullRequestBranch, result.stdout, `${repository}#${number}`)
}

export type OpenThread = {
  path: string
  /** Missing once the code it was on changed. */
  line?: number
  outdated: boolean
  comments: { author: string; body: string }[]
}

const ThreadsResponse = v.object({
  data: v.object({
    repository: v.object({
      pullRequest: v.object({
        reviewThreads: v.object({
          nodes: v.array(
            v.object({
              isResolved: v.boolean(),
              isOutdated: v.boolean(),
              path: v.string(),
              line: v.nullable(v.number()),
              comments: v.object({
                nodes: v.array(
                  v.object({
                    author: v.fallback(v.object({ login: v.string() }), { login: "ghost" }),
                    body: v.string(),
                  }),
                ),
              }),
            }),
          ),
        }),
      }),
    }),
  }),
})

const THREADS_QUERY = `query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      reviewThreads(first: 100) {
        nodes { isResolved isOutdated path line comments(first: 50) { nodes { author { login } body } } }
      }
    }
  }
}`

/** The review threads nobody resolved yet, in GitHub's order. */
export async function fetchOpenThreads(repository: string, number: number, signal: AbortSignal) {
  const [owner = "", name = ""] = repository.split("/")
  const result = await runGh(
    [
      "api",
      "graphql",
      "-f",
      `query=${THREADS_QUERY}`,
      "-f",
      `owner=${owner}`,
      "-f",
      `name=${name}`,
      "-F",
      `number=${number}`,
    ],
    { signal },
  )
  const threads = parseJson(ThreadsResponse, result.stdout, `the review threads of ${repository}#${number}`).data
    .repository.pullRequest.reviewThreads.nodes
  return threads
    .filter((thread) => !thread.isResolved)
    .map(
      (thread): OpenThread => ({
        path: thread.path,
        ...(thread.line === null ? {} : { line: thread.line }),
        outdated: thread.isOutdated,
        comments: thread.comments.nodes.map((comment) => ({ author: comment.author.login, body: comment.body })),
      }),
    )
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

/** The diff between two exact commits; unlike `gh pr diff`, it does not move when the author pushes. */
export async function fetchCompareDiff(
  repository: string,
  base: string,
  head: string,
  signal: AbortSignal,
): Promise<string> {
  const result = await runGh(
    ["api", `repos/${repository}/compare/${base}...${head}`, "-H", "Accept: application/vnd.github.diff"],
    { signal },
  )
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
