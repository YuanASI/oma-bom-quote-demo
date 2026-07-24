import type {
  DemoDataset,
  LiveReviewRequest,
  ReviewExecutionResponse,
  RuntimeStatus,
} from '../domain/types'

interface ErrorPayload {
  error?: string
  noAutomaticFallback?: boolean
}

export class DemoApiError extends Error {
  readonly status: number
  readonly noAutomaticFallback: boolean

  constructor(message: string, status: number, noAutomaticFallback: boolean) {
    super(message)
    this.name = 'DemoApiError'
    this.status = status
    this.noAutomaticFallback = noAutomaticFallback
  }
}

async function readJson<T>(response: Response): Promise<T> {
  const payload = await response.json() as T | ErrorPayload
  if (!response.ok) {
    const error = payload as ErrorPayload
    throw new DemoApiError(
      error.error ?? `本地服务返回 HTTP ${response.status}`,
      response.status,
      error.noAutomaticFallback === true,
    )
  }
  return payload as T
}

export async function getRuntimeStatus(): Promise<RuntimeStatus> {
  return readJson<RuntimeStatus>(
    await fetch('/api/demos/bom-quote-review/runtime'),
  )
}

function liveRequest(dataset: DemoDataset): LiveReviewRequest {
  return {
    dataLabel: '模拟数据',
    customerName: dataset.customerName,
    projectName: dataset.projectName,
    bom: {
      fileName: dataset.bomFileName,
      rawText: dataset.bomRawText,
    },
    suppliers: dataset.supplierDocuments.map((document) => ({
      fileName: document.fileName,
      rawText: document.rawText,
    })),
    policy: dataset.policy,
  }
}

export async function runLiveReview(
  dataset: DemoDataset,
): Promise<ReviewExecutionResponse> {
  return readJson<ReviewExecutionResponse>(
    await fetch('/api/demos/bom-quote-review/review/live', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(liveRequest(dataset)),
    }),
  )
}

export async function runReplayReview(): Promise<ReviewExecutionResponse> {
  return readJson<ReviewExecutionResponse>(
    await fetch('/api/demos/bom-quote-review/review/replay', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    }),
  )
}
