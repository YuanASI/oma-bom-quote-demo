import type { DemoPath, ReviewRun, RuntimeStatus } from '../domain/types'

interface BoundaryStripProps {
  selectedPath: DemoPath
  runtimeStatus?: RuntimeStatus
  completedRun?: ReviewRun
}

function pathLabel(
  selectedPath: DemoPath,
  runtimeStatus: RuntimeStatus | undefined,
  completedRun: ReviewRun | undefined,
): string {
  if (completedRun?.mode === 'LIVE_OMA_MODEL') {
    return '本批次：真实 OMA + 模型 API'
  }
  if (completedRun?.mode === 'OFFLINE_REPLAY') {
    return '本批次：明确标注的离线回放'
  }
  if (selectedPath === 'replay') return '计划路径：离线回放'
  return runtimeStatus?.liveAvailable
    ? '计划路径：真实 OMA + 模型 API'
    : '实时路径待配置 API Key'
}

export function BoundaryStrip({
  selectedPath,
  runtimeStatus,
  completedRun,
}: BoundaryStripProps) {
  return (
    <div className="boundary-strip" role="note">
      <strong>模拟数据演示</strong>
      <span>{pathLabel(selectedPath, runtimeStatus, completedRun)}</span>
      <span>非客户案例</span>
      <span>不构成报价或采购建议</span>
      <span>请勿上传真实业务资料</span>
    </div>
  )
}
