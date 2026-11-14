import * as v from "valibot"

export const ReviewRequest = v.object({
  key: v.string(),
  repository: v.string(),
  number: v.number(),
  title: v.string(),
  author: v.string(),
  draft: v.boolean(),
  createdAt: v.string(),
  url: v.string(),
})
export type ReviewRequest = v.InferOutput<typeof ReviewRequest>

export function requestKey(repository: string, number: number): string {
  return `${repository.toLowerCase()}#${number}`
}
