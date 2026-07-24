import type {
  LLMAdapter,
  LLMChatOptions,
  LLMMessage,
  LLMResponse,
} from '@open-multi-agent/core'
import type { SupplierDocument } from '../src/domain/types.js'
import { loadBundledDataset } from './fixture-loader.js'
import type { OmaRunnerOptions } from './oma-runner.js'
import type { EvidenceReview } from './schemas.js'

function jsonAdapter(name: string, payload: unknown): LLMAdapter {
  return {
    name,
    async chat(
      _messages: LLMMessage[],
      options: LLMChatOptions,
    ): Promise<LLMResponse> {
      return {
        id: `${name}-response`,
        content: [{ type: 'text', text: JSON.stringify(payload) }],
        model: options.model,
        stop_reason: 'end_turn',
        usage: { input_tokens: 20, output_tokens: 30 },
      }
    },
    async *stream() {
      yield {
        type: 'done' as const,
        data: {
          id: `${name}-stream`,
          content: [],
          model: name,
          stop_reason: 'end_turn',
          usage: { input_tokens: 0, output_tokens: 0 },
        },
      }
    },
  }
}

function supplierPayload(
  document: SupplierDocument,
  documentWarnings: string[] = [],
) {
  return {
    supplier: {
      id: document.supplierId,
      name: document.supplierName,
      contact: document.quotes[0]?.contact ?? '虚构联系人',
      email: document.quotes[0]?.email ?? 'unknown@demo.invalid',
      qualification: document.qualification,
    },
    quotes: document.quotes.map((quote) => ({
      mpn: quote.mpn,
      brand: quote.brand,
      unitPrice: quote.unitPrice,
      currency: quote.currency,
      taxBasis: quote.taxBasis,
      moq: quote.moq,
      stock: quote.stock,
      leadDays: quote.leadDays,
      validUntil: quote.validUntil,
      dateCode: quote.dateCode,
      channelType: quote.channelType,
      ...(quote.alternateFor ? { alternateFor: quote.alternateFor } : {}),
      remark: quote.remark,
      sourceLocator: quote.sourceLocator,
      sourceExcerpt: quote.rawEvidence,
      confidence: 0.99,
      unresolvedFields: [],
    })),
    documentWarnings,
  }
}

export async function fixtureRunnerOptions(
  evidencePayload: EvidenceReview = {
    decision: 'PASS',
    findings: [],
  },
  supplierDocumentWarnings: string[] = [],
): Promise<OmaRunnerOptions> {
  const dataset = await loadBundledDataset()
  return {
    runId: 'bom-live-fixture-test',
    adapters: {
      bom: jsonAdapter('fixture-bom', {
        findings: [
          {
            originalPartNumber: 'TPS62160DSG',
            suggestedCanonicalMpn: 'TPS62160DSGR',
            sourceLine: 8,
            issue: '包装后缀需要工程人员确认',
            requiresHumanReview: true,
          },
          {
            originalPartNumber: 'GRM188R71C104KA01?',
            suggestedCanonicalMpn: 'GRM188R71C104KA01D',
            sourceLine: 19,
            issue: '末位字符不确定',
            requiresHumanReview: true,
          },
        ],
      }),
      suppliers: dataset.supplierDocuments.map((document, index) =>
        jsonAdapter(
          `fixture-supplier-${index + 1}`,
          supplierPayload(document, index === 0 ? supplierDocumentWarnings : []),
        ),
      ),
      evidence: jsonAdapter('fixture-evidence', evidencePayload),
    },
  }
}
