import { readFile } from 'node:fs/promises'
import { applyModelReviewFindings, runQuoteReview } from '../src/domain/quoteEngine.js'
import type {
  ReplayPackage,
  ReviewExecutionResponse,
  RunEvidence,
  RuntimeStatus,
} from '../src/domain/types.js'
import {
  datasetFromRequest,
  hashRawFiles,
  loadBundledRequest,
  projectPath,
} from './fixture-loader.js'

const replayPath = projectPath('fixtures', 'replays', 'oma-demo-v1.json')

export async function loadReplayPackage(): Promise<ReplayPackage> {
  const parsed = JSON.parse(await readFile(replayPath, 'utf8')) as ReplayPackage
  if (
    parsed.schemaVersion !== 1 ||
    parsed.dataLabel !== '模拟数据' ||
    !parsed.replayId ||
    !parsed.captureKind
  ) {
    throw new Error('离线回放包格式无效')
  }
  return parsed
}

async function assertFixtureHashes(replay: ReplayPackage): Promise<void> {
  const request = await loadBundledRequest()
  const current = new Map(hashRawFiles(request).map((entry) => [entry.fileName, entry.sha256]))
  for (const expected of replay.fixtureHashes) {
    if (current.get(expected.fileName) !== expected.sha256) {
      throw new Error(`离线回放与当前 fixture 不一致：${expected.fileName}`)
    }
  }
}

export async function replayStatus(): Promise<RuntimeStatus['replay']> {
  try {
    const replay = await loadReplayPackage()
    await assertFixtureHashes(replay)
    return {
      available: true,
      replayId: replay.replayId,
      captureKind: replay.captureKind,
      capturedAt: replay.capturedAt,
      provider: replay.provider,
      model: replay.model,
      notice: replay.notice,
    }
  } catch (error) {
    return {
      available: false,
      notice: error instanceof Error ? error.message : '离线回放不可用',
    }
  }
}

export async function runOfflineReplay(): Promise<ReviewExecutionResponse> {
  const replay = await loadReplayPackage()
  await assertFixtureHashes(replay)
  const request = await loadBundledRequest()
  const dataset = datasetFromRequest(
    request,
    replay.workflowOutput?.supplierDocuments,
  )
  const now = new Date().toISOString()
  const runtime: RunEvidence = {
    executionMode: 'OFFLINE_REPLAY',
    isLiveModelCall: false,
    provider: replay.provider,
    model: replay.model,
    startedAt: now,
    completedAt: now,
    replayId: replay.replayId,
    replayCaptureKind: replay.captureKind,
    taskCount: replay.receipt?.rolesExecuted.length ?? 0,
    validationIssues: [],
    ...(replay.receipt ? { receipt: replay.receipt } : {}),
    notice: replay.notice,
  }
  const baseRun = runQuoteReview(dataset, runtime)
  const run = replay.workflowOutput
    ? applyModelReviewFindings(
        baseRun,
        replay.workflowOutput.bomFindings,
        replay.workflowOutput.evidenceFindings,
      )
    : baseRun
  return { run }
}
