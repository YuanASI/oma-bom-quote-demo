import { describe, expect, it } from 'vitest'
import { createDemoDataset } from '../data/demoData'
import { buildExportArtifacts } from './exports'
import { runQuoteReview } from './quoteEngine'
import type { AuditEntry } from './types'

describe('本地导出交付物', () => {
  const dataset = createDemoDataset()
  const run = runQuoteReview(dataset)
  const audit: AuditEntry[] = [
    {
      id: 'test-1',
      timestamp: '2026-07-23T09:30:00+08:00',
      actor: '采购负责人（演示）',
      action: '负责人审批',
      subject: dataset.projectName,
      detail: 'approved；测试备注',
    },
  ]
  const artifacts = buildExportArtifacts(
    dataset,
    run,
    { decision: 'approved', note: '测试备注', decidedAt: audit[0].timestamp },
    audit,
    new Set(['ITEM-06']),
  )

  it('生成四类交付物且文件名明确标记为模拟', () => {
    expect(artifacts.map((artifact) => artifact.id)).toEqual([
      'customer_quote',
      'procurement_review',
      'exceptions',
      'audit',
    ])
    expect(artifacts.every((artifact) => artifact.fileName.includes('模拟'))).toBe(true)
  })

  it('每份导出内容都声明模拟边界', () => {
    expect(artifacts.every((artifact) => artifact.content.includes('模拟数据'))).toBe(true)
    expect(artifacts.find((artifact) => artifact.id === 'procurement_review')?.content).toContain(
      '禁止直接下单',
    )
    expect(artifacts.find((artifact) => artifact.id === 'audit')?.content).toContain(
      '未联系供应商',
    )
  })

  it('异常清单保留补充询价标记和责任角色', () => {
    const exceptions = artifacts.find((artifact) => artifact.id === 'exceptions')
    expect(exceptions?.content).toContain('已标记补充询价')
    expect(exceptions?.content).toMatch(/采购|销售|工程/)
    expect(exceptions?.rowCount).toBeGreaterThanOrEqual(6)
  })
})
