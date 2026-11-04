import { describe, expect, it } from "vitest"
import { TokenBucket } from "../src/rate-limit"

describe("TokenBucket", () => {
  it("allows an initial burst up to capacity", () => {
    let now = 0
    const bucket = new TokenBucket(3, 1 / 1000, () => now)

    expect(bucket.tryConsume()).toBe(true)
    expect(bucket.tryConsume()).toBe(true)
    expect(bucket.tryConsume()).toBe(true)
    expect(bucket.tryConsume()).toBe(false)
  })

  it("refills over time", () => {
    let now = 0
    const bucket = new TokenBucket(2, 1 / 1000, () => now)

    expect(bucket.tryConsume(2)).toBe(true)
    expect(bucket.tryConsume()).toBe(false)

    now += 1_000
    expect(bucket.tryConsume()).toBe(true)
  })

  it("never refills above capacity", () => {
    let now = 0
    const bucket = new TokenBucket(2, 1 / 1000, () => now)

    now += 60_000
    expect(bucket.tryConsume(2)).toBe(true)
    expect(bucket.tryConsume()).toBe(false)
  })

  it("supports weighted consumption", () => {
    let now = 0
    const bucket = new TokenBucket(10, 0, () => now)

    expect(bucket.tryConsume(4)).toBe(true)
    expect(bucket.tryConsume(7)).toBe(false)
    expect(bucket.tryConsume(6)).toBe(true)
  })

  it("rejects invalid construction", () => {
    expect(() => new TokenBucket(0, 1)).toThrow()
    expect(() => new TokenBucket(1, -1)).toThrow()
  })
})
