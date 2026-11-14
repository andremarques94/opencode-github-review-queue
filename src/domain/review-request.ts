export type ReviewRequest = {
  key: string
  repository: string
  number: number
  title: string
  author: string
  draft: boolean
  createdAt: string
  url: string
}

export function requestKey(repository: string, number: number): string {
  return `${repository.toLowerCase()}#${number}`
}
