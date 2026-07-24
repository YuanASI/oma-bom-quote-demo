import { z } from 'zod'

export const currencySchema = z.enum(['CNY', 'USD', 'HKD'])
export const taxBasisSchema = z.enum(['VAT_INCLUDED', 'EXCLUDED'])
export const channelTypeSchema = z.enum(['AUTHORIZED', 'INDEPENDENT', 'BROKER', 'SPOT'])
export const qualificationSchema = z.enum(['VERIFIED', 'PENDING'])

export const extractedQuoteSchema = z.object({
  mpn: z.string().min(1),
  brand: z.string(),
  unitPrice: z.number().finite().nonnegative(),
  currency: currencySchema,
  taxBasis: taxBasisSchema,
  moq: z.number().int().nonnegative(),
  stock: z.number().int().nonnegative(),
  leadDays: z.number().int().nonnegative(),
  validUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  dateCode: z.string(),
  channelType: channelTypeSchema,
  alternateFor: z.string().optional(),
  remark: z.string(),
  sourceLocator: z.string().min(1),
  sourceExcerpt: z.string().min(1),
  confidence: z.number().min(0).max(1),
  unresolvedFields: z.array(z.string()),
})

export const supplierExtractionSchema = z.object({
  supplier: z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    contact: z.string(),
    email: z.string(),
    qualification: qualificationSchema,
  }),
  quotes: z.array(extractedQuoteSchema),
  documentWarnings: z.array(z.string()),
})

export const bomAnalysisSchema = z.object({
  findings: z.array(z.object({
    originalPartNumber: z.string().min(1),
    suggestedCanonicalMpn: z.string().min(1),
    sourceLine: z.number().int().positive(),
    issue: z.string().min(1),
    requiresHumanReview: z.boolean(),
  })),
})

export const evidenceReviewSchema = z.object({
  decision: z.enum(['PASS', 'NEEDS_HUMAN_REVIEW']),
  findings: z.array(z.object({
    supplierId: z.string().min(1),
    mpn: z.string().min(1),
    severity: z.enum(['info', 'warning', 'critical']),
    issue: z.string().min(1),
  })),
})

const rawDemoFileSchema = z.object({
  fileName: z.string().min(1),
  rawText: z.string().min(1).refine((text) => text.includes('模拟数据'), {
    message: '所有输入必须明确包含“模拟数据”标记',
  }),
})

export const liveReviewRequestSchema = z.object({
  dataLabel: z.literal('模拟数据'),
  customerName: z.string().min(1),
  projectName: z.string().min(1),
  bom: rawDemoFileSchema,
  suppliers: z.array(rawDemoFileSchema).length(4),
  policy: z.object({
    asOfDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    cnyVatRate: z.number().min(0).max(1),
    fxToCny: z.object({
      CNY: z.number().positive(),
      USD: z.number().positive(),
      HKD: z.number().positive(),
    }),
    minimumGrossMargin: z.number().min(-1).max(1),
  }),
})

export type SupplierExtraction = z.infer<typeof supplierExtractionSchema>
export type BomAnalysis = z.infer<typeof bomAnalysisSchema>
export type EvidenceReview = z.infer<typeof evidenceReviewSchema>
