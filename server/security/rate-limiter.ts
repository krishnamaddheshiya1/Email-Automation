// Universal Web API Response compatible with Node.js and Next.js

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetTime: number;
  retryAfterSeconds: number;
}

export interface RateLimitOptions {
  limit: number;
  windowMs: number;
}

export const RATE_LIMIT_PROFILES = {
  AUTH: { limit: 10, windowMs: 60_000 }, // 10 requests / min
  TEST_EMAIL: { limit: 10, windowMs: 60_000 }, // 10 requests / min
  CAMPAIGN_ACTIVATION: { limit: 20, windowMs: 60_000 }, // 20 activations / min
  IMPORT: { limit: 15, windowMs: 60_000 }, // 15 imports / min
  PROVIDER_HEALTH: { limit: 30, windowMs: 60_000 }, // 30 probes / min
  WEBHOOK: { limit: 300, windowMs: 60_000 }, // 300 webhooks / min
  ATTACHMENT_UPLOAD: { limit: 30, windowMs: 60_000 }, // 30 uploads / min
  GENERAL_API: { limit: 300, windowMs: 60_000 }, // 300 api calls / min
} as const;

class MemoryRateLimiter {
  private requests: Map<string, number[]> = new Map();
  private lastCleanup: number = Date.now();

  /**
   * Consumes 1 request token for a given key within the sliding window.
   */
  public consume(key: string, limit: number, windowMs: number): RateLimitResult {
    const now = Date.now();
    this.maybeCleanup(now);

    const windowStart = now - windowMs;
    let timestamps = this.requests.get(key) || [];

    // Filter out timestamps outside the sliding window
    timestamps = timestamps.filter((t) => t > windowStart);

    const resetTime = timestamps.length > 0 ? timestamps[0] + windowMs : now + windowMs;
    const retryAfterSeconds = Math.max(1, Math.ceil((resetTime - now) / 1000));

    if (timestamps.length >= limit) {
      this.requests.set(key, timestamps);
      return {
        allowed: false,
        limit,
        remaining: 0,
        resetTime,
        retryAfterSeconds,
      };
    }

    timestamps.push(now);
    this.requests.set(key, timestamps);

    return {
      allowed: true,
      limit,
      remaining: Math.max(0, limit - timestamps.length),
      resetTime,
      retryAfterSeconds: 0,
    };
  }

  /**
   * Consumes 1 request token using a predefined profile.
   */
  public consumeProfile(key: string, profile: { limit: number; windowMs: number }): RateLimitResult {
    return this.consume(key, profile.limit, profile.windowMs);
  }

  /**
   * Checks status without consuming a token.
   */
  public check(key: string, limit: number, windowMs: number): RateLimitResult {
    const now = Date.now();
    const windowStart = now - windowMs;
    const timestamps = (this.requests.get(key) || []).filter((t) => t > windowStart);
    const resetTime = timestamps.length > 0 ? timestamps[0] + windowMs : now + windowMs;
    const retryAfterSeconds = Math.max(1, Math.ceil((resetTime - now) / 1000));

    return {
      allowed: timestamps.length < limit,
      limit,
      remaining: Math.max(0, limit - timestamps.length),
      resetTime,
      retryAfterSeconds: timestamps.length >= limit ? retryAfterSeconds : 0,
    };
  }

  /**
   * Resets rate limit for a key or clears all keys.
   */
  public reset(key?: string): void {
    if (key) {
      this.requests.delete(key);
    } else {
      this.requests.clear();
    }
  }

  private maybeCleanup(now: number): void {
    if (now - this.lastCleanup > 60_000) {
      this.lastCleanup = now;
      for (const [key, timestamps] of this.requests.entries()) {
        const valid = timestamps.filter((t) => now - t < 120_000);
        if (valid.length === 0) {
          this.requests.delete(key);
        } else {
          this.requests.set(key, valid);
        }
      }
    }
  }
}

export const rateLimiter = new MemoryRateLimiter();

/**
 * Extracts client IP safely from request headers.
 */
export function extractClientIp(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const firstIp = forwarded.split(",")[0].trim();
    if (firstIp) return firstIp;
  }
  const realIp = headers.get("x-real-ip");
  if (realIp) return realIp.trim();
  return "127.0.0.1";
}

/**
 * Creates standard HTTP 429 Too Many Requests response with compliant rate-limit headers.
 */
export function createRateLimitResponse(result: RateLimitResult): Response {
  return Response.json(
    {
      success: false,
      error: "Too many requests. Please slow down and try again later.",
      retryAfterSeconds: result.retryAfterSeconds,
    },
    {
      status: 429,
      headers: {
        "Retry-After": String(result.retryAfterSeconds),
        "X-RateLimit-Limit": String(result.limit),
        "X-RateLimit-Remaining": String(result.remaining),
        "X-RateLimit-Reset": String(Math.ceil(result.resetTime / 1000)),
      },
    }
  );
}
