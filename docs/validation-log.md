# 验证记录

验证日期：2026-07-23（Asia/Taipei）

## 本机环境

- Node.js `v22.23.1`
- npm `10.9.8`

## 完整验证

执行：

```bash
npm run verify
```

结果：

- Oxlint：通过，无 warning；
- TypeScript：`tsc -b --pretty false` 通过；
- Vitest：5 个测试文件、28 项测试全部通过；
- OMA 无网络结构测试：fixture adapters 真实经过 `runTasks()`，执行 6 个角色并产出 45 条可追溯报价；
- 运行边界：18 个浏览器文件仅允许同源 `/api`；10 个服务端文件无额外外联 SDK；6 个 fixture 全部明确标记为模拟数据；
- Vite production build：通过；
- 构建产物：HTML 0.71 kB（gzip 0.50 kB）、CSS 32.25 kB（gzip 7.40 kB）、JS 263.48 kB（gzip 82.65 kB）。

## 干净环境验证

将项目复制到不含 `node_modules`、`dist`、`.git`、`.env` 和运行时状态的新临时目录后执行：

```bash
npm ci --cache .npm-cache
npm run verify
OMA_PORT=5174 npm start
curl -sS -o /private/tmp/oma-bom-clean-index.html -w '%{http_code}\n' http://127.0.0.1:5174/
curl -sS http://127.0.0.1:5174/api/runtime
```

结果：

- 安装 179 个包、审计 180 个包，0 个已知漏洞；
- 完整 `verify` 再次通过：5 个测试文件、28 项测试；
- production server 在 `127.0.0.1:5174` 启动；
- `GET /` 返回 200，页面标题为 `电子料 BOM 报价审核台｜模拟数据 Demo`；
- `/api/runtime` 返回 `service=ready`、`liveAvailable=false`、`model=deepseek-v4-flash`，并显示 `LIVE_OMA_CAPTURE` 可用；没有 Key 时不会把历史捕获标成当前实时调用。

补充：直接使用用户全局 npm cache 的首次 `npm ci` 被本机已有的 root-owned cache 文件阻塞。没有改动全局 cache 权限；README 改用项目内 `.npm-cache`，干净环境按该命令安装成功。

## 真实 DeepSeek / OMA 验收

密钥仅通过当前进程环境变量注入；项目内未创建 `.env`，命令输出和回放包均不含密钥。

执行：

```bash
npm run preflight:oma
npm run test:e2e:oma
npm run capture:replay
```

结果：

- provider 预检通过：`deepseek / deepseek-v4-flash`，run id `bom-preflight-1784815405371`，160 tokens；
- 完整 E2E 通过：run id `bom-live-95524dbd-ddd0-4178-8f45-c0e054dd9381`，6 个角色、45 条报价、0 个证据校验问题；
- E2E 业务结果：16 个已匹配、6 个待确认、2 个无报价；耗时 25,824 ms，35,688 tokens；
- 回放捕获通过：`captureKind=LIVE_OMA_CAPTURE`，run id `bom-live-adf96267-f2fd-483c-b451-a6c05d1c982f`，45 条报价、6 个实际角色、5 个输入文件哈希；
- 实时失败不会自动切换离线结果；捕获脚本在报价不是 45 条或存在证据校验问题时拒绝写入。

真实模型验收中发现并修复了两类问题：

1. 独立复核角色提出的人工风险建议曾被误计为来源校验失败；现已与精确证据验证分层记录。
2. 模型可能重排 JSON 空白；现仅在 `mpn + unitPrice` 唯一匹配时回锚到源文件中的完整连续 JSON 对象，CSV 和邮件仍要求模型摘录逐字命中。

新增回归测试覆盖复核建议分层、JSON 唯一回锚和文档级提示边界。

## 浏览器验收

使用 production server 与 Playwright，视口 1200 × 864：

1. 无 Key 时首页明确显示 `LIVE BLOCKED`，实时按钮不可用，不自动降级；手动离线路径明确显示 `OFFLINE REPLAY`；
2. 有 Key 时首页显示 `LIVE READY`，并识别 bundled 包为真实 OMA 捕获；
3. 点击真实主路径后实际完成 6 个角色，run id `bom-live-c5e79075-a047-4292-9f87-5cb6b4d172fb`；
4. 页面显示 `LIVE RESULT`、`deepseek / deepseek-v4-flash`、6 个实际角色、0 个证据校验问题；
5. 得到 91.7% 覆盖率、16 个已匹配、6 个待确认、2 个无报价；
6. 打开 `TPS62160DSGR` 来源证据，核对 JSON 第 27–39 行的连续原始对象、HKD 汇率、MOQ、库存、交期、Date Code、Broker 与待核资质；
7. 人工标记 1 项补充询价，填写审批备注并批准，批次状态更新为“负责人已批准”；
8. 进入四类导出，实际下载并抽查 `01-客户报价草稿-模拟.csv` 与 `04-审计记录-模拟.json`；
9. 客户草稿首行明确写有“模拟数据 / 客户报价草稿 / 非正式报价 / 不构成交易承诺”，处理来源为本次真实 OMA + 模型 API；
10. 审计 JSON 记录 `LIVE_OMA_MODEL`、run id、6 个角色、token、0 个校验问题、补询动作和人工批准；
11. 浏览器控制台 0 error、0 warning；
12. 最终审核页截图保存为 `docs/assets/final-review.png`。

浏览器走查发现并修复了一个问题：人工改选后恢复原推荐时，关键风险列曾丢失低毛利提示，且批次 16 / 6 汇总不随改选更新。现已增加两项回归测试并在 production 浏览器复验。

## Key 缺失时的预检与重置

执行：

```bash
npm run preflight:oma
npm run reset
```

结果：

- `preflight:oma` 以退出码 1 明确停止：`缺少 DEEPSEEK_API_KEY；未执行真实模型预检。` 没有发生 provider 调用；
- `reset` 退出码 0，说明刷新或页面重置会清空人工改选、补询标记与审批记录，不删除 `.env`，不改写回放包。

## 范围外与未执行

- 真实 ERP、报价库、邮箱或供应商系统连接：不在本 Demo 范围；
- 公网部署、邮件、消息、表单、询价、采购或下单：均未发生。
