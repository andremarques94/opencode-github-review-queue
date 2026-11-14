export type PluginOptions = {
  intervalMs: number
  timeoutMs: number
  maxBackoffMs: number
  notifications: boolean
}

const numberOption = (value: unknown, fallback: number) =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback

export function parseOptions(input: Readonly<Record<string, unknown>>): PluginOptions {
  return {
    intervalMs: Math.max(10_000, numberOption(input.intervalMs, 60_000)),
    timeoutMs: Math.max(1_000, numberOption(input.timeoutMs, 20_000)),
    maxBackoffMs: Math.max(60_000, numberOption(input.maxBackoffMs, 15 * 60_000)),
    notifications: input.notifications !== false,
  }
}
