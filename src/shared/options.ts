export type PluginOptions = {
  intervalMs: number
  timeoutMs: number
  maxBackoffMs: number
  notifications: boolean
  cacheDirectory?: string
  reviewGuidelines?: string
}

const numberOption = (value: unknown, fallback: number) =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback

const pathOption = (key: "cacheDirectory" | "reviewGuidelines", value: unknown) =>
  typeof value === "string" && value.trim() ? { [key]: value.trim() } : {}

export function parseOptions(input: Readonly<Record<string, unknown>>): PluginOptions {
  return {
    intervalMs: Math.max(10_000, numberOption(input.intervalMs, 60_000)),
    timeoutMs: Math.max(1_000, numberOption(input.timeoutMs, 20_000)),
    maxBackoffMs: Math.max(60_000, numberOption(input.maxBackoffMs, 15 * 60_000)),
    notifications: input.notifications !== false,
    ...pathOption("cacheDirectory", input.cacheDirectory),
    ...pathOption("reviewGuidelines", input.reviewGuidelines),
  }
}
