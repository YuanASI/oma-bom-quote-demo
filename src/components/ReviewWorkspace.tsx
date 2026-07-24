import { useMemo, useState } from 'react'
import { display } from '../domain/quoteEngine'
import type {
  ApprovalState,
  BatchDecision,
  DemoPolicy,
  ReviewItem,
  ReviewRun,
  ReviewStatus,
} from '../domain/types'

interface ReviewWorkspaceProps {
  run: ReviewRun
  policy: DemoPolicy
  approval: ApprovalState
  moreQuoteItemIds: Set<string>
  onOverride: (itemId: string, quoteId: string) => void
  onToggleMoreQuote: (item: ReviewItem) => void
  onDecision: (decision: Exclude<BatchDecision, 'pending'>, note: string) => void
  onExport: () => void
}

type Filter = 'all' | ReviewStatus | 'more_quotes'

const statusMeta: Record<ReviewStatus, { label: string; className: string }> = {
  matched: { label: '已匹配', className: 'success' },
  pending: { label: '待确认', className: 'warning' },
  no_quote: { label: '无报价', className: 'danger' },
}

const decisionLabels: Record<BatchDecision, string> = {
  pending: '待负责人审批',
  approved: '负责人已批准',
  rejected: '负责人已驳回',
  needs_more_quotes: '退回补充询价',
}

function StatusBadge({ status }: { status: ReviewStatus }) {
  const meta = statusMeta[status]
  return <span className={`status-badge ${meta.className}`}>{meta.label}</span>
}

function MetricCard({
  label,
  value,
  caption,
  tone,
}: {
  label: string
  value: string
  caption: string
  tone: string
}) {
  return (
    <article className={`metric-card ${tone}`}>
      <p>{label}</p>
      <strong>{value}</strong>
      <small>{caption}</small>
    </article>
  )
}

function EvidenceDrawer({
  item,
  markedForMoreQuote,
  onClose,
  onOverride,
  onToggleMoreQuote,
}: {
  item: ReviewItem
  markedForMoreQuote: boolean
  onClose: () => void
  onOverride: (itemId: string, quoteId: string) => void
  onToggleMoreQuote: (item: ReviewItem) => void
}) {
  return (
    <div className="drawer-layer" role="presentation">
      <button className="drawer-backdrop" type="button" aria-label="关闭证据抽屉" onClick={onClose} />
      <aside className="evidence-drawer" role="dialog" aria-modal="true" aria-labelledby="evidence-title">
        <div className="drawer-header">
          <div>
            <p className="eyebrow">来源证据 / {item.bom.id}</p>
            <h2 id="evidence-title">{item.bom.canonicalMpn}</h2>
            <p>
              原 BOM 第 {item.bom.originalLines.map((line) => line.lineId).join('、')} 行 ·
              需求 {item.bom.quantity.toLocaleString()} · 目标 {item.bom.targetLeadDays} 天
            </p>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="关闭">
            ×
          </button>
        </div>

        <div className="drawer-scroll">
          {(item.bom.normalizationNotes.length > 0 || item.bom.ambiguityCodes.length > 0) && (
            <section className="evidence-section">
              <h3>归一化记录</h3>
              <ul className="compact-list">
                {item.bom.normalizationNotes.map((note) => <li key={note}>{note}</li>)}
                {item.bom.ambiguityCodes.map((code) => (
                  <li key={code}>待确认标记：{code}</li>
                ))}
              </ul>
            </section>
          )}

          <section className="evidence-section">
            <h3>为什么这样推荐</h3>
            <div className="reason-box">
              {item.recommendationReasons.map((reason) => <p key={reason}>✓ {reason}</p>)}
              {item.lowestNotRecommendedReason && (
                <p className="lowest-explanation">≠ {item.lowestNotRecommendedReason}</p>
              )}
            </div>
          </section>

          <section className="evidence-section">
            <div className="evidence-section-title">
              <h3>候选报价与原始证据</h3>
              <span>{item.alternatives.length} 条匹配</span>
            </div>
            {item.alternatives.length === 0 ? (
              <div className="empty-evidence">
                <strong>四份回复均无匹配项</strong>
                <p>系统没有编造供应商或价格，建议补充询价。</p>
              </div>
            ) : (
              <div className="quote-candidates">
                {item.alternatives.map((quote) => {
                  const selected = quote.id === item.recommendation?.id
                  return (
                    <article className={`quote-candidate ${selected ? 'selected' : ''}`} key={quote.id}>
                      <div className="candidate-head">
                        <div>
                          <span className="supplier-index">{quote.supplierId}</span>
                          <strong>{quote.supplierName}</strong>
                        </div>
                        {selected && <span className="recommendation-tag">当前推荐</span>}
                      </div>
                      <div className="candidate-metrics">
                        <div>
                          <span>归一化未税</span>
                          <strong>{display.money(quote.normalizedCostCny)}</strong>
                        </div>
                        <div>
                          <span>原始报价</span>
                          <strong>{quote.unitPrice} {quote.currency}</strong>
                        </div>
                        <div>
                          <span>库存 / MOQ</span>
                          <strong>{quote.stock.toLocaleString()} / {quote.moq.toLocaleString()}</strong>
                        </div>
                        <div>
                          <span>交期 / 有效期</span>
                          <strong>{quote.leadDays} 天 / {quote.validUntil}</strong>
                        </div>
                        <div>
                          <span>Date Code</span>
                          <strong>{quote.dateCode}</strong>
                        </div>
                        <div>
                          <span>渠道 / 资质</span>
                          <strong>{display.channel(quote.channelType)} / {quote.qualification === 'VERIFIED' ? '已核' : '待核'}</strong>
                        </div>
                      </div>
                      <div className="risk-row">
                        {quote.risks.length === 0 ? (
                          <span className="risk-chip okay">无规则异常</span>
                        ) : quote.risks.map((risk) => (
                          <span className={`risk-chip ${risk.severity}`} key={`${quote.id}-${risk.code}`}>
                            {risk.label}
                          </span>
                        ))}
                      </div>
                      <div className="raw-evidence">
                        <div>
                          <span>{quote.sourceFile}</span>
                          <span>{quote.sourceLocator}</span>
                        </div>
                        <code>{quote.rawEvidence}</code>
                      </div>
                      <button
                        type="button"
                        className={selected ? 'secondary-button selected-button' : 'secondary-button'}
                        disabled={selected}
                        onClick={() => onOverride(item.bom.id, quote.id)}
                      >
                        {selected ? '已选为推荐' : '人工改为此供应商'}
                      </button>
                    </article>
                  )
                })}
              </div>
            )}
          </section>
        </div>

        <div className="drawer-footer">
          <div>
            <strong>不会触发邮件或采购动作</strong>
            <small>该操作只改变本地审核稿并写入审计记录。</small>
          </div>
          <button
            type="button"
            className={markedForMoreQuote ? 'secondary-button active-mark' : 'secondary-button'}
            onClick={() => onToggleMoreQuote(item)}
          >
            {markedForMoreQuote ? '✓ 已标记补充询价' : '标记需要补充询价'}
          </button>
        </div>
      </aside>
    </div>
  )
}

function ApprovalModal({
  onClose,
  onSubmit,
}: {
  onClose: () => void
  onSubmit: (decision: Exclude<BatchDecision, 'pending'>, note: string) => void
}) {
  const [decision, setDecision] = useState<Exclude<BatchDecision, 'pending'>>('approved')
  const [note, setNote] = useState('已核对待确认项，客户正式报价前继续复核有效期与库存。')

  return (
    <div className="modal-layer" role="presentation">
      <button type="button" className="drawer-backdrop" aria-label="关闭审批" onClick={onClose} />
      <form
        className="approval-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="approval-title"
        onSubmit={(event) => {
          event.preventDefault()
          onSubmit(decision, note.trim())
          onClose()
        }}
      >
        <div className="modal-heading">
          <div>
            <p className="eyebrow">人工审批</p>
            <h2 id="approval-title">采购负责人批次决策</h2>
          </div>
          <button className="icon-button" type="button" onClick={onClose}>×</button>
        </div>
        <p className="modal-note">
          决策只更新本地演示状态。不会联系供应商、不会发送客户报价、不会下单。
        </p>
        <fieldset className="decision-options">
          <legend className="visually-hidden">审批决定</legend>
          {[
            ['approved', '批准审核稿', '允许生成客户报价草稿；仍是非正式草稿。'],
            ['rejected', '驳回审核稿', '退回内部重新整理，不产生外部动作。'],
            ['needs_more_quotes', '补充询价', '保留当前结果，先关闭未覆盖和高风险项。'],
          ].map(([value, label, description]) => (
            <label className={decision === value ? 'selected' : ''} key={value}>
              <input
                type="radio"
                name="decision"
                value={value}
                checked={decision === value}
                onChange={() => setDecision(value as Exclude<BatchDecision, 'pending'>)}
              />
              <span>
                <strong>{label}</strong>
                <small>{description}</small>
              </span>
            </label>
          ))}
        </fieldset>
        <label className="note-field">
          <span>审批备注 <b>必填</b></span>
          <textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            minLength={2}
            required
            rows={4}
            placeholder="说明批准条件、退回原因或需要补充的资料"
          />
        </label>
        <div className="modal-actions">
          <button type="button" className="secondary-button" onClick={onClose}>取消</button>
          <button type="submit" className="primary-button">确认并写入审计记录</button>
        </div>
      </form>
    </div>
  )
}

export function ReviewWorkspace({
  run,
  policy,
  approval,
  moreQuoteItemIds,
  onOverride,
  onToggleMoreQuote,
  onDecision,
  onExport,
}: ReviewWorkspaceProps) {
  const [filter, setFilter] = useState<Filter>('all')
  const [selectedItemId, setSelectedItemId] = useState<string>()
  const [approvalOpen, setApprovalOpen] = useState(false)
  const selectedItem = run.items.find((item) => item.bom.id === selectedItemId)
  const filteredItems = useMemo(
    () =>
      run.items.filter((item) => {
        if (filter === 'all') return true
        if (filter === 'more_quotes') return moreQuoteItemIds.has(item.bom.id)
        return item.status === filter
      }),
    [filter, moreQuoteItemIds, run.items],
  )

  return (
    <section className="workspace review-workspace" aria-labelledby="review-title">
      <div className="section-heading review-heading">
        <div>
          <p className="eyebrow">03 / 负责人审核结果</p>
          <h2 id="review-title">采购审核稿，不是自动下单结果</h2>
          <p className="section-description">
            覆盖率按“有至少一条可追溯报价”的归一化采购项计算；待确认项也计入覆盖，但不能直接放行。
          </p>
        </div>
        <div className={`batch-state ${approval.decision}`}>
          <span className="mode-dot" />
          <div>
            <small>批次状态</small>
            <strong>{decisionLabels[approval.decision]}</strong>
          </div>
        </div>
      </div>

      {run.runtime && (
        <div
          className={`run-evidence-card ${
            run.runtime.isLiveModelCall ? 'live' : 'replay'
          } ${
            run.runtime.replayCaptureKind === 'FIXTURE_BASELINE'
              ? 'baseline'
              : ''
          }`}
        >
          <div className="run-evidence-main">
            <span>
              {run.runtime.isLiveModelCall ? '本次真实执行' : '本次离线回放'}
            </span>
            <strong>
              {run.runtime.isLiveModelCall
                ? 'OMA 与模型 API 已实际运行'
                : run.runtime.replayCaptureKind === 'LIVE_OMA_CAPTURE'
                  ? '重放此前真实 OMA 运行的固化结果'
                  : '重放 fixture 基线；尚不是实时 OMA 捕获'}
            </strong>
            <small>{run.runtime.notice}</small>
          </div>
          <div className="run-evidence-facts">
            <span>
              <small>Provider / Model</small>
              <strong>{run.runtime.provider} / {run.runtime.model}</strong>
            </span>
            <span>
              <small>执行标识</small>
              <strong>{run.runtime.runId ?? run.runtime.replayId ?? '—'}</strong>
            </span>
            <span>
              <small>实际角色</small>
              <strong>{run.runtime.receipt?.rolesExecuted.length ?? 0}</strong>
            </span>
            <span>
              <small>证据校验问题</small>
              <strong>{run.runtime.validationIssues.length}</strong>
            </span>
          </div>
        </div>
      )}

      <div className="metric-grid">
        <MetricCard
          label="BOM 覆盖率"
          value={display.percent(run.summary.coverageRate)}
          caption={`${run.summary.coveredCount} / ${run.summary.normalizedLineCount} 个归一化采购项有报价`}
          tone="coverage"
        />
        <MetricCard
          label="已匹配"
          value={String(run.summary.matchedCount)}
          caption="满足核心约束，可进入负责人审核"
          tone="matched"
        />
        <MetricCard
          label="待确认"
          value={String(run.summary.pendingCount)}
          caption="错料、替代、过期、MOQ 或资质风险"
          tone="pending"
        />
        <MetricCard
          label="无报价"
          value={String(run.summary.noQuoteCount)}
          caption="不补造价格，保留为补充询价"
          tone="unquoted"
        />
      </div>

      <div className="review-controls">
        <div className="filter-tabs" role="tablist" aria-label="审核结果筛选">
          {[
            ['all', '全部', run.summary.normalizedLineCount],
            ['matched', '已匹配', run.summary.matchedCount],
            ['pending', '待确认', run.summary.pendingCount],
            ['no_quote', '无报价', run.summary.noQuoteCount],
            ['more_quotes', '补充询价', moreQuoteItemIds.size],
          ].map(([value, label, count]) => (
            <button
              type="button"
              role="tab"
              aria-selected={filter === value}
              className={filter === value ? 'active' : ''}
              key={value}
              onClick={() => setFilter(value as Filter)}
            >
              {label}<span>{count}</span>
            </button>
          ))}
        </div>
        <div className="rule-caption">
          <span>成本口径：CNY 未税</span>
          <span>交期：自然日（模拟）</span>
          <span>最低毛利提醒：{display.percent(policy.minimumGrossMargin)}</span>
        </div>
      </div>

      <div className="table-scroll review-table-wrap">
        <table className="review-table">
          <thead>
            <tr>
              <th>采购项 / 原 BOM</th>
              <th>归一化料号</th>
              <th>需求</th>
              <th>推荐供应商</th>
              <th>归一化成本</th>
              <th>预计交期</th>
              <th>目标价毛利</th>
              <th>状态 / 关键风险</th>
              <th>证据</th>
            </tr>
          </thead>
          <tbody>
            {filteredItems.map((item) => (
              <tr key={item.bom.id} className={moreQuoteItemIds.has(item.bom.id) ? 'marked-row' : ''}>
                <td>
                  <span className="item-id">{item.bom.id}</span>
                  <small>原第 {item.bom.originalLines.map((line) => line.lineId).join('+')} 行</small>
                </td>
                <td>
                  <strong className="mono">{item.bom.canonicalMpn}</strong>
                  <small>{item.bom.brand || '品牌待确认'} · {item.bom.description}</small>
                </td>
                <td>
                  <strong>{item.bom.quantity.toLocaleString()}</strong>
                  <small>目标 {item.bom.targetLeadDays} 天</small>
                </td>
                <td>
                  <strong>{item.recommendation?.supplierName ?? '—'}</strong>
                  <small>
                    {item.recommendation
                      ? `${display.channel(item.recommendation.channelType)} · ${item.recommendation.dateCode}`
                      : '四份回复均未覆盖'}
                  </small>
                </td>
                <td>
                  <strong>{display.money(item.recommendation?.normalizedCostCny)}</strong>
                  <small className={item.lowestNotRecommendedReason ? 'price-delta' : ''}>
                    {item.lowestNotRecommendedReason && item.lowestQuote
                      ? `最低 ${display.money(item.lowestQuote.normalizedCostCny)} 未采用`
                      : item.recommendation
                        ? `${item.recommendation.unitPrice} ${item.recommendation.currency} · ${item.recommendation.taxBasis === 'VAT_INCLUDED' ? '含税' : '未税'}`
                        : '待补询'}
                  </small>
                </td>
                <td>
                  <strong>{item.expectedLeadDays ? `${item.expectedLeadDays} 天` : '—'}</strong>
                  <small>{item.recommendation ? `库存 ${item.recommendation.stock.toLocaleString()}` : '无来源'}</small>
                </td>
                <td>
                  <strong className={item.marginWarning ? 'margin-warning' : ''}>
                    {item.grossMargin === undefined ? '—' : display.percent(item.grossMargin)}
                  </strong>
                  <small>{item.marginWarning ? '低毛利提醒' : `目标 ${display.money(item.bom.targetUnitPriceCny)}`}</small>
                </td>
                <td className="risk-cell">
                  <StatusBadge status={item.status} />
                  <small title={item.keyRisks.join('；')}>
                    {moreQuoteItemIds.has(item.bom.id)
                      ? '已标记补充询价'
                      : item.keyRisks[0] ?? '核心规则未发现异常'}
                    {item.keyRisks.length > 1 ? ` +${item.keyRisks.length - 1}` : ''}
                  </small>
                </td>
                <td>
                  <button
                    type="button"
                    className="evidence-button"
                    onClick={() => setSelectedItemId(item.bom.id)}
                  >
                    查看来源
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="approval-bar">
        <div>
          <span className="approval-shield">人</span>
          <div>
            <strong>负责人保留最终决定权</strong>
            <small>
              {approval.note || '可批准、驳回、改选供应商或标记补充询价；每次操作进入本地审计记录。'}
            </small>
          </div>
        </div>
        <div className="approval-actions">
          {approval.decision !== 'pending' && (
            <button type="button" className="secondary-button" onClick={onExport}>进入导出</button>
          )}
          <button type="button" className="primary-button" onClick={() => setApprovalOpen(true)}>
            {approval.decision === 'pending' ? '负责人审批' : '重新审批'}
          </button>
        </div>
      </div>

      {selectedItem && (
        <EvidenceDrawer
          item={selectedItem}
          markedForMoreQuote={moreQuoteItemIds.has(selectedItem.bom.id)}
          onClose={() => setSelectedItemId(undefined)}
          onOverride={onOverride}
          onToggleMoreQuote={onToggleMoreQuote}
        />
      )}
      {approvalOpen && (
        <ApprovalModal
          onClose={() => setApprovalOpen(false)}
          onSubmit={onDecision}
        />
      )}
    </section>
  )
}
