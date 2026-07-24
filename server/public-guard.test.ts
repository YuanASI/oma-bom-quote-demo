import { describe, expect, it } from 'vitest'
import { PublicRunGuard } from './public-guard'

describe('公网实时执行保护', () => {
  it('限制单 IP 每日执行次数', () => {
    const guard = new PublicRunGuard(
      { perIpDaily: 1, totalDaily: 10, maxConcurrent: 2 },
      () => '2026-07-24',
    )
    const first = guard.acquire('203.0.113.1')
    expect(first.allowed).toBe(true)
    if (first.allowed) first.release()

    expect(guard.acquire('203.0.113.1')).toEqual({
      allowed: false,
      reason: 'ip_daily_limit',
    })
  })

  it('限制全局并发并在结束后释放名额', () => {
    const guard = new PublicRunGuard(
      { perIpDaily: 10, totalDaily: 10, maxConcurrent: 1 },
      () => '2026-07-24',
    )
    const first = guard.acquire('203.0.113.1')
    expect(first.allowed).toBe(true)
    expect(guard.acquire('203.0.113.2')).toEqual({
      allowed: false,
      reason: 'max_concurrent',
    })

    if (first.allowed) first.release()
    expect(guard.acquire('203.0.113.2').allowed).toBe(true)
  })

  it('限制每日总执行次数', () => {
    const guard = new PublicRunGuard(
      { perIpDaily: 10, totalDaily: 1, maxConcurrent: 2 },
      () => '2026-07-24',
    )
    const first = guard.acquire('203.0.113.1')
    expect(first.allowed).toBe(true)
    if (first.allowed) first.release()

    expect(guard.acquire('203.0.113.2')).toEqual({
      allowed: false,
      reason: 'total_daily_limit',
    })
  })
})
