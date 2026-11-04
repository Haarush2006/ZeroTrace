/**
 * Token bucket used for per-connection message throttling and per-IP room creation.
 * Time is injectable so the behaviour can be tested without sleeping.
 */
export class TokenBucket {
  private tokens: number
  private lastRefill: number

  constructor(
    private readonly capacity: number,
    private readonly refillPerMs: number,
    private readonly now: () => number = Date.now,
  ) {
    if (capacity <= 0) throw new Error("capacity must be positive")
    if (refillPerMs < 0) throw new Error("refillPerMs must not be negative")

    this.tokens = capacity
    this.lastRefill = now()
  }

  tryConsume(count = 1): boolean {
    if (count <= 0) return true

    const now = this.now()
    const elapsed = Math.max(0, now - this.lastRefill)
    this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillPerMs)
    this.lastRefill = now

    if (this.tokens < count) return false

    this.tokens -= count
    return true
  }
}
