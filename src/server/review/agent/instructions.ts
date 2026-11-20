import {
  commentBody,
  type Finding,
  findingLocation,
  pendingFindings,
  questionHeader,
  type ReviewDraft,
} from "../../../domain/review-draft.js"
import type { ReviewedRecord } from "../../../domain/review-history.js"
import type { LineComment } from "../../../shared/rpc.js"
import { diffCommand } from "../findings.js"

const CHOICES = "Keep, Edit wording, Drop, Explain, Investigate"

/**
 * The finding goes out as a plain final reply, because some models put the text before a tool call in hidden
 * reasoning. Once the turn ends, the plugin prompts the agent to open the question (`decisionPrompt`).
 */
const askChoices = (header: string) =>
  `end your message with your recommendation for ${header} and end your turn. Do not call the question tool yourself: the plugin then asks you to open it`

/**
 * Typed replies keep working: the question tool always offers a free-form answer. The header lets the review panel
 * close this question when the user decides the finding there instead.
 */
export const decisionPrompt = (finding: Finding) =>
  `Now call the question tool with one question whose header is "${questionHeader(finding.id)}" and whose options are ${CHOICES}, your recommended option first with " (Recommended)" appended. The finding is already shown, so write nothing else.`

export const EARLY_QUESTION =
  "Not yet: the user cannot see the finding. Write it as your reply (card, code quote, recommendation) and end your turn without calling any tool; the plugin then asks you to open the question."

/** The finding id of a question tool call whose header is `Finding #N`. */
export function findingQuestionId(input: unknown): number | undefined {
  const questions = (input as { questions?: { header?: unknown }[] } | undefined)?.questions
  const header = Array.isArray(questions) ? questions[0]?.header : undefined
  const match = typeof header === "string" ? /^Finding #(\d+)$/.exec(header.trim()) : null
  return match ? Number(match[1]) : undefined
}

const CHOICE_RULES =
  "Explain and Investigate are not decisions: show the result for that finding only and end your turn the same way. Answer any other question about the finding the same way. If the question comes back cancelled because the user decided in the review panel, call review_next_finding and go on; never ask again about a finding that is no longer pending."

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

## Choose skills with the user
- Read the repository's instructions and inspect the diff to understand the scope, but do not load skills or record
  findings yet.
- Call \`review_list_skills\` to discover all skills available in this review's location. Match their descriptions to
  the actual changes (language, framework, infrastructure, security), and briefly explain your recommendations.
- Call \`review_select_skills\` with the recommended IDs (or an empty array if none match). It shows every available
  skill in a toggle list with your recommendations already selected, waits for the user's confirmation, and loads
  only the confirmed skills as context. The user can deselect recommendations, add other skills, or select none.
- Do not substitute a plain-text question or load skills before confirmation. Cancellation is not consent: wait for
  the user rather than continuing or automatically reopening the picker. Once confirmed, do not ask again on resume.
- Use the confirmed skills as review criteria. Do not load unselected skills unless the user explicitly asks.

## Investigate
Do a complete, deep review; never a quick or partial pass, whatever the size of the pull request. The user decides
which findings to keep, so do not filter for them.
- Read the repository's instructions, then every changed file in full, not just the hunks. Do not skip files because
  they look routine: moved or renamed files, DTOs, contracts, configuration, and tests all count.
- Review against every user-confirmed skill alongside the quality bar. Their contents are loaded by
  \`review_select_skills\`; naming a skill is not loading it. Do not load skills the user left unselected.
- Grep for callers of anything the PR changes, moves, renames, or removes, including imports of old paths, and check
  they still work.
- Look for existing helpers or patterns the PR duplicates or ignores, and for tests covering the touched code.
- Run the project's checks (lint, typecheck, tests), scoped to the affected area. Install dependencies first when they
  are missing, using the project's package manager and lockfile. Use a failure as evidence only when this PR caused
  it. Skip a check only when it truly cannot run, and say why.
- Separate demonstrated defects from assumptions and preferences. Verify facts before presenting them; label what
  you could not verify. Don't request hypothetical future-proofing.
- Record every issue you notice that meets the quality bar, nits included, rather than judging it not worth a comment.
- Before calling \`review_set_verdict\`, check that you read every changed file. If you did not, go back and finish.

## Record the draft
- Record every finding with \`review_add_finding\`. Only lines that are part of the diff can be commented on: use
  the new line number with side RIGHT for added or context lines, the old line number with side LEFT for removed
  lines, and startLine for ranges. The tool rejects lines outside the diff; fix the line rather than dropping it.
- Keep severity, confidence, and evidence out of the comment body; they stay local.
- For a concrete fix of the commented lines, set \`suggestion\` to the exact new text of lines startLine..line (or just
  line), without a fence; the plugin posts it as a GitHub suggestion block under the body. Empty deletes the lines.
  Suggestions need side RIGHT and lines of one hunk. Never write a suggestion block in the body itself.
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
    const skills =
      draft.skillIDs === undefined
        ? " Before investigating findings, inspect the diff and call review_list_skills, then review_select_skills with your recommended IDs. Wait for the user's confirmed selection; never load skills on their behalf. If selection was cancelled, stop and wait for the user instead of reopening the picker or continuing."
        : ` User-confirmed skills: ${JSON.stringify(draft.skillIDs)}. Do not load unselected skills unless the user explicitly asks.`
    const scope = draft.sinceSha
      ? ` This is a follow-up: review only the changes since ${draft.sinceSha}, and say in the summary which earlier comments they address or leave unresolved.`
      : ""
    return `Review status: investigating.${skills} Do a complete, deep review: read every changed file in full and record every issue that meets the quality bar, nits included, with review_add_finding without presenting them to the user. Call review_set_verdict only once every changed file is read.${scope}`
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

export function lineCommentsPrompt(comments: readonly LineComment[]): string {
  const list = comments
    .map((comment) => {
      const side = comment.side === "LEFT" ? "the old side (LEFT)" : "the new side (RIGHT)"
      const note = comment.note.trim() ? `: ${comment.note.trim()}` : ""
      return `- \`${findingLocation(comment)}\` on ${side}${note}`
    })
    .join("\n")
  return `Add a finding at each place I marked:
${list}

For each one, investigate what I pointed at, then record it with review_add_finding at that location and side, keeping my
point in the comment body. If you find nothing wrong there, tell me why instead of recording it. Then go on as before.`
}

export function findingCard(draft: ReviewDraft, finding: Finding): string {
  const position = draft.findings.length - pendingFindings(draft).length + 1
  const quoted = commentBody(finding)
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
