import { useMemo, useRef, useState } from 'react'
import { downloadRawFile } from '../domain/exports'
import { formatLabel } from '../domain/importers'
import type {
  DemoDataset,
  DemoPath,
  ImportResult,
  RuntimeStatus,
} from '../domain/types'

interface InputWorkspaceProps {
  dataset: DemoDataset
  importResults: ImportResult[]
  runtimeStatus?: RuntimeStatus
  runtimeError?: string
  selectedPath: DemoPath
  isBundledDataset: boolean
  customImportsAllowed: boolean
  onImport: (files: FileList) => Promise<void>
  onPathChange: (path: DemoPath) => void
  onRun: (path: DemoPath) => void
}

interface SourceFile {
  fileName: string
  kind: 'bom' | 'supplier'
  format: string
  rawText: string
  count: number
  subtitle: string
}

function lineCount(text: string): number {
  return text.split(/\r?\n/).filter((line) => line.trim()).length
}

export function InputWorkspace({
  dataset,
  importResults,
  runtimeStatus,
  runtimeError,
  selectedPath,
  isBundledDataset,
  customImportsAllowed,
  onImport,
  onPathChange,
  onRun,
}: InputWorkspaceProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const files = useMemo<SourceFile[]>(
    () => [
      {
        fileName: dataset.bomFileName,
        kind: 'bom',
        format: 'CSV',
        rawText: dataset.bomRawText,
        count: dataset.bomLines.length,
        subtitle: `${dataset.bomLines.length} 行客户 BOM`,
      },
      ...dataset.supplierDocuments.map((document) => ({
        fileName: document.fileName,
        kind: 'supplier' as const,
        format: formatLabel(document.format),
        rawText: document.rawText,
        count: document.quotes.length,
        subtitle: `${document.supplierName} · ${document.quotes.length} 条回复`,
      })),
    ],
    [dataset],
  )
  const [selectedFileName, setSelectedFileName] = useState(files[0].fileName)
  const selected = files.find((file) => file.fileName === selectedFileName) ?? files[0]

  async function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    if (!event.target.files?.length) return
    await onImport(event.target.files)
    event.target.value = ''
  }

  return (
    <section className="workspace input-workspace" aria-labelledby="input-title">
      <div className="section-heading">
        <div>
          <p className="eyebrow">01 / 原始输入</p>
          <h2 id="input-title">先看清人工每天面对什么</h2>
          <p className="section-description">
            同一份 BOM 里有重复、缺品牌和疑似错料号；四家供应商用三种格式、三种币种和不同税费口径回复。
          </p>
        </div>
        <div className="input-summary" aria-label="输入资料统计">
          <span><b>{dataset.bomLines.length}</b> 条 BOM</span>
          <span><b>{dataset.supplierDocuments.length}</b> 家供应商</span>
          <span><b>3</b> 种格式</span>
        </div>
      </div>

      <div className="source-layout">
        <aside className="source-list" aria-label="模拟输入文件">
          <div className="source-list-title">
            <span>原始资料</span>
            <span className="tiny-label">全部为模拟</span>
          </div>
          {files.map((file) => (
            <button
              key={file.fileName}
              type="button"
              className={`source-card ${selected.fileName === file.fileName ? 'active' : ''}`}
              onClick={() => setSelectedFileName(file.fileName)}
            >
              <span className={`file-mark ${file.kind}`}>{file.format.slice(0, 4)}</span>
              <span className="source-card-copy">
                <strong>{file.fileName}</strong>
                <small>{file.subtitle}</small>
              </span>
              <span className="source-count">{file.count}</span>
            </button>
          ))}

          {customImportsAllowed ? (
            <>
              <button type="button" className="upload-zone" onClick={() => inputRef.current?.click()}>
                <span className="upload-plus">＋</span>
                <span>
                  <strong>导入本地模拟文件</strong>
                  <small>实时模式会经本地服务发送给模型</small>
                </span>
              </button>
              <input
                ref={inputRef}
                className="visually-hidden"
                type="file"
                accept=".csv,.txt,.json"
                multiple
                onChange={handleFileChange}
              />
            </>
          ) : (
            <div className="upload-zone" role="note">
              <span className="upload-plus">×</span>
              <span>
                <strong>公开版禁止上传文件</strong>
                <small>仅运行内置模拟测试集，请勿提交真实业务资料</small>
              </span>
            </div>
          )}

          {importResults.length > 0 && (
            <div className="import-results" aria-live="polite">
              {importResults.slice(-3).map((result) => (
                <p key={`${result.fileName}-${result.message}`}>
                  <span>✓</span>
                  {result.message}
                </p>
              ))}
            </div>
          )}
        </aside>

        <div className="source-preview">
          <div className="preview-toolbar">
            <div>
              <span className="tiny-label">{selected.format}</span>
              <strong>{selected.fileName}</strong>
            </div>
            <button
              type="button"
              className="text-button"
              onClick={() => downloadRawFile(selected.fileName, selected.rawText)}
            >
              下载原始文件
            </button>
          </div>

          {selected.kind === 'bom' ? (
            <div className="table-scroll raw-bom-table">
              <table>
                <thead>
                  <tr>
                    <th>行</th>
                    <th>原始料号</th>
                    <th>品牌</th>
                    <th>数量</th>
                    <th>目标交期</th>
                    <th>目标价</th>
                    <th>原备注</th>
                  </tr>
                </thead>
                <tbody>
                  {dataset.bomLines.map((line) => (
                    <tr key={line.lineId}>
                      <td className="mono muted">{line.lineId}</td>
                      <td className="mono strong">{line.partNumber}</td>
                      <td className={!line.brand ? 'missing-value' : ''}>{line.brand || '缺失'}</td>
                      <td>{line.quantity.toLocaleString()}</td>
                      <td>{line.targetLeadDays} 天</td>
                      <td>¥{line.targetUnitPriceCny?.toFixed(3)}</td>
                      <td>{line.remarks}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <pre className="raw-text-preview">
              <code>{selected.rawText}</code>
            </pre>
          )}

          <div className="preview-foot">
            <span>{lineCount(selected.rawText)} 个非空原始行</span>
            <span>本地文件 · 尚未开始处理</span>
          </div>
        </div>
      </div>

      <div className="execution-picker" aria-label="选择演示路径">
        <button
          type="button"
          className={`execution-option ${selectedPath === 'live' ? 'selected' : ''}`}
          onClick={() => onPathChange('live')}
        >
          <span className="execution-kicker">主路径</span>
          <strong>真实 OMA + DeepSeek</strong>
          <small>
            真实执行固定 DAG：BOM 分析、四家供应商并行抽取、独立证据复核；业务数据全部为模拟。
          </small>
          <span
            className={`runtime-pill ${runtimeStatus?.liveAvailable ? 'ready' : 'blocked'}`}
          >
            {runtimeStatus
              ? runtimeStatus.liveAvailable
                ? `${runtimeStatus.model} 已就绪`
                : 'DeepSeek Key 未配置'
              : runtimeError
                ? '本地服务不可用'
                : '正在检查本地服务'}
          </span>
        </button>
        <button
          type="button"
          className={`execution-option ${selectedPath === 'replay' ? 'selected' : ''}`}
          onClick={() => onPathChange('replay')}
          disabled={runtimeStatus?.replay.available === false}
        >
          <span className="execution-kicker">备用路径</span>
          <strong>离线回放</strong>
          <small>
            不调用模型，只重放已固化输出；界面和导出始终保留回放标记，绝不冒充本次实时执行。
          </small>
          <span className="runtime-pill replay">
            {runtimeStatus?.replay.available
              ? runtimeStatus.replay.captureKind === 'LIVE_OMA_CAPTURE'
                ? '真实 OMA 捕获包'
                : 'fixture 基线回放'
              : '正在检查回放包'}
          </span>
        </button>
      </div>

      {selectedPath === 'live' && (
        <div className="path-disclosure live">
          <strong>外部调用说明</strong>
          <span>
            点击运行后，以上模拟文件会由本机 Node 服务发送到
            {' '}{runtimeStatus?.provider ?? 'DeepSeek'} 模型 API。Key 只留在服务端环境变量中。
          </span>
        </div>
      )}
      {selectedPath === 'replay' && !isBundledDataset && (
        <div className="path-disclosure warning">
          <strong>回放不处理刚导入的文件</strong>
          <span>离线回放只对应仓库内置模拟 fixture；要处理新模拟文件，请使用实时 OMA 路径。</span>
        </div>
      )}
      {runtimeError && (
        <div className="path-disclosure warning">
          <strong>本地服务状态读取失败</strong>
          <span>{runtimeError}</span>
        </div>
      )}

      <div className="primary-action-row">
        <div className="mode-proof">
          <span className="mode-dot" />
          <div>
            <strong>
              {selectedPath === 'live' ? '实时模型执行，不自动降级' : '离线回放，明确保留来源'}
            </strong>
            <small>
              {selectedPath === 'live'
                ? '失败会停在错误页，由演示者明确决定是否切换回放'
                : runtimeStatus?.replay.notice ?? '不需要 API Key，不发起模型请求'}
            </small>
          </div>
        </div>
        <button
          type="button"
          className="primary-button"
          disabled={
            selectedPath === 'live'
              ? runtimeStatus?.liveAvailable !== true
              : runtimeStatus?.replay.available !== true
          }
          onClick={() => onRun(selectedPath)}
        >
          {selectedPath === 'live' ? '运行真实 OMA 审核' : '运行离线回放'}
          <span aria-hidden="true">→</span>
        </button>
      </div>
    </section>
  )
}
