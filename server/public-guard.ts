export interface PublicRunLimits {
  perIpDaily: number
  totalDaily: number
  maxConcurrent: number
}

export type PublicRunRejection =
  | 'ip_daily_limit'
  | 'total_daily_limit'
  | 'max_concurrent'

export type PublicRunPermit =
  | {
      allowed: true
      release: () => void
    }
  | {
      allowed: false
      reason: PublicRunRejection
    }

interface DailyCounter {
  day: string
  count: number
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

export function publicRunLimitsFromEnv(): PublicRunLimits {
  return {
    perIpDaily: positiveInteger(process.env['OMA_PUBLIC_IP_DAILY_LIMIT'], 2),
    totalDaily: positiveInteger(process.env['OMA_PUBLIC_TOTAL_DAILY_LIMIT'], 30),
    maxConcurrent: positiveInteger(process.env['OMA_PUBLIC_MAX_CONCURRENT'], 2),
  }
}

export class PublicRunGuard {
  private readonly perIp = new Map<string, DailyCounter>()
  private readonly limits: PublicRunLimits
  private readonly today: () => string
  private total: DailyCounter = { day: '', count: 0 }
  private active = 0

  constructor(limits: PublicRunLimits, today?: () => string) {
    this.limits = limits
    this.today = today ?? (() => new Date().toISOString().slice(0, 10))
  }

  acquire(ip: string): PublicRunPermit {
    const day = this.today()
    const currentIp = this.perIp.get(ip)
    const ipCount = currentIp?.day === day ? currentIp.count : 0
    const totalCount = this.total.day === day ? this.total.count : 0

    if (ipCount >= this.limits.perIpDaily) {
      return { allowed: false, reason: 'ip_daily_limit' }
    }
    if (totalCount >= this.limits.totalDaily) {
      return { allowed: false, reason: 'total_daily_limit' }
    }
    if (this.active >= this.limits.maxConcurrent) {
      return { allowed: false, reason: 'max_concurrent' }
    }

    this.perIp.set(ip, { day, count: ipCount + 1 })
    this.total = { day, count: totalCount + 1 }
    this.active += 1

    let released = false
    return {
      allowed: true,
      release: () => {
        if (released) return
        released = true
        this.active = Math.max(0, this.active - 1)
      },
    }
  }
}
