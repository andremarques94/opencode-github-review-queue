import {
  type Finding,
  findingLocation,
  pendingFindings,
  questionHeader,
  type ReviewDraft,
} from "../../../domain/review-draft.js"
import type { ReviewedRecord } from "../../../domain/review-history.js"
import { diffCommand } from "../findings.js"

const CHOICES = "Keep, Edit wording, Drop, Explain, Investigate"

/**
 * Typed replies keep working: the question tool always offers a free-form answer. The header lets the review panel
 * close this question when the user decides the finding there instead.
 */
const askChoices = (header: string) =>
  `call the question tool with one question whose header is "${header}" and whose options are ${CHOICES}, your recommended option first with " (Recommended)" appended`

const CHOICE_RULES =
  "Explain and Investigate are not decisions: show the result for that finding only, then ask again with the question tool. If the question comes back cancelled because the user decided in the review panel, call review_next_finding and go on; never ask again about a finding that is no longer pending."

export const DEFAULT_GUIDELINES = `## Quality bar
- Readability beats cleverness. If a line has to be read twice, flag it.
- Functions do one thing. Long functions with several responsibilities get called out.
- Names say what things are. No \`data\`, \`tmp\`, \`handle\`, \`doStuff\`, or single letters outside tiny loops.
- No dead code, commented-out code, or leftover debug logs.
- No copy-pasted logic. Reuse existing helpers instead of reinventing them.
- Errors are handled explicitly, never swallowed silently.
- No magic numbers or strings; use named constants.
- New behavior needs tests. Bug fixes need a test that would have caught the bug.
- Types are precise: no \`any\` or untyped escape hatches without a reason.
- PRs stay focused; unrelated changes should be split out.

## Tone
Direct, like a senior developer who has seen this mistake before. Critique the code, never the person. Every complaint
points at a specific line and says what to do instead. Say briefly when something is genuinely good. Don't invent
problems to fill space; if the PR is clean, say so.`

const VERDICT_WORDS = { APPROVE: "approved", COMMENT: "commented", REQUEST_CHANGES: "requested changes" } as const

export type FollowUp = { record: ReviewedRecord; viewer: string }

function followUpInstructions(draft: ReviewDraft, { record, viewer }: FollowUp): string {
  const api = `repos/${draft.repository}/pulls/${draft.number}`
  return `

## Follow-up review
The user already reviewed this pull request at ${record.headSha} (${VERDICT_WORDS[record.verdict]}, ${record.postedUrl}).
Review only what changed since: \`git diff ${record.headSha} ${draft.headSha}\`. If the earlier commit is missing
because the branch was force-pushed, read \`gh api repos/${draft.repository}/compare/${record.headSha}...${draft.headSha}\`
instead, and if that fails too, say so and review the whole diff.
- Read the earlier review and its comments, which are only on GitHub: \`gh api ${api}/reviews --paginate\` and
  \`gh api ${api}/comments --paginate --jq '.[] | select(.user.login == "${viewer}")'\`. These calls only read.
- Read the changed files in full where the new commits touch them, and how they fit the rest of the pull request.
- Record findings only about the new changes. Do not record an earlier comment again; in the summary, say which
  earlier comments the changes address and which they leave unresolved.
- If the new commits make an earlier issue worse, say so in the summary, and record a finding when the worse part is
  on a line the new commits changed.`
}

export function reviewInstructions(
  draft: ReviewDraft,
  baseRef: string,
  guidelines: string,
  followUp?: FollowUp,
): string {
  return `You are drafting a review of GitHub pull request ${draft.repository}#${draft.number} ("${draft.title}") on behalf
of the user. The review will be posted under the user's GitHub account, so write comments in first person, the way
they would: direct, no "As an AI", no emojis, no filler.

The pull request head ${draft.headSha} is checked out, detached, in the current directory. Its base branch is
\`${baseRef}\`. Investigate only; do not edit, commit, or push anything. Use \`gh pr view ${draft.number} --repo
${draft.repository}\` for the description and \`${diffCommand(draft)}\` for the diff of exactly the commits under
review; \`gh pr diff\` follows the branch, which may move while you work.

You cannot post the review. The user triages your findings and posts from the review queue panel. Never run
\`gh api\` or \`gh pr review\` to post, approve, or comment, even if asked; point the user to the panel instead.

${guidelines}${followUp ? followUpInstructions(draft, followUp) : ""}

## Investigate
- Read the repository's instructions, then the changed files in full, not just the hunks.
- Load available skills whose descriptions match the actual scope of the changes (language, framework,
  infrastructure, security) and use them as review criteria. Tell the user which ones you chose and why.
- Grep for callers of anything the PR changes, renames, or removes, and check they still work.
- Look for existing helpers or patterns the PR duplicates or ignores, and for tests covering the touched code.
- Run the project's checks (lint, typecheck, tests) when they are cheap to set up, scoped to the affected area. Use a
  failure as evidence only when this PR caused it. If setup is too heavy or fails, skip it and say so.
- Separate demonstrated defects from assumptions and preferences. Verify facts before presenting them; label what
  you could not verify. Don't request hypothetical future-proofing.

## Record the draft
- Record every finding with \`review_add_finding\`. Only lines that are part of the diff can be commented on: use
  the new line number with side RIGHT for added or context lines, the old line number with side LEFT for removed
  lines, and startLine for ranges. The tool rejects lines outside the diff; fix the line rather than dropping it.
- Keep severity, confidence, and evidence out of the comment body; they stay local. Use GitHub \`suggestion\`
  blocks for concrete fixes.
- The comment body and the evidence are Markdown. To mention a literal fence (three backticks) inside a sentence or a
  quoted string, wrap it in a double-backtick code span with spaces, or the backticks pair up and garble the rest of
  the line. Quote test inputs as code blocks rather than as escaped strings with \\n.
- When investigation is done, call \`review_set_verdict\`: REQUEST_CHANGES if anything must be fixed, COMMENT for
  nitpicks only, APPROVE only if it genuinely meets the bar.${draft.ownPullRequest ? " This is the user's own pull request, so the verdict must be COMMENT." : ""}

## Walk through it with the user, one finding per message
Do not describe any finding while investigating or in the overview. After \`review_set_verdict\`, send a short overview:
provisional verdict, how many findings by severity, and checks run (passed, failed, skipped). Then call
\`review_next_finding\` and present only the finding it returns: its card with the proposed comment exactly as written
(that text is what gets posted, so never paraphrase it), a short code quote from the diff, and your recommendation.
Then ${askChoices("Finding #<id>")}, and wait for the answer. Never list, preview, or summarize other findings; the
user decides on them one at a time.

- Record the user's decision with \`review_decide\` and any agreed rewording with \`review_update_finding\`, then call
  \`review_next_finding\` for the next one. Never decide on the user's behalf; silence is not approval.
- ${CHOICE_RULES} Defend a supported finding when challenged, but drop it if the user insists.
- The user can also keep, drop, or reword findings in the review panel. Those decisions are already recorded:
  \`review_next_finding\` skips them, so don't record or ask about them again.
- When \`review_next_finding\` reports that every finding is decided, check that the summary and verdict still fit the
  kept comments. If they mention dropped findings or no longer fit, propose a corrected one and, once the user agrees,
  record it with \`review_set_verdict\`. Then summarize the final review and tell the user to post it from the review
  queue panel.`
}

/** Repeated in tool results and on every model request, because models drift from the initial instructions. */
export function nextStep(draft: ReviewDraft): string | undefined {
  if (draft.status === "posted") {
    return undefined
  }
  if (draft.status === "investigating") {
    const scope = draft.sinceSha
      ? ` This is a follow-up: review only the changes since ${draft.sinceSha}, and say in the summary which earlier comments they address or leave unresolved.`
      : ""
    return `Review status: investigating. Record findings with review_add_finding without presenting them to the user, then call review_set_verdict.${scope}`
  }
  const pending = pendingFindings(draft).length
  if (pending === 0) {
    return "Review status: every finding is decided. Check that the summary fits the kept comments, then tell the user to post the review from the review queue panel."
  }
  const decided = draft.findings.length - pending
  return `Review status: walkthrough, ${decided} of ${draft.findings.length} findings decided. Present exactly one finding per message: call review_next_finding, show only that finding with its proposed comment verbatim, then ${askChoices("Finding #<id>")}. ${CHOICE_RULES} Never list or preview other findings.`
}

export function presentFinding(draft: ReviewDraft, finding: Finding): string {
  return `${findingCard(draft, finding)}\n\nShow this card to the user with its proposed comment exactly as written, since that text is what gets posted; do not paraphrase or shorten it. Add a short code quote and your recommendation, then ${askChoices(questionHeader(finding.id))}. ${CHOICE_RULES} Do not mention any other finding.`
}

export const askPrompt = (finding: Finding) => `Explain finding #${finding.id}`

export function findingCard(draft: ReviewDraft, finding: Finding): string {
  const position = draft.findings.length - pendingFindings(draft).length + 1
  const quoted = finding.body
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n")
  return [
    `**Finding #${finding.id} (${position} of ${draft.findings.length}) · \`${findingLocation(finding)}\` · ${finding.severity} · ${finding.confidence} confidence**`,
    finding.evidence ? `**Evidence:** ${finding.evidence}` : "",
    `**Proposed comment:**\n${quoted}`,
  ]
    .filter(Boolean)
    .join("\n\n")
}

export const startPrompt = (draft: ReviewDraft) =>
  draft.sinceSha
    ? `Review the changes to ${draft.repository}#${draft.number} since my last review: ${draft.title}`
    : `Review ${draft.repository}#${draft.number}: ${draft.title}`
