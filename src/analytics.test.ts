import { afterEach, describe, expect, it, vi } from 'vitest'
import { trackDemoEvent } from './analytics'

describe('Demo analytics', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('向同源事件接口发送稳定的 Demo 事件', () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('window', {})
    vi.stubGlobal('fetch', fetch)

    trackDemoEvent('demo_path_selected', { path: 'live' })

    expect(fetch).toHaveBeenCalledWith('/api/demos/bom-quote-review/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event: 'demo_path_selected',
        parameters: { path: 'live' },
      }),
      keepalive: true,
    })
  })

  it('服务端渲染环境不影响业务流程', () => {
    vi.stubGlobal('window', undefined)
    expect(() => trackDemoEvent('demo_open')).not.toThrow()
  })
})
