import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { parseBomCsv, parseSupplierDocument } from '../src/domain/importers.js'
import type {
  DemoDataset,
  LiveReviewRequest,
  RawDemoFile,
  SupplierDocument,
} from '../src/domain/types.js'

const moduleDirectory = dirname(fileURLToPath(import.meta.url))
const moduleParent = resolve(moduleDirectory, '..')
const projectRoot = existsSync(resolve(moduleParent, 'fixtures'))
  ? moduleParent
  : resolve(moduleParent, '..')

export const fixtureNames = [
  'customer-bom.csv',
  'supplier-01-yunfan.csv',
  'supplier-02-xinghe-email.txt',
  'supplier-03-lingfeng.json',
  'supplier-04-jiazhun.csv',
] as const

export function projectPath(...segments: string[]): string {
  return resolve(projectRoot, ...segments)
}

async function readFixture(fileName: string): Promise<RawDemoFile> {
  return {
    fileName,
    rawText: await readFile(projectPath('fixtures', fileName), 'utf8'),
  }
}

export async function loadBundledRequest(): Promise<LiveReviewRequest> {
  const [bom, ...suppliers] = await Promise.all(fixtureNames.map(readFixture))
  return {
    dataLabel: '模拟数据',
    customerName: '启明星智造（模拟客户）',
    projectName: '工业传感控制板 R2（模拟项目）',
    bom,
    suppliers,
    policy: {
      asOfDate: '2026-07-23',
      cnyVatRate: 0.13,
      fxToCny: {
        CNY: 1,
        USD: 7.2,
        HKD: 0.92,
      },
      minimumGrossMargin: 0.08,
    },
  }
}

export function datasetFromRequest(
  request: LiveReviewRequest,
  supplierDocuments?: SupplierDocument[],
): DemoDataset {
  return {
    customerName: request.customerName,
    projectName: request.projectName,
    bomFileName: request.bom.fileName,
    bomRawText: request.bom.rawText,
    bomLines: parseBomCsv(request.bom.fileName, request.bom.rawText),
    supplierDocuments:
      supplierDocuments ??
      request.suppliers.map((file) => parseSupplierDocument(file.fileName, file.rawText)),
    policy: request.policy,
  }
}

export async function loadBundledDataset(): Promise<DemoDataset> {
  return datasetFromRequest(await loadBundledRequest())
}

export function hashRawFiles(request: LiveReviewRequest): Array<{ fileName: string; sha256: string }> {
  return [request.bom, ...request.suppliers].map((file) => ({
    fileName: file.fileName,
    sha256: createHash('sha256').update(file.rawText).digest('hex'),
  }))
}
