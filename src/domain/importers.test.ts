import { describe, expect, it } from 'vitest'
import { createDemoDataset, fixtureFiles } from '../data/demoData'
import { parseBomCsv, parseSupplierDocument } from './importers'

describe('模拟输入解析', () => {
  it('客户 BOM 保持 20–30 行且每行标记为模拟数据', () => {
    const dataset = createDemoDataset()
    expect(dataset.bomLines.length).toBeGreaterThanOrEqual(20)
    expect(dataset.bomLines.length).toBeLessThanOrEqual(30)
    expect(dataset.bomLines.every((line) => line.dataLabel === '模拟数据')).toBe(true)
  })

  it('包含四家虚构供应商和三种输入格式', () => {
    const dataset = createDemoDataset()
    expect(dataset.supplierDocuments).toHaveLength(4)
    expect(new Set(dataset.supplierDocuments.map((document) => document.format))).toEqual(
      new Set(['CSV', 'EMAIL', 'JSON']),
    )
    expect(
      dataset.supplierDocuments.every(
        (document) =>
          document.supplierName.includes('模拟') &&
          document.quotes.every(
            (quote) => quote.dataLabel === '模拟数据' && quote.email.endsWith('.invalid'),
          ),
      ),
    ).toBe(true)
  })

  it('所有 bundled fixture 都能被同一导入器重新解析', () => {
    for (const file of fixtureFiles) {
      if (file.kind === 'bom') {
        expect(parseBomCsv(file.fileName, file.rawText)).toHaveLength(26)
      } else {
        expect(parseSupplierDocument(file.fileName, file.rawText).quotes.length).toBeGreaterThan(0)
      }
    }
  })
})
