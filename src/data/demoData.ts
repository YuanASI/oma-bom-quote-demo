import { parseBomCsv, parseSupplierDocument } from '../domain/importers'
import type { DemoDataset } from '../domain/types'

const bomRawText = __DEMO_BOM_RAW_TEXT__
const yunfanRawText = __DEMO_YUNFAN_RAW_TEXT__
const xingheRawText = __DEMO_XINGHE_RAW_TEXT__
const lingfengRawText = __DEMO_LINGFENG_RAW_TEXT__
const jiazhunRawText = __DEMO_JIAZHUN_RAW_TEXT__

export const DEMO_DATE = '2026-07-23'

export const fixtureFiles = [
  {
    fileName: 'customer-bom.csv',
    kind: 'bom' as const,
    format: 'CSV',
    rawText: bomRawText,
  },
  {
    fileName: 'supplier-01-yunfan.csv',
    kind: 'supplier' as const,
    format: 'CSV',
    rawText: yunfanRawText,
  },
  {
    fileName: 'supplier-02-xinghe-email.txt',
    kind: 'supplier' as const,
    format: '邮件正文',
    rawText: xingheRawText,
  },
  {
    fileName: 'supplier-03-lingfeng.json',
    kind: 'supplier' as const,
    format: 'JSON',
    rawText: lingfengRawText,
  },
  {
    fileName: 'supplier-04-jiazhun.csv',
    kind: 'supplier' as const,
    format: 'CSV',
    rawText: jiazhunRawText,
  },
]

export function createDemoDataset(): DemoDataset {
  return {
    customerName: '启明星智造（模拟客户）',
    projectName: '工业传感控制板 R2（模拟项目）',
    bomFileName: 'customer-bom.csv',
    bomRawText,
    bomLines: parseBomCsv('customer-bom.csv', bomRawText),
    supplierDocuments: [
      parseSupplierDocument('supplier-01-yunfan.csv', yunfanRawText),
      parseSupplierDocument('supplier-02-xinghe-email.txt', xingheRawText),
      parseSupplierDocument('supplier-03-lingfeng.json', lingfengRawText),
      parseSupplierDocument('supplier-04-jiazhun.csv', jiazhunRawText),
    ],
    policy: {
      asOfDate: DEMO_DATE,
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

export const initialDemoDataset = createDemoDataset()
