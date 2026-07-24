import type {
  BomLine,
  Currency,
  Qualification,
  SourceFormat,
  SupplierDocument,
  SupplierQuote,
  TaxBasis,
  ChannelType,
} from './types.js'

interface CsvRow {
  values: Record<string, string>
  sourceLine: number
  raw: string
}

function splitCsvLine(line: string): string[] {
  const cells: string[] = []
  let cell = ''
  let quoted = false

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index]
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        cell += '"'
        index += 1
      } else {
        quoted = !quoted
      }
    } else if (character === ',' && !quoted) {
      cells.push(cell.trim())
      cell = ''
    } else {
      cell += character
    }
  }

  cells.push(cell.trim())
  return cells
}

function parseCsv(text: string): CsvRow[] {
  const lines = text.split(/\r?\n/)
  const meaningful = lines
    .map((raw, index) => ({ raw, sourceLine: index + 1 }))
    .filter(({ raw }) => raw.trim() && !raw.trim().startsWith('#'))

  if (meaningful.length < 2) return []
  const headers = splitCsvLine(meaningful[0].raw)

  return meaningful.slice(1).map(({ raw, sourceLine }) => {
    const cells = splitCsvLine(raw)
    const values = Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? '']))
    return { values, sourceLine, raw }
  })
}

function requiredNumber(value: string, field: string, source: string): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) {
    throw new Error(`${source} 的 ${field} 不是有效数字`)
  }
  return parsed
}

function quoteFromCsvRow(fileName: string, row: CsvRow, index: number): SupplierQuote {
  const value = row.values
  return {
    id: `${value.supplier_id}-${index + 1}`,
    supplierId: value.supplier_id,
    supplierName: value.supplier_name,
    contact: value.contact,
    email: value.email,
    qualification: value.qualification as Qualification,
    mpn: value.mpn,
    brand: value.brand,
    unitPrice: requiredNumber(value.unit_price, 'unit_price', fileName),
    currency: value.currency as Currency,
    taxBasis: value.tax_basis as TaxBasis,
    moq: requiredNumber(value.moq, 'moq', fileName),
    stock: requiredNumber(value.stock, 'stock', fileName),
    leadDays: requiredNumber(value.lead_days, 'lead_days', fileName),
    validUntil: value.valid_until,
    dateCode: value.date_code,
    channelType: value.channel_type as ChannelType,
    alternateFor: value.alternate_for || undefined,
    remark: value.remark,
    dataLabel: '模拟数据',
    sourceFile: fileName,
    sourceLocator: `第 ${row.sourceLine} 行`,
    rawEvidence: row.raw,
  }
}

export function parseBomCsv(fileName: string, text: string): BomLine[] {
  return parseCsv(text).map(({ values, sourceLine }) => ({
    lineId: requiredNumber(values.line_id, 'line_id', fileName),
    partNumber: values.part_number,
    brand: values.brand,
    description: values.description,
    quantity: requiredNumber(values.quantity, 'quantity', fileName),
    targetLeadDays: requiredNumber(values.target_lead_days, 'target_lead_days', fileName),
    targetUnitPriceCny: values.target_unit_price_cny
      ? requiredNumber(values.target_unit_price_cny, 'target_unit_price_cny', fileName)
      : undefined,
    remarks: values.remarks,
    dataLabel: '模拟数据',
    sourceFile: fileName,
    sourceLocator: `第 ${sourceLine} 行`,
  }))
}

function parseSupplierCsv(fileName: string, text: string): SupplierDocument {
  const rows = parseCsv(text)
  const quotes = rows.map((row, index) => quoteFromCsvRow(fileName, row, index))
  const first = quotes[0]
  if (!first) throw new Error(`${fileName} 没有报价行`)

  return {
    supplierId: first.supplierId,
    supplierName: first.supplierName,
    fileName,
    format: 'CSV',
    qualification: first.qualification,
    rawText: text,
    quotes,
  }
}

function emailNumber(line: string, pattern: RegExp, field: string, fileName: string): number {
  const value = line.match(pattern)?.[1]?.replaceAll(',', '')
  return requiredNumber(value ?? '', field, fileName)
}

function emailChannel(line: string): ChannelType {
  if (line.includes('授权渠道')) return 'AUTHORIZED'
  if (line.includes('经纪商')) return 'BROKER'
  if (line.includes('现货渠道')) return 'SPOT'
  return 'INDEPENDENT'
}

function parseSupplierEmail(fileName: string, text: string): SupplierDocument {
  const lines = text.split(/\r?\n/)
  const supplierName = lines.find((line) => line.startsWith('Company:'))?.split(':').slice(1).join(':').trim()
  const supplierId = lines.find((line) => line.startsWith('Supplier-ID:'))?.split(':').slice(1).join(':').trim()
  const qualification = lines
    .find((line) => line.startsWith('Qualification:'))
    ?.split(':')
    .slice(1)
    .join(':')
    .trim() as Qualification | undefined
  const fromLine = lines.find((line) => line.startsWith('From:')) ?? ''
  const contact = fromLine.match(/^From:\s*(.*?)\s*</)?.[1] ?? '虚构联系人'
  const email = fromLine.match(/<(.*?)>/)?.[1] ?? 'unknown@demo.invalid'

  if (!supplierName || !supplierId || !qualification) {
    throw new Error(`${fileName} 缺少邮件供应商元数据`)
  }

  const quotes = lines.flatMap((line, index) => {
    const heading = line.match(
      /^\d+）\s*(.+?)（(.+?)）：(CNY|USD|HKD)\s+([0-9.]+)，(含税|未税)。/,
    )
    if (!heading) return []
    const [, mpn, brand, currency, price, taxLabel] = heading
    const validUntil = line.match(/有效(?:到|至)\s*(\d{4}-\d{2}-\d{2})/)?.[1]
    const dateCode = line.match(/(?:^|，)DC\s+([^，。]+)/)?.[1]?.trim()
    if (!validUntil || !dateCode) {
      throw new Error(`${fileName} 邮件正文第 ${index + 1} 行缺少有效期或 Date Code`)
    }
    const alternateFor = line.match(/替代原询价\s*([^，。]+)/)?.[1]?.trim()
    const remark = line.match(/备注：(.+?)(?:。|$)/)?.[1]?.trim() ?? ''
    const quote: SupplierQuote = {
      id: `${supplierId}-${index + 1}`,
      supplierId,
      supplierName,
      contact,
      email,
      qualification,
      mpn,
      brand,
      unitPrice: requiredNumber(price, '报价', fileName),
      currency: currency as Currency,
      taxBasis: taxLabel === '含税' ? 'VAT_INCLUDED' : 'EXCLUDED',
      moq: emailNumber(line, /MOQ\s*([\d,]+)/, 'MOQ', fileName),
      stock: emailNumber(line, /库存\s*([\d,]+)/, '库存', fileName),
      leadDays: emailNumber(line, /交期\s*(\d+)\s*天/, '交期', fileName),
      validUntil,
      dateCode,
      channelType: emailChannel(line),
      alternateFor,
      remark,
      dataLabel: '模拟数据',
      sourceFile: fileName,
      sourceLocator: `邮件正文第 ${index + 1} 行`,
      rawEvidence: line,
    }
    return [quote]
  })

  return {
    supplierId,
    supplierName,
    fileName,
    format: 'EMAIL',
    qualification,
    rawText: text,
    quotes,
  }
}

interface JsonSupplierFile {
  dataLabel: string
  supplier: {
    id: string
    name: string
    contact: string
    email: string
    qualification: Qualification
  }
  currency: Currency
  taxBasis: TaxBasis
  quotes: Array<{
    mpn: string
    brand: string
    unitPrice: number
    moq: number
    stock: number
    leadDays: number
    validUntil: string
    dateCode: string
    channelType: ChannelType
    alternateFor?: string
    remark: string
  }>
}

function jsonQuoteEvidence(
  text: string,
  mpn: string,
  unitPrice: number,
  index: number,
): { sourceLocator: string; rawEvidence: string } {
  const lines = text.split(/\r?\n/)
  const start = lines.findIndex((line) => line.includes(`"mpn": "${mpn}"`))
  const price = lines.findIndex(
    (line, lineIndex) =>
      lineIndex >= start && line.includes(`"unitPrice": ${unitPrice}`),
  )
  if (start < 0 || price < start) {
    return {
      sourceLocator: `quotes[${index}]`,
      rawEvidence: `"mpn": "${mpn}" / "unitPrice": ${unitPrice}`,
    }
  }
  return {
    sourceLocator: `quotes[${index}]，第 ${start + 1}–${price + 1} 行`,
    rawEvidence: lines.slice(start, price + 1).join('\n').trim(),
  }
}

function parseSupplierJson(fileName: string, text: string): SupplierDocument {
  const data = JSON.parse(text) as JsonSupplierFile
  if (data.dataLabel !== '模拟数据') {
    throw new Error(`${fileName} 未标记为模拟数据`)
  }

  const quotes = data.quotes.map((quote, index): SupplierQuote => {
    const evidence = jsonQuoteEvidence(text, quote.mpn, quote.unitPrice, index)
    return {
      ...quote,
      id: `${data.supplier.id}-${index + 1}`,
      supplierId: data.supplier.id,
      supplierName: data.supplier.name,
      contact: data.supplier.contact,
      email: data.supplier.email,
      qualification: data.supplier.qualification,
      currency: data.currency,
      taxBasis: data.taxBasis,
      alternateFor: quote.alternateFor || undefined,
      dataLabel: '模拟数据',
      sourceFile: fileName,
      ...evidence,
    }
  })

  return {
    supplierId: data.supplier.id,
    supplierName: data.supplier.name,
    fileName,
    format: 'JSON',
    qualification: data.supplier.qualification,
    rawText: text,
    quotes,
  }
}

export function parseSupplierDocument(fileName: string, text: string): SupplierDocument {
  const lower = fileName.toLowerCase()
  if (lower.endsWith('.json')) return parseSupplierJson(fileName, text)
  if (lower.endsWith('.txt')) return parseSupplierEmail(fileName, text)
  if (lower.endsWith('.csv')) return parseSupplierCsv(fileName, text)
  throw new Error(`${fileName} 格式不支持；仅支持 CSV、TXT 邮件和 JSON`)
}

export function formatLabel(format: SourceFormat): string {
  if (format === 'EMAIL') return '邮件正文'
  return format
}
