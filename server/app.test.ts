import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { loadBundledRequest } from './fixture-loader'
import { API_PREFIX, createDemoApp } from './app'
import { runLiveOmaWorkflow } from './oma-runner'
import { PublicRunGuard } from './public-guard'
import { fixtureRunnerOptions } from './test-fixtures'

describe('本地 API 双路径', () => {
  it('没有 Key 时状态明确，离线回放仍可用', async () => {
    const existingKey = process.env['DEEPSEEK_API_KEY']
    delete process.env['DEEPSEEK_API_KEY']
    try {
      const response = await request(createDemoApp()).get(`${API_PREFIX}/runtime`)
      expect(response.status).toBe(200)
      expect(response.body.liveAvailable).toBe(false)
      expect(response.body.publicDemo).toBe(false)
      expect(response.body.customImportsAllowed).toBe(true)
      expect(response.body.replay).toMatchObject({
        available: true,
        captureKind: 'LIVE_OMA_CAPTURE',
      })
    } finally {
      if (existingKey) process.env['DEEPSEEK_API_KEY'] = existingKey
    }
  })

  it('通过真实 OMA 调度结构返回实时模式结果', async () => {
    const app = createDemoApp({
      runLive: async (input) =>
        runLiveOmaWorkflow(input, await fixtureRunnerOptions()),
    })
    const response = await request(app)
      .post(`${API_PREFIX}/review/live`)
      .send(await loadBundledRequest())

    expect(response.status).toBe(200)
    expect(response.body.run.mode).toBe('LIVE_OMA_MODEL')
    expect(response.body.run.runtime.isLiveModelCall).toBe(false)
    expect(response.body.run.runtime.receipt.rolesExecuted).toHaveLength(6)
  })

  it('离线回放不会被标记成当前实时模型调用', async () => {
    const response = await request(createDemoApp())
      .post(`${API_PREFIX}/review/replay`)
      .send({})
    expect(response.status).toBe(200)
    expect(response.body.run.mode).toBe('OFFLINE_REPLAY')
    expect(response.body.run.runtime.isLiveModelCall).toBe(false)
    expect(response.body.run.runtime.replayCaptureKind).toBe('LIVE_OMA_CAPTURE')
  })

  it('拒绝没有模拟标记或使用真实邮箱域名的资料', async () => {
    const app = createDemoApp({
      runLive: async (input) =>
        runLiveOmaWorkflow(input, await fixtureRunnerOptions()),
    })
    const requestBody = await loadBundledRequest()
    const noLabel = {
      ...requestBody,
      bom: {
        ...requestBody.bom,
        rawText: requestBody.bom.rawText.replaceAll('模拟数据', '测试'),
      },
    }
    const noLabelResponse = await request(app)
      .post(`${API_PREFIX}/review/live`)
      .send(noLabel)
    expect(noLabelResponse.status).toBe(400)

    const unsafeEmail = {
      ...requestBody,
      suppliers: requestBody.suppliers.map((file, index) =>
        index === 0
          ? { ...file, rawText: `${file.rawText}\ncontact@example.com` }
          : file,
      ),
    }
    const unsafeResponse = await request(app)
      .post(`${API_PREFIX}/review/live`)
      .send(unsafeEmail)
    expect(unsafeResponse.status).toBe(400)
    expect(unsafeResponse.body.error).toContain('.invalid')
  })

  it('公开模式只允许内置测试集并执行限流', async () => {
    const publicGuard = new PublicRunGuard({
      perIpDaily: 1,
      totalDaily: 10,
      maxConcurrent: 1,
    })
    const app = createDemoApp({
      publicMode: true,
      publicGuard,
      runLive: async (input) =>
        runLiveOmaWorkflow(input, await fixtureRunnerOptions()),
    })
    const bundled = await loadBundledRequest()
    const modified = { ...bundled, projectName: '另一个模拟项目' }

    const rejected = await request(app)
      .post(`${API_PREFIX}/review/live`)
      .send(modified)
    expect(rejected.status).toBe(400)
    expect(rejected.body.error).toContain('只允许使用内置模拟测试集')

    const accepted = await request(app)
      .post(`${API_PREFIX}/review/live`)
      .send(bundled)
    expect(accepted.status).toBe(200)

    const limited = await request(app)
      .post(`${API_PREFIX}/review/live`)
      .send(bundled)
    expect(limited.status).toBe(429)
    expect(limited.body.noAutomaticFallback).toBe(true)
  })

  it('提供容器健康检查并设置安全响应头', async () => {
    const response = await request(createDemoApp()).get('/healthz')
    expect(response.status).toBe(200)
    expect(response.body).toEqual({ status: 'ok' })
    expect(response.headers['x-content-type-options']).toBe('nosniff')
    expect(response.headers['x-frame-options']).toBe('DENY')
  })
})
