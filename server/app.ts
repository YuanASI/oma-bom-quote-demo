import { randomUUID } from 'node:crypto'
import express, {
  type Express,
  type NextFunction,
  type Request,
  type Response,
} from 'express'
import { applyModelReviewFindings, runQuoteReview } from '../src/domain/quoteEngine.js'
import type {
  LiveReviewRequest,
  ReviewExecutionResponse,
  RuntimeStatus,
} from '../src/domain/types.js'
import { datasetFromRequest, loadBundledRequest } from './fixture-loader.js'
import {
  hasLiveCredential,
  liveModelConfig,
  runLiveOmaWorkflow,
  type OmaWorkflowResult,
} from './oma-runner.js'
import { replayStatus, runOfflineReplay } from './replay.js'
import { demoAnalyticsEventSchema, liveReviewRequestSchema } from './schemas.js'
import {
  PublicRunGuard,
  publicRunLimitsFromEnv,
  type PublicRunRejection,
} from './public-guard.js'

export const API_PREFIX = '/api/demos/bom-quote-review'

interface AppDependencies {
  runLive?: (request: LiveReviewRequest) => Promise<OmaWorkflowResult>
  publicMode?: boolean
  publicGuard?: PublicRunGuard
}

function assertOnlySimulatedContacts(request: LiveReviewRequest): void {
  const emailPattern = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi
  const emails = request.suppliers.flatMap(
    (file) => file.rawText.match(emailPattern) ?? [],
  )
  const unsafe = emails.find((email) => !email.toLowerCase().endsWith('.invalid'))
  if (unsafe) {
    throw new Error('实时 Demo 只接受使用 .invalid 邮箱的模拟供应商资料')
  }
}

function jsonError(res: Response, status: number, message: string): void {
  res.status(status).json({
    error: message,
    noAutomaticFallback: true,
    requestId: res.locals['requestId'] as string,
  })
}

function isPublicMode(): boolean {
  return process.env['OMA_PUBLIC_DEMO'] === '1'
}

function publicLimitMessage(reason: PublicRunRejection): string {
  if (reason === 'max_concurrent') {
    return '当前实时演示正在使用中，请稍后重试；离线回放仍可使用'
  }
  if (reason === 'ip_daily_limit') {
    return '今天的实时演示次数已用完；离线回放仍可使用'
  }
  return '今天的公开实时演示额度已用完；离线回放仍可使用'
}

async function assertBundledPublicRequest(request: LiveReviewRequest): Promise<void> {
  const bundled = await loadBundledRequest()
  if (JSON.stringify(request) !== JSON.stringify(bundled)) {
    throw new Error('公开 Demo 只允许使用内置模拟测试集')
  }
}

export function createDemoApp(dependencies: AppDependencies = {}): Express {
  const app = express()
  const runLive = dependencies.runLive ?? runLiveOmaWorkflow
  const publicMode = dependencies.publicMode ?? isPublicMode()
  const publicGuard = dependencies.publicGuard ?? new PublicRunGuard(publicRunLimitsFromEnv())
  app.disable('x-powered-by')
  if (publicMode) app.set('trust proxy', 1)
  app.use((_req, res, next) => {
    const requestId = randomUUID()
    res.locals['requestId'] = requestId
    res.setHeader('X-Request-ID', requestId)
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
    res.setHeader('X-Frame-Options', 'DENY')
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'",
    )
    next()
  })
  app.get('/healthz', (_req, res) => {
    res.json({ status: 'ok' })
  })
  app.use(API_PREFIX, express.json({ limit: '128kb' }))
  app.use(API_PREFIX, (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store')
    next()
  })

  app.get(`${API_PREFIX}/runtime`, async (_req, res) => {
    try {
      const config = liveModelConfig()
      const status: RuntimeStatus = {
        service: 'ready',
        liveAvailable: hasLiveCredential(),
        publicDemo: publicMode,
        customImportsAllowed: !publicMode,
        provider: config.provider,
        model: config.model,
        replay: await replayStatus(),
        notices: publicMode
          ? [
              '公开版只运行内置模拟测试集，不接受用户上传文件。',
              '实时路径只向配置的模型 provider 发送内置模拟数据。',
              'API Key 只由服务端读取，不返回浏览器。',
              '实时失败不会自动切换为离线回放。',
            ]
          : [
              '实时路径只向配置的模型 provider 发送明确标记为模拟数据的文件。',
              'API Key 只由本地 Node 服务读取，不返回浏览器。',
              '实时失败不会自动切换为离线回放。',
            ],
      }
      res.json(status)
    } catch (error) {
      jsonError(res, 500, error instanceof Error ? error.message : '运行时配置无效')
    }
  })

  app.post(`${API_PREFIX}/events`, (req, res) => {
    const parsed = demoAnalyticsEventSchema.safeParse(req.body)
    if (!parsed.success) {
      jsonError(res, 400, '埋点事件格式无效')
      return
    }

    console.log(JSON.stringify({
      event: 'bom_demo_analytics',
      requestId: res.locals['requestId'],
      name: parsed.data.event,
      parameters: parsed.data.parameters,
    }))
    res.status(204).end()
  })

  app.post(`${API_PREFIX}/review/live`, async (req: Request, res: Response) => {
    if (!hasLiveCredential() && dependencies.runLive === undefined) {
      jsonError(res, 503, '缺少 DEEPSEEK_API_KEY，实时 OMA 模式不可用')
      return
    }
    const parsed = liveReviewRequestSchema.safeParse(req.body)
    if (!parsed.success) {
      jsonError(
        res,
        400,
        parsed.error.issues.map((issue) => issue.message).join('；'),
      )
      return
    }
    const request = parsed.data as LiveReviewRequest
    try {
      assertOnlySimulatedContacts(request)
      if (publicMode) await assertBundledPublicRequest(request)
    } catch (error) {
      jsonError(res, 400, error instanceof Error ? error.message : '输入资料不安全')
      return
    }

    const permit = publicMode
      ? publicGuard.acquire(req.ip || req.socket.remoteAddress || 'unknown')
      : undefined
    if (permit && !permit.allowed) {
      res.setHeader('Retry-After', permit.reason === 'max_concurrent' ? '30' : '86400')
      console.warn(JSON.stringify({
        event: 'bom_demo_live_rejected',
        requestId: res.locals['requestId'],
        reason: permit.reason,
      }))
      jsonError(res, 429, publicLimitMessage(permit.reason))
      return
    }

    try {
      const workflow = await runLive(request)
      const dataset = datasetFromRequest(request, workflow.output.supplierDocuments)
      const baseRun = runQuoteReview(dataset, workflow.evidence)
      const run = applyModelReviewFindings(
        baseRun,
        workflow.output.bomFindings,
        workflow.output.evidenceFindings,
      )
      const response: ReviewExecutionResponse = { run }
      console.log(JSON.stringify({
        event: 'bom_demo_live_completed',
        requestId: res.locals['requestId'],
        provider: run.runtime?.provider,
        model: run.runtime?.model,
        durationMs: run.runtime?.receipt?.durationMs,
        inputTokens: run.runtime?.receipt?.totalTokens?.input,
        outputTokens: run.runtime?.receipt?.totalTokens?.output,
        roles: run.runtime?.receipt?.rolesExecuted.length,
        validationIssues: run.runtime?.validationIssues.length,
      }))
      res.json(response)
    } catch (error) {
      const message = error instanceof Error ? error.message : '实时 OMA 处理失败'
      const status = /timeout|超时/i.test(message) ? 504 : 502
      console.error(JSON.stringify({
        event: 'bom_demo_live_failed',
        requestId: res.locals['requestId'],
        status,
        error: message,
      }))
      jsonError(
        res,
        status,
        publicMode ? '实时 OMA 处理失败，请稍后重试；系统没有自动切换到离线结果' : message,
      )
    } finally {
      if (permit?.allowed) permit.release()
    }
  })

  app.post(`${API_PREFIX}/review/replay`, async (_req, res) => {
    try {
      res.json(await runOfflineReplay())
    } catch (error) {
      jsonError(res, 409, error instanceof Error ? error.message : '离线回放不可用')
    }
  })

  app.use(API_PREFIX, (
    error: unknown,
    _req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    if (
      error instanceof Error &&
      'type' in error &&
      (error as Error & { type?: string }).type === 'entity.too.large'
    ) {
      jsonError(res, 413, '请求内容过大')
      return
    }
    next(error)
  })

  return app
}
