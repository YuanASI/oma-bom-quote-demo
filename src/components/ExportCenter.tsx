import type { ExportArtifact } from '../domain/exports'
import { downloadArtifact } from '../domain/exports'
import type { ApprovalState, AuditEntry } from '../domain/types'
import { trackDemoEvent } from '../analytics'

interface ExportCenterProps {
  artifacts: ExportArtifact[]
  approval: ApprovalState
  auditEntries: AuditEntry[]
}

const artifactMarks: Record<ExportArtifact['id'], string> = {
  customer_quote: 'CQ',
  procurement_review: 'PR',
  exceptions: 'EX',
  audit: 'AU',
}

const decisionText = {
  pending: '尚未审批；导出内容仍标记为草稿',
  approved: '负责人已批准生成草稿',
  rejected: '负责人已驳回；导出仅供复盘',
  needs_more_quotes: '负责人要求补充询价',
}

export function ExportCenter({ artifacts, approval, auditEntries }: ExportCenterProps) {
  return (
    <section className="workspace export-workspace" aria-labelledby="export-title">
      <div className="section-heading">
        <div>
          <p className="eyebrow">04 / 导出交付</p>
          <h2 id="export-title">把审核结论带走，不把风险藏起来</h2>
          <p className="section-description">
            四份文件在浏览器本地生成；每份都带“模拟数据”标记，未解决项不会被包装成完整报价。
          </p>
        </div>
        <div className={`export-decision ${approval.decision}`}>
          <small>审批状态</small>
          <strong>{decisionText[approval.decision]}</strong>
          {approval.note && <span>{approval.note}</span>}
        </div>
      </div>

      <div className="artifact-grid">
        {artifacts.map((artifact) => (
          <article className="artifact-card" key={artifact.id}>
            <div className="artifact-mark">{artifactMarks[artifact.id]}</div>
            <div className="artifact-copy">
              <span className="tiny-label">{artifact.fileName.endsWith('.json') ? 'JSON' : 'CSV'}</span>
              <h3>{artifact.label}</h3>
              <p>{artifact.description}</p>
              <div className="artifact-meta">
                <span>{artifact.rowCount} 条记录</span>
                <span>{artifact.fileName}</span>
              </div>
            </div>
            <button
              type="button"
              className="secondary-button"
              onClick={() => {
                trackDemoEvent('demo_export_downloaded', { artifact: artifact.id })
                downloadArtifact(artifact)
              }}
            >
              下载文件
              <span aria-hidden="true">↓</span>
            </button>
          </article>
        ))}
      </div>

      <div className="export-lower-grid">
        <article className="audit-preview">
          <div className="evidence-section-title">
            <div>
              <p className="eyebrow">本地审计记录</p>
              <h3>刚刚发生了什么</h3>
            </div>
            <span>{auditEntries.length} 个事件</span>
          </div>
          <div className="audit-list">
            {[...auditEntries].reverse().slice(0, 5).map((entry) => (
              <div key={entry.id}>
                <time>{new Date(entry.timestamp).toLocaleTimeString('zh-CN', { hour12: false })}</time>
                <span className="audit-dot" />
                <p>
                  <strong>{entry.action}</strong>
                  <small>{entry.subject} · {entry.detail}</small>
                </p>
              </div>
            ))}
          </div>
        </article>

        <article className="boundary-card">
          <p className="eyebrow">真实能力边界</p>
          <h3>这次 Demo 证明什么、不证明什么</h3>
          <ul>
            <li><span>✓</span><p><strong>证明</strong>从混乱资料到可审核交付物的流程形态可以本地跑通。</p></li>
            <li><span>✓</span><p><strong>证明</strong>规则、证据、人工审批和未解决项可以同时保留。</p></li>
            <li><span>×</span><p><strong>不证明</strong>真实客户已经节省时间、提升准确率、毛利或成交。</p></li>
            <li><span>×</span><p><strong>不代表</strong>替代料已通过工程认证，也没有接入任何生产系统。</p></li>
          </ul>
          <div className="next-proof">
            下一步证据：用客户 3–10 份脱敏历史 BOM 做回放，对比原人工结果。
          </div>
        </article>
      </div>
    </section>
  )
}
