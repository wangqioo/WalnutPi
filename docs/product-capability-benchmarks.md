# WalnutPi 产品能力基准测试

这份基准按用户目标场景组织，不按底层工具是否能跑组织。工具、CLI、模型、脚本和远程命令只是实现手段；通过标准必须落在 Walnut Agent Console 能否把用户目标推进到可预览、可同步、可诊断、可真机验证的产品结果上。

## 现有产品功能梳理

### Walnut Agent Console

Walnut Agent Console 是当前 Web 入口和自然语言产品边界。用户不需要先理解导入、处理、播放列表、同步和证据链；Console 负责理解输入、选择 Intent Route、调用受控能力、展示结果和下一步。

当前关键责任：

- 接收用户目标和上下文。
- 调用 `/api/intent/classify` 得到 Intent Route。
- 将用户带入 Screen Workspace、Device Action、WalnutAI、记忆/笔记或普通问答。
- 保持“预览”和“真机同步”的边界。
- 将哈希、命令输出、原始证据放进 Developer Diagnostics，而不是普通用户主流程。

### Intent Route

Intent Route 是自然语言到产品链路的入口，不是执行许可。Intent Route v2 的产品路由包括 `ai.chat`、`screen.wallpaper`、`screen.widget_app`、`device.action`、`memory.notes`、`terminal.surface`。

当前风险点：

- 规则路由会把 `联网`、`网络` 一类词汇过早解释成 `device.network.read`。
- 多目标输入缺少任务分解时，一个高置信规则会吞掉 Screen Workspace 目标。
- `delivery: none` / “先预览，不要同步”应该限制交付动作，不应该抑制生成、导入或预览。

### Screen Workspace

Screen Workspace 是 `screen/` 下的当前小屏工作区，拥有 Source Assets、Screen Outputs、Screen Manifest v2、Screen Playlist v1、Runtime Screen Assets 和相关 provenance。

产品边界：

- Wallpaper Mode：图片、GIF、视频、生成视觉、动画壁纸、播放列表和同步。
- Widget App Mode：小屏可交互应用、状态绑定、按钮/开关、受控动作和输入事件。
- 两种模式可以显式互通，但不能混用一个 schema。

### Source Asset

Source Asset 是生成 Screen Output 的原始素材，可以来自用户导入、生成图、GIF、视频、搜索候选、程序化视觉或本地文件。外部搜索结果先是 Candidate Source Asset，只有用户选择或产品链明确选择后才成为 Source Asset。

Source Asset 基准关注：

- 是否记录来源、URL、搜索词、许可/未知许可说明和本地哈希。
- 是否进入 Screen Workspace，而不是只作为聊天答案返回。
- 是否经过处理管线生成 480x320 Screen Output。

### Screen Manifest v2 / Playlist v1

Screen Manifest v2 描述一个最终 480x320 Screen Output 或 Animated Screen Output，以及 processing provenance。Screen Playlist v1 负责排列多个 manifest 的播放顺序、时长、循环和切换。

通过标准不能只看文件存在，还要看：

- manifest 引用的输出真实存在。
- 输出像素哈希稳定。
- playlist 只引用已经规范化的 manifest。
- 预览、runtime、sync 都使用同一组本地输出，而不是重新搜索或重新生成。

### Runtime preview/assets

Runtime Screen Assets 是 LVGL Screen App 消费的热加载资产，主要包括 `screen/runtime/default.txt` 和 RGB565 frame files。Preview 是本地创意和安全检查，不是真机证据。

需要区分：

- Preview：本地可看、可回放、可检查视觉质量。
- Runtime assets：已经转成设备运行格式。
- Real-Device Verification：设备服务、frame/capture 证据证明真机正在显示。

### Sync / real-device evidence

Sync 是显式操作。预览请求不得 SSH、构建、投递、重启服务或抓取设备证据。同步请求必须使用当前 playlist hash，并收集投递、激活、服务状态、frame/capture 等证据。

用户态状态只需要：

- 未同步
- 同步中
- 已同步到核桃派
- 同步失败

Developer Diagnostics 才展示 hash、buildId、命令输出、投递 manifest、原始设备证据、frame URL 和图像字节。

### WalnutAI / CLI action surface

`walnut` CLI 是 Device Execution Surface。Human CLI Command 和 Agent Action Command 分开：前者给人用，后者给 Console/WalnutAI 调用，并受 Action Policy Manifest 约束。

基准测试应验证：

- 设备状态类只读动作可以直接运行。
- 写系统、重启、服务替换、同步等动作需要明确确认或显式用户意图。
- Agent Action 输出有机器可读证据。
- CLI 能力不应抢走 Screen Workspace 用户目标。

### Harness / loop / event evidence

当前项目已有 session ledger、screen evidence ledger、metrics 和 screen sync workflow。缺口是一个统一的 turn/run/step artifact，把一次用户目标里的分类、生成、动作、同步、失败和证据串起来。

基准测试先要求“证据链可解释”，不要求先实现完整 harness 框架：

- 记录用户输入。
- 记录 Intent Route。
- 记录执行步骤。
- 记录禁止执行的动作。
- 记录产物和证据指针。
- 失败时给出恢复入口。

## 基准格式

每个 benchmark 必须包含：

- 用户输入：真实 Console prompt。
- 期望产品结果：用户能看到或继续操作的结果。
- 允许动作：本场景可以调用的产品能力。
- 禁止动作：即使命中关键词也不能做的事。
- 证据：需要留下的 artifact、状态或日志。
- 通过标准：可人工或自动判定的结果。

## Benchmarks

### B01 生成动态壁纸预览

用户输入：

```text
生成一个动态动画类型小 app，主题是唯美星空，先预览，不要同步到真机
```

期望产品结果：

- 路由进入 `screen.wallpaper` 或明确询问“壁纸播放 / 可交互小应用”。
- 生成 480x320 动态 Screen Output。
- 创建或更新 Screen Manifest v2 和 Screen Playlist v1。
- Console 或 Screen Workspace 显示预览。
- 不同步到真机。

允许动作：

- 使用 AI 生成 Screen Plan。
- 使用本地处理管线生成帧序列。
- 生成 preview/runtime 本地资产。
- 写入 Screen Workspace 本地文件。

禁止动作：

- 执行 `screen sync`。
- SSH 到设备投递文件。
- 重启 `walnut-screen.service`。
- 把请求降级成设备网络状态读取。

证据：

- Intent Route。
- Screen Plan 或 processing provenance。
- manifest path 和 playlist hash。
- preview frame 或 runtime frame paths。
- 明确的 `delivery: none` / preview-only 记录。

通过标准：

- 预览能看到和“唯美星空”相关的动态视觉。
- playlist 引用的 manifest 和输出文件存在。
- 没有产生 sync record。
- 没有设备写入、服务重启或 frame/capture 证据。

### B02 外部 GIF 作为动态壁纸素材

用户输入：

```text
联网找一个唯美 gif，用它做核桃派动态壁纸，先预览，不要同步到真机
```

期望产品结果：

- `联网` 被解释为 Source Asset acquisition，不是设备网络检查。
- 返回候选 GIF 或直接选定一个可用候选。
- 候选进入 Screen Workspace Source Asset 流程。
- 生成 GIF-based Animated Screen Output 和预览。

允许动作：

- 联网搜索候选素材。
- 下载用户选择或产品明确选定的候选素材。
- 记录 URL、搜索词、许可未知说明和 source hash。
- 抽帧、裁剪、缩放、限制帧率和时长。

禁止动作：

- 返回 WalnutPi 网络状态作为主要结果。
- 把外部链接当作已同步结果。
- 未经明确同步意图投递到真机。
- 将未知许可素材标记为商业可用。

证据：

- Candidate Source Asset 列表或选中 Source Asset。
- source URL、license note、local hash。
- processing provenance。
- Animated Screen Output frame hashes。
- preview-only 交付状态。

通过标准：

- Console 的主结果是动态壁纸预览，不是网络诊断。
- 生成结果视觉上来自外部 GIF 或清楚说明候选无法使用。
- Screen Workspace 中可追溯素材来源。
- 无真机 sync side effect。

### B03 导入本地素材生成预览

用户输入：

```text
把这个本地图片做成核桃派壁纸，裁成 480x320，先让我预览
```

期望产品结果：

- 本地文件成为 Source Asset。
- 处理为 480x320 Screen Output。
- 创建 Screen Manifest v2。
- 展示预览并等待用户决定是否加入 playlist 或同步。

允许动作：

- 读取用户提供的本地文件。
- 解码、裁剪、缩放、像素化或保守适配。
- 写入 Screen Workspace 输出。

禁止动作：

- 自动同步到设备。
- 丢弃 source provenance。
- 只回答“可以导入”而不产生预览。

证据：

- source file path 和 hash。
- crop/fit 参数。
- output file hash 和 pixel hash。
- manifest path。

通过标准：

- 预览尺寸为 480x320。
- manifest 引用正确输出。
- 用户能继续选择加入 playlist 或 sync。

### B04 预览已有 Playlist

用户输入：

```text
预览当前小屏播放列表，不要同步
```

期望产品结果：

- 读取当前 Screen Playlist v1。
- 校验每个 manifest 和输出文件。
- 本地播放或展示 playlist 预览。
- 报告缺失项或 hash mismatch。

允许动作：

- 读取 playlist、manifest 和本地输出。
- 生成本地预览。
- 展示 Developer Diagnostics 中的校验结果。

禁止动作：

- 修改 playlist。
- 重新生成缺失输出来掩盖问题。
- 同步或访问真机。

证据：

- playlist hash。
- manifest 校验摘要。
- preview frame evidence。
- 缺失或 mismatch 列表。

通过标准：

- 当前 playlist 可预览，或失败原因精确到文件/哈希。
- 无设备访问。

### B05 显式同步到真机

用户输入：

```text
把当前小屏播放列表同步到核桃派，并验证真机显示
```

期望产品结果：

- 使用当前 playlist hash 发起 Sync。
- 投递 runtime playlist 和 RGB565 frames。
- 必要时构建或重启 LVGL runtime。
- 收集服务状态、`walnut screen state`、frame/capture 证据。
- 用户看到“已同步到核桃派”或“同步失败”。

允许动作：

- 校验本地 playlist。
- SSH/Device Transport 投递 runtime assets。
- 按同步合约激活 runtime。
- 采集真实设备证据。

禁止动作：

- 同步前重新联网找素材。
- 同步时静默改 playlist。
- 用本地 preview 冒充真机验证。

证据：

- sync request playlistHash。
- delivery manifest。
- service state。
- screen state。
- frame evidence 或 capture evidence。
- persisted sync record。

通过标准：

- sync record 证明真机 runtime 与目标 playlist/hash 对齐。
- Beginner Sync Status 为 `已同步到核桃派`。
- 失败时保留足够 Developer Diagnostics。

### B06 读取设备状态

用户输入：

```text
只读检查核桃派设备状态和网络状态
```

期望产品结果：

- 路由到 `device.action` read。
- 通过 Agent Action Command 或 `walnut` CLI 读取状态。
- 返回设备状态、网络信息和机器可读证据。

允许动作：

- 执行只读 Device Action。
- 读取网络、服务、磁盘、内存、screen state。

禁止动作：

- 写系统状态。
- 重启服务。
- 把状态读取当成 Screen Workspace 生成任务。

证据：

- Intent Route。
- actionPolicyId。
- command/action result JSON。
- session event 或 action metric。

通过标准：

- 返回结果来自 WalnutPi Device。
- 无写动作。
- 输出可被 Console 总结并可在 diagnostics 中追溯。

### B07 失败恢复：素材不可用

用户输入：

```text
找一个唯美 gif 做动态壁纸，先预览
```

失败条件：

- 搜索无结果。
- 下载失败。
- GIF 解码失败。
- 帧预算超限。

期望产品结果：

- 失败停在 Source Asset 或 processing 阶段。
- Console 说明失败原因。
- 提供可执行恢复选项：换候选、上传本地素材、降低帧率/时长、改用生成素材。

允许动作：

- 记录失败候选和错误。
- 保留部分处理证据。
- 让用户选择下一步。

禁止动作：

- 静默改成设备网络检查。
- 自动同步旧 playlist。
- 生成不相关模板冒充成功。

证据：

- failed stage。
- source candidate 或 local temp path。
- tool error summary。
- recovery options。

通过标准：

- 用户能理解卡在哪一步。
- 没有设备 side effect。
- 下一步选择明确且不会丢失上下文。

### B08 失败恢复：Sync hash mismatch

用户输入：

```text
同步当前播放列表到核桃派
```

失败条件：

- Browser 提交的 playlistHash 与服务器当前 hash 不一致。
- manifest 引用输出不存在。
- runtime frame 生成失败。

期望产品结果：

- Sync 失败，不投递不完整 runtime。
- Beginner Sync Status 为 `同步失败`。
- Developer Diagnostics 展示 hash mismatch 或缺失文件。
- Console 提供“刷新当前 playlist / 重新生成 runtime assets / 重新预览后再同步”等恢复入口。

允许动作：

- 读取和校验本地 playlist。
- 生成结构化失败记录。

禁止动作：

- 忽略 hash mismatch 继续投递。
- 自动重新生成并同步。
- 用旧的 sync record 显示成功。

证据：

- requested playlistHash。
- actual playlistHash。
- validation failure。
- sync failure record。

通过标准：

- 无真机投递 side effect。
- 失败原因可定位。
- 用户能安全重试。

### B09 Widget App 状态面板

用户输入：

```text
做一个核桃派设备状态快捷面板，可以刷新状态，重启屏幕服务前先问我
```

期望产品结果：

- 路由到 `screen.widget_app`。
- 生成 Widget App Plan / A2UI Surface / Walnut LVGL Widget Catalog。
- 包含状态绑定和受 Action Policy 约束的动作。
- 预览或准备显式 Widget App Sync。

允许动作：

- 读取设备状态作为绑定样例。
- 创建本地 widget app contract。
- 将 `refresh_device_status` 标为只读动作。
- 将 `restart_walnut_screen_service` 标为确认动作。

禁止动作：

- 直接重启服务。
- 把 Widget App 保存成 Screen Manifest v2 当作长期交互 schema。
- 允许 arbitrary shell、arbitrary HTTP 或 arbitrary JS binding。

证据：

- Intent Route。
- widget app contract path/version。
- action policy decisions。
- preview or sync readiness state。

通过标准：

- 面板结构和动作风险可检查。
- 高风险动作进入确认流。
- Wallpaper Mode schema 没有被误用为 Widget App contract。

### B10 多目标 Console 输入分解

用户输入：

```text
测试：请测试 CLI、外部知识和联网能力。1、生成一个动态动画类型小 app；2、联网找一个唯美 gif。先预览，不要同步到真机。
```

期望产品结果：

- Console 将输入理解为一个 Screen Workspace 产品目标，必要时分解子任务。
- `联网找 gif` 归入 Source Asset acquisition。
- `动态动画类型小 app` 进入 Wallpaper Mode 或澄清 Widget App/Wallpaper。
- `先预览，不要同步` 约束所有子任务。

允许动作：

- 任务分解。
- 外部素材候选获取。
- 屏幕生成和预览。
- 只读 CLI 能力检查仅在用户明确要求独立检查时运行。

禁止动作：

- 单独路由为 `device.network.read` 并结束。
- 返回 CLI/network status 当作整体成功。
- 同步或访问真机。

证据：

- decomposition / selected route。
- suppressed device-network interpretation reason。
- Source Asset 或 candidate evidence。
- preview artifact。
- no-sync record。

通过标准：

- 主要结果是动态壁纸/小屏预览。
- 如果需要澄清，问题围绕 Wallpaper vs Widget App 或素材选择，而不是网络状态。
- 无真机 side effect。

## 自动化建议

先不要写大 harness。最小可行检查是一个表驱动 benchmark runner，读取这些场景，调用现有 HTTP API，并断言 route、side effect 和产物证据。

第一批自动断言只需要覆盖：

- route 不是被禁止路由。
- preview-only 场景没有 sync record、SSH delivery、service restart、frame/capture evidence。
- sync 场景必须有 persisted sync record 和 real-device evidence。
- Screen Workspace 场景必须有 manifest/playlist/output 或明确的失败恢复证据。
- `联网` 在 Screen Workspace 上下文中不能直接等价于设备网络检查。

等统一 `agentTurn.v1` artifact 落地后，再把这些 benchmark 升级成 turn/step/evidence 级别的自动验收。
