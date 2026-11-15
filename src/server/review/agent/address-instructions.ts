import type { ReviewRequest } from "../../../domain/review-request.js"
import type { OpenThread } from "../../github/pull-request.js"

const quote = (text: string) =>
  text
    .trim()
    .split("\n")
    .map((line) => `   > ${line}`)
    .join("\n")

function threadEntry(thread: OpenThread, index: number): string {
  const location = `\`${thread.path}${thread.line === undefined ? "" : `:${thread.line}`}\``
  const comments = thread.comments.map((comment) => `   @${comment.author}:\n${quote(comment.body)}`).join("\n")
  return `${index + 1}. ${location}${thread.outdated ? " (outdated: the code it was on has changed since)" : ""}\n${comments}`
}

export function addressInstructions(item: ReviewRequest, branch: string, threads: readonly OpenThread[]): string {
  const checklist = threads.length > 0 ? threads.map(threadEntry).join("\n\n") : "None are open on GitHub right now."
  return `# Address the review of ${item.repository}#${item.number}

This session works on the user's own pull request, "${item.title}", in their checkout of \`${branch}\`. Reviewers
left the comments below. Help the user address them: you may edit files here, the user decides what is posted.

## Open review comments
${checklist}

## How to work
- First run \`git status\` and check whether \`${branch}\` is behind its upstream. Mention uncommitted changes you did
  not make, and ask before pulling.
- Take the comments one at a time, in order. Read the code each one points at, say in a sentence or two what the
  reviewer asks for, whether you agree, and the change you propose. Make it once the user agrees.
- When a comment should not lead to a change, say why and draft a short reply the user can post.
- After changes, run the project's checks (lint, typecheck, tests) scoped to what you touched.
- Never push, never resolve threads, and never reply or review on GitHub: the user does those. Commit only when the
  user asks. This session blocks \`git push\`, \`gh api\`, and the \`gh pr\` and \`gh issue\` commands that write; the
  comments above are all you need from GitHub.
- At the end, list each comment with what you changed, or the reply you drafted.`
}

export const addressPrompt = (item: ReviewRequest) =>
  `Address the review comments on ${item.repository}#${item.number}: ${item.title}`
