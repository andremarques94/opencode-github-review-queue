const MINUTE = 60_000
const UNITS: Record<string, number> = { m: MINUTE, h: 60 * MINUTE, d: 24 * 60 * MINUTE }

/** A positive duration such as `45m`, `3h` or `2d`, in milliseconds. */
export function parseDuration(input: string): number | undefined {
  const text = input.trim().toLowerCase()
  const unit = UNITS[text.slice(-1)]
  const amount = Number(text.slice(0, -1))
  if (!unit || text.length < 2 || !Number.isFinite(amount) || amount <= 0) {
    return undefined
  }
  return amount * unit
}
