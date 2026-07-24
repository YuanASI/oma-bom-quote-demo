import type {
  DemoDataset,
  ProcessingState,
  ReviewRun,
} from '../domain/types'

interface ProcessingWorkspaceProps {
  dataset: DemoDataset
  run?: ReviewRun
  state: ProcessingState
  onContinue: () => void
  onRetry: () => void
  onReplay: () => void
  onBack: () => void
}

interface Phase {
  title: string
  detail: string
  result: string
  oma: boolean
}

function livePhases(dataset: DemoDataset, run?: ReviewRun): Phase[] {
  return [
    {
      title: 'BOM 解析与歧义识别',
      detail: 'OMA 的 BOM 分析角色读取原始行，只返回需要人工留意的规范化问题。',
      result: run ? `${run.summary.rawLineCount} 行 → ${run.summary.normalizedLineCount} 项` : '等待回执',
      oma: true,
    },
    {
      title: '四家回复并行抽取',
      detail: '四个独立角色同时读取 CSV、邮件正文和 JSON，输出结构化报价与原文摘录。',
      result: run
        ? `${dataset.supplierDocuments.length} 份回复已归一`
        : '5 个前置任务并行',
      oma: true,
    },
    {
      title: '独立证据复核',
      detail: '复核角色依赖前置结果，检查来源支持、字段缺失和需要人工确认的风险。',
      result: run?.runtime?.receipt?.independentReviewOccurred
        ? '独立复核已发生'
        : '等待依赖完成',
      oma: true,
    },
    {
      title: '确定性业务比较',
      detail: '应用规则统一汇率与税费，再比较价格、库存、交期、MOQ 和资质。',
      result: run ? `${run.summary.coveredCount} 项有可追溯报价` : '等待模型输出',
      oma: false,
    },
    {
      title: '形成采购审核稿',
      detail: '保留推荐、最低价未采用原因、责任角色、异常和来源证据。',
      result: run
        ? `${run.summary.matchedCount} 可推荐 / ${run.summary.pendingCount} 待确认`
        : '等待生成',
      oma: false,
    },
  ]
}

function replayPhases(dataset: DemoDataset, run?: ReviewRun): Phase[] {
  return [
    {
      title: '校验回放包',
      detail: '比对 fixture 哈希和回放元数据，避免把过期输出套在不同输入上。',
      result: run?.runtime?.replayId ?? '等待校验',
      oma: false,
    },
    {
      title: '载入固化输出',
      detail: '读取明确标注的回放内容；本次不会执行 OMA，也不会调用模型。',
      result: run?.runtime?.replayCaptureKind ?? '不调用模型',
      oma: false,
    },
    {
      title: '恢复来源证据',
      detail: '把固化的报价抽取结果重新关联到内置模拟供应商文件。',
      result: run ? `${dataset.supplierDocuments.length} 份模拟回复` : '等待载入',
      oma: false,
    },
    {
      title: '重跑确定性规则',
      detail: '汇率、税费和风险比较仍在当前应用代码中重新计算。',
      result: run ? `${run.summary.coveredCount} 项有可追溯报价` : '等待载入',
      oma: false,
    },
    {
      title: '形成采购审核稿',
      detail: '结果页和导出保留 OFFLINE_REPLAY 标记，不冒充实时模型结果。',
      result: run
        ? `${run.summary.matchedCount} 可推荐 / ${run.summary.pendingCount} 待确认`
        : '等待生成',
      oma: false,
    },
  ]
}

export function ProcessingWorkspace({
  dataset,
  run,
  state,
  onContinue,
  onRetry,
  onReplay,
  onBack,
}: ProcessingWorkspaceProps) {
  const isLive = state.path === 'live'
  const completed = state.status === 'success' && run !== undefined
  const failed = state.status === 'error'
  const phases = isLive ? livePhases(dataset, run) : replayPhases(dataset, run)
  const progress = completed ? 100 : failed ? 0 : isLive ? 38 : 62

  return (
    <section className="workspace processing-workspace" aria-labelledby="processing-title">
      <div className="processing-header">
        <p className="eyebrow">02 / 处理过程</p>
        <h2 id="processing-title">
          {failed
            ? isLive
              ? '实时 OMA 执行没有完成'
              : '离线回放没有完成'
            : completed
              ? '采购审核稿已生成'
              : isLive
                ? 'OMA 正在处理模拟 BOM'
                : '正在载入离线回放'}
        </h2>
        <p>
          {failed
            ? '系统已停止，没有自动切换路径，也没有生成伪成功结果。'
            : completed
              ? run.runtime?.notice
              : isLive
                ? '这是整批请求：界面只显示已提交的固定流程，不猜测模型内部进度。'
                : '本次不会执行 OMA 或调用模型；完成后仍会重新运行当前业务规则。'}
        </p>
      </div>

      <div className={`process-mode-banner ${isLive ? 'live' : 'replay'}`}>
        <span>{isLive ? 'LIVE OMA' : 'OFFLINE REPLAY'}</span>
        <strong>
          {isLive
            ? '5 个前置角色并行 → 1 个独立证据复核'
            : '固化输出 → 当前规则重新计算'}
        </strong>
        <small>
          {isLive
            ? '模型负责结构化读取与风险发现；推荐评分仍由可检查的应用规则完成。'
            : '回放路径用于演示稳定性，不代表本次发生了实时模型调用。'}
        </small>
      </div>

      <div className="process-progress" aria-label={`处理进度 ${progress}%`}>
        <div className={`progress-track ${state.status === 'running' ? 'indeterminate' : ''}`}>
          <span style={{ width: `${progress}%` }} />
        </div>
        <strong>{failed ? '停止' : completed ? '完成' : '执行中'}</strong>
      </div>

      <div className="phase-grid">
        {phases.map((phase, index) => {
          const phaseState = completed
            ? 'done'
            : failed
              ? index === 0
                ? 'failed'
                : 'waiting'
              : index < (isLive ? 2 : 3)
                ? 'active'
                : 'waiting'
          return (
            <article className={`phase-card ${phaseState}`} key={phase.title}>
              <div className="phase-index">
                {phaseState === 'done'
                  ? '✓'
                  : phaseState === 'failed'
                    ? '!'
                    : String(index + 1).padStart(2, '0')}
              </div>
              <p className="phase-state">
                {phaseState === 'done'
                  ? '已完成'
                  : phaseState === 'failed'
                    ? '未完成'
                    : phaseState === 'active'
                      ? '已提交'
                      : '等待'}
                {phase.oma ? ' · OMA' : ' · 应用'}
              </p>
              <h3>{phase.title}</h3>
              <p>{phase.detail}</p>
              <strong className="phase-result">
                {phaseState === 'done' ? phase.result : phaseState === 'active' ? phase.result : '—'}
              </strong>
            </article>
          )
        })}
      </div>

      <div className="processing-assumptions">
        <span>基准日期 {dataset.policy.asOfDate}</span>
        <span>USD → CNY {dataset.policy.fxToCny.USD.toFixed(2)}</span>
        <span>HKD → CNY {dataset.policy.fxToCny.HKD.toFixed(2)}</span>
        <span>模拟增值税 {(dataset.policy.cnyVatRate * 100).toFixed(0)}%</span>
        <span>毛利提醒阈值 {(dataset.policy.minimumGrossMargin * 100).toFixed(0)}%</span>
      </div>

      {failed && (
        <div className="execution-error" role="alert">
          <div>
            <strong>失败原因</strong>
            <p>{state.error}</p>
            <small>没有生成审核稿；没有联系供应商；没有自动降级。</small>
          </div>
          <div>
            <button type="button" className="secondary-button" onClick={onBack}>
              返回输入
            </button>
            <button type="button" className="secondary-button" onClick={onRetry}>
              重试当前路径
            </button>
            {isLive && (
              <button type="button" className="primary-button" onClick={onReplay}>
                明确切换离线回放
              </button>
            )}
          </div>
        </div>
      )}

      {completed && run.runtime && (
        <div className="execution-receipt">
          <div>
            <span>执行类型</span>
            <strong>
              {run.runtime.isLiveModelCall ? '本次真实模型调用' : '本次未调用模型'}
            </strong>
          </div>
          <div>
            <span>Provider / Model</span>
            <strong>{run.runtime.provider} / {run.runtime.model}</strong>
          </div>
          <div>
            <span>执行标识</span>
            <strong>{run.runtime.runId ?? run.runtime.replayId ?? '—'}</strong>
          </div>
          <div>
            <span>角色 / 任务</span>
            <strong>
              {run.runtime.receipt?.rolesExecuted.length ?? 0} / {run.runtime.taskCount}
            </strong>
          </div>
        </div>
      )}

      {completed && (
        <button type="button" className="primary-button processing-continue" onClick={onContinue}>
          打开采购审核稿
          <span aria-hidden="true">→</span>
        </button>
      )}
    </section>
  )
}
