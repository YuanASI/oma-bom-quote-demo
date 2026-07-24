# OMA 框架反馈：BOM 报价 Demo 真实验收

- 验证日期：2026-07-23
- Demo：`oma-bom-quote-demo`
- Demo 实际依赖：`@open-multi-agent/core@1.12.1`

## 结论

这次验收**没有发现 OMA 1.12.1 的调度器或 DeepSeek adapter 存在阻断性运行 bug**。

真实 OMA 主路径连续完成了 provider 预检、完整 E2E、回放捕获和浏览器验收。完整工作流实际执行 6 个 worker、45 条模拟报价，最终应用侧证据校验问题为 0。验收中真正修复的错误都位于 Demo 的提示词、证据归因、业务校验、UI 状态或测试预期，不应提交到 OMA。

但是，这个 Demo 确实暴露了两个通用的框架 API 缺口：

1. `runTasks()` 没有公开按 task id 保存的完整 `AgentRunResult`，同一 agent 执行多项任务时，前面任务的 `structured` 会在公共结果中丢失。
2. 依赖任务接收到的是上游原始 `output` 文本，而不是已经通过 `outputSchema` 的 `structured` 值。

如果 OMA 要支持“结构化抽取 → 多路并行 → 独立复核 → 可审计交付”这类业务流水线，这两项建议在框架中补；它们不是 BOM 行业特有逻辑。

此外，执行凭证能力已经在 OMA 当前 `main` 中实现，但不在 Demo 锁定的 1.12.1 发布包内。这里不需要重复开发，只需要随下一版本发布并在 Demo 中迁移。

## 证据基线

| 对象 | 当前证据 |
|---|---|
| Demo 依赖 | `package-lock.json` 锁定 `@open-multi-agent/core@1.12.1` |
| OMA 1.12.1 tag | `f0d18817cafb3e6c0de1b72eb7ed7ee46976ae84` |
| 本地 OMA `main` | `c12b7439052f2067af599fc640ab948744c84d14` |
| 本次只读检查 HEAD | `ed1fbf64ad79056dcd84985826b631a406d1fc3a` |
| 真实 E2E | 6 个角色、45 条报价、0 个应用证据校验问题 |
| 浏览器真实运行 | `LIVE_OMA_MODEL`，6 个角色，0 个证据校验问题，人工审批和导出成功 |

本文只判断当前本地源码与本次真实运行证据，不把尚未发布的 `main` 能力描述成 npm 已发布能力。

## OMA 已经证明可用的部分

- `runTasks()` 能稳定执行固定 DAG。
- 5 个无依赖任务可以并行，证据复核任务可等待全部前置任务。
- DeepSeek adapter、复杂 Zod `outputSchema` 校验、token 统计、超时和 `AbortSignal` 均实际跑通。
- `TeamRunResult.tasks`、`agentResults`、trace 和 token usage 足够让应用构建基本运行凭证。
- 真实失败不会被 OMA 自动伪装为成功；是否切换离线回放由应用控制。
- 应用可以把模型抽取和确定性业务规则分开，OMA 没有强迫业务判断进入模型。

因此，不建议因为本次 Demo 成功就重构调度器、provider adapter、审批系统或业务规则层。

## 验收中出现的实际问题：都不是 OMA bug

| 编号 | 现象 | 根因 | 归属 | 状态 |
|---|---|---|---|---|
| D-01 | 独立证据复核提出的人工风险，被算成来源校验失败 | Demo 把 advisory finding 与 exact validation 混为一类 | Demo 应用层 | 已修复 |
| D-02 | 模型返回的 JSON 摘录字段正确，但空白和换行与原文件不同 | 模型重新格式化 JSON；OMA 只负责 schema，不负责业务来源回锚 | Demo 证据层 | 已修复 |
| D-03 | `documentWarnings` 重复模拟声明、汇率说明等非缺失问题 | Demo 的提示词和字段语义过宽 | Demo 提示词 / schema | 已修复 |
| D-04 | 回放包从 `FIXTURE_BASELINE` 升级后两条测试失败 | 测试硬编码旧 capture kind | Demo 测试 | 已修复 |
| D-05 | 人工改选后汇总数字和低毛利风险恢复不一致 | React 本地状态派生错误 | Demo UI | 已修复 |

以下逻辑也应继续留在应用层，而不是加入 OMA：

- 料号归一、JSON 原文回锚和报价证据规则；
- 汇率、税费、库存、MOQ、交期、资质、毛利和推荐；
- 替代料工程确认；
- 采购负责人批准、驳回、改选和补询；
- 客户报价、采购审核表和异常清单格式；
- `LIVE_OMA_CAPTURE` 中的业务 fixture 哈希及业务 schema。

OMA 的 `success` 应继续表示运行是否成功，不应改成“业务审核是否通过”。业务校验失败必须由应用单独表示。

## 建议在 OMA 中补的能力

### F-01：按 task id 暴露完整结果

- 建议优先级：P1
- 类型：已确认的公共 API 限制
- 修改位置：OMA Core

当前 `TeamRunResult.agentResults` 按 agent 名返回。`buildTeamRunResult()` 在同一 agent 执行多个任务时会合并文本、消息、token 和工具调用，但 `structured` 只保留最后一个已完成任务的值。

本次用 OMA 1.12.1 做了无网络最小复现：

```json
{
  "success": true,
  "taskCount": 3,
  "agentResultKeys": ["worker", "reviewer"],
  "workerStructured": { "sequence": 2 }
}
```

`worker` 实际完成了两个任务，但公共结果只有一个 worker 条目，第一项 `{ "sequence": 1 }` 无法从最终 `TeamRunResult` 取回。

Demo 当前通过创建 `supplier-reader-01` 到 `supplier-reader-04` 四个近似相同的 agent 绕开了这个限制。这在四家供应商时可接受，但不适合批量文档抽取。

最小建议：

```ts
interface TeamRunResult {
  // 保持现有字段，保证兼容。
  readonly agentResults: Map<string, AgentRunResult>

  // 新增：一个 task 对应一份未合并结果。
  readonly taskResults?: Map<string, AgentRunResult>
}
```

要求：

- key 使用稳定 task id，不使用 title；
- 保留每个任务的 `structured`、错误、usage 和工具调用；
- checkpoint / restore 能重建该字段；
- CLI JSON serializer 可以安全序列化；
- 现有 `agentResults` 行为不变；
- token 不得因同时存在两种索引而重复计数。

### F-02：允许下游消费已验证的 structured 依赖

- 建议优先级：P1
- 类型：已确认的数据流能力缺口
- 修改位置：OMA Core

当前 `buildTaskPrompt()` 从 `Task.result` 读取前置任务结果，而 `Task.result` 来自 `AgentRunResult.output`。即使上游已经通过 `outputSchema`，下游看到的仍是模型原始文本。

最小复现中，上游输出为：

```text
EXTRA-NARRATIVE-1
{"sequence":1}
```

OMA 能正确得到 `{ "sequence": 1 }` 的 `structured`，但下游 reviewer 的 prompt 仍包含 `EXTRA-NARRATIVE-1` 和 `EXTRA-NARRATIVE-2`。这意味着 schema 验证保护了调用方，却没有保护 DAG 内部的数据交接。

对本 Demo 的影响是：证据复核角色理论上应该审核已经验证的 BOM findings 和 supplier quotes，但当前只能依赖上游模型文本。应用因此必须把复核结果降级为 advisory finding，再由确定性来源校验裁决。

建议采用兼容式 opt-in，而不是改变默认行为：

```ts
interface RunTaskSpec {
  readonly dependencyPayload?: 'output' | 'structured' | 'both'
}
```

- 默认仍为 `output`，保持 1.x 兼容；
- `structured` 只传递成功通过 schema 的值，使用确定性 JSON 序列化；
- 某个依赖没有 structured 值时应明确失败或返回机器可判定状态，不能静默改用原始文本；
- `both` 必须用清晰分隔和来源标签；
- 加入大小限制、redaction、checkpoint 和 token 预算测试。

1.12.1 的临时应用侧 workaround 是在 `afterRun` 中把 `output` 替换为 `JSON.stringify(result.structured)`。这会牺牲原始可读输出，并要求每个 agent 重复配置，因此不应作为长期公共模式。

### F-03：保留 task role 和业务可追溯 metadata

- 建议优先级：P2
- 类型：已确认的可观测性缺口
- 修改位置：OMA Core

`RunTaskSpec` 接受 `role`，但 `TaskExecutionRecord` 没有保留该字段；执行凭证目前主要按 `assignee` 统计。

这个 Demo 中：

- worker instance 是 6 个；
- 并行根任务是 5 个；
- 逻辑业务 role 实际是 3 类：BOM 分析、供应商抽取、证据复核；
- 四个 `supplier-reader-*` 是同一逻辑 role 的四个实例。

如果只显示 `rolesExecuted=6`，会把 worker instance 和业务 role 混在一起。Demo 目前知道自己的静态配置，所以能自行解释；动态任务场景则不够稳。

最小建议：

- `TaskExecutionRecord` 保留 `role`；
- `RunTaskSpec` 增加受限、可校验的 task metadata，供应用记录 `sourceFile`、`supplierId`、`documentId` 等引用；
- metadata 进入 trace / checkpoint 前继续经过长度、类型和脱敏边界；
- 执行凭证保持现有 `rolesExecuted` 兼容，同时考虑新增 `taskRolesExecuted` 或 `workerInstancesExecuted`，不要静默改变旧字段语义。

这项能力能够让应用直接证明“哪一个 worker 处理了哪一份模拟供应商回复”，而不用把来源编码进 task title 或依赖数组顺序。

## 已经在 OMA main 解决、只需发布和迁移的能力

### F-04：第一方 execution receipt

- 建议优先级：下一次发布与 Demo 升级时处理
- 类型：1.12.1 发布差距，不是当前 main 缺失

Demo 的 `server/oma-runner.ts` 自行实现了 `receiptSummary()`，从 `TeamRunResult` 和 trace 推导：

- worker；
- 执行顺序；
- 依赖边；
- 独立复核；
- token；
- duration；
- partial 状态。

OMA 当前本地 `main` 已包含 `buildExecutionReceipt(result, trace?)`，对应提交 `7dcde7d`。因此不要再写第二套框架实现。

建议动作：

1. 确认该能力进入下一个 npm release；
2. Demo 升级依赖后删除自建拓扑推导代码；
3. 保留 Demo 自己的业务来源、审核和捕获字段；
4. 迁移时逐字段核对语义。

迁移注意：Demo 当前把“5 个无依赖前置 worker”记为 `independentRolesCount=5`；框架 receipt 的该字段按所有 distinct assignee 计数，会得到 6。不能直接替换后继续沿用旧文案。

## 暂时不建议立即补的能力

### F-05：完整运行结果的便携式离线回放包

当前状态：有需求信号，但只有一个 Demo 证据。

OMA 的 `PlanArtifact` 固定 DAG 后重新执行模型；checkpoint 面向中断恢复；TraceStore 面向可观测性。它们都不是“无需模型即可恢复应用 structured outputs”的稳定业务回放包。

本 Demo 因此自建了 `LIVE_OMA_CAPTURE`。这不是错误：哪些业务结果可回放、哪些输入要做哈希、哪些字段可持久化，本来就需要应用决定。

建议先完成 F-01/F-02。若第二个真实应用也需要同类能力，再考虑在 Core 提供不含业务字段的 `RunArtifact` 基础 envelope。不要让 Core 自动持久化敏感 structured outputs。

### F-06：provider/model preflight

当前状态：通用但不阻断。

OMA CLI 当前提供 provider 列表和模板，没有一个标准的“用当前 Key / model 做最小结构化输出检查”的命令。Demo 自建了 `npm run preflight:oma`，用于演示前确认认证、模型名和结构化输出能力。

如果多个示例都在重复这段逻辑，可考虑：

```text
oma provider check --provider deepseek --model ...
```

输出只能包含 provider、model、capability、耗时、token 和脱敏错误，绝不能回显 Key。当前一个 Demo 不足以把它定为 P1。

### F-07：同一 role 的 worker replicas

当前状态：有明显样板代码，但属于有意的并发语义。

`AgentPool.run()` 对同名 agent 使用 per-agent lock，因此同一 agent 的多项任务会串行。Demo 为四份供应商回复创建四个 reader agent，才能并行执行。

这不是 bug：一个 agent 可能代表有状态的身份或会话，默认串行是安全行为。如果未来大量文档抽取应用都需要同一无状态 role 横向扩容，再考虑显式 `replicas` / ephemeral worker 模式；不要默认允许同一 agent 并发。

## 推荐实施顺序

1. **不改调度器和 DeepSeek adapter。**
2. 将当前 `main` 的 execution receipt 随下一版本发布，并让 Demo 升级后删除自建 receipt 推导。
3. 设计一个小型、向后兼容的 Core 变更，同时解决：
   - `taskResults` 按 task id 保留完整结果；
   - 下游可 opt-in 消费 `structured` dependency。
4. 再补 `TaskExecutionRecord.role` 和受限 task metadata。
5. 便携回放、provider preflight、worker replicas 等到第二个应用出现同样需求再立项。

## 建议验收用例

框架变更至少应覆盖：

1. 同一 agent 连续执行两个任务，`taskResults` 保留两份不同 structured 值。
2. 现有 `agentResults` 合并行为不变。
3. `dependencyPayload='structured'` 时，下游不包含上游额外叙述文本。
4. structured 缺失时明确失败，不静默退回 output。
5. 两个无依赖任务仍按现有并发规则执行；同一 agent 的锁语义不变。
6. checkpoint / restore 后 task-scoped results 可恢复。
7. CLI JSON、Run Viewer 和 trace 不重复计算 token。
8. task role / metadata 在 result、trace 和 checkpoint 中一致，并经过脱敏和大小限制。
9. Node 18 / 20 / 22 的现有兼容矩阵保持通过。

## 最终判断

- **需要修 OMA 的现有 runtime bug 吗？** 目前没有证据。
- **需要在 OMA 中补 feature 吗？** 建议补 F-01、F-02；F-03 次之。
- **execution receipt 需要重新开发吗？** 不需要，当前 `main` 已有，只待发布和迁移。
- **Demo 已修问题要反向塞进 OMA 吗？** 不要；它们属于业务证据、提示词、UI 和测试边界。
- **要现在做回放平台、provider doctor 或 worker replicas 吗？** 暂不建议，仅记录为后续重复需求触发项。
