# WalnutPi 产品能力闭环地图

这份文档把当前 WalnutPi 产品能力映射到产品闭环和 benchmark 义务。它故意不按 `runnerStatus` 组织。`runnerStatus` 只说明 harness 今天能不能执行某个 case，不说明这个 benchmark 是否是高质量产品测试。

## 质量规则

高质量 benchmark 必须证明一条产品闭环：

```text
用户工作流
-> Walnut Agent Console
-> POST /api/agent/turn
-> Intent Route
-> 受控 action / tool / workspace step
-> 用户可见结果
-> trace / artifact / evidence
-> pass/fail oracle
-> 修复或下一轮迭代入口
```

只证明 route、只证明某个 API 返回 JSON、或者只证明某个 trace kind 非空，都是局部覆盖。它们可以作为回归保护，但不能算强产品覆盖。

## 能力闭环表

| 产品闭环 | 用户工作流 | 产品入口 | Route / intent | 受控工作 | 必要证明 | Benchmark 角色 | 当前缺口 |
|---|---|---|---|---|---|---|---|
| Screen preview loop | 用户要求从天气、图片、GIF、视频或生成视觉做 480x320 小屏预览。 | `/api/agent/turn` | `screen.wallpaper` / `screen.generate` | Screen Workspace 处理、manifest、playlist、preview。 | Screen Output 是 480x320；Manifest v2 存在；Playlist v1 引用规范化输出；preview-only 没有设备 side effect。 | V1-01, V1-02, V1-03, V1-05, V1-07, V1-10, V1-24, V1-26。 | 太多 case 还只验证期望合同，没真正验证 Source Asset 获取、视觉结果质量和失败恢复。 |
| Playlist sync loop | 用户明确把当前预览或 playlist 同步到 WalnutPi 真机。 | `/api/agent/turn` 加显式 sync 实现 | `screen.wallpaper` / sync intent | Playlist hash 校验、runtime asset 生成、投递、激活。 | Sync Record、delivery manifest、service state、frame evidence、hash mismatch 后不重新生成继续投递。 | V1-06, V1-08。 | 需要 device baseline 和 hash-mismatch 可执行覆盖；offline 不能证明真机显示正确。 |
| Device read loop | 用户要求只读检查设备状态、I2C、GPIO、小屏状态或 frame。 | `/api/agent/turn` | `device.action` read intents | Action Policy read actions 和 Device Execution Surface。 | action id、只读输出或 honest failure、没有 System Write、没有 GPIO output、没有 reboot。 | V1-04, V1-23, V1-25, V1-27, V1-29。 | offline honest failure 只证明安全，不证明真实传感器/屏幕状态；device profile 必须证明真实 evidence。 |
| Policy boundary loop | 用户要求系统写入、重启、服务重启、清理或维护。 | `/api/agent/turn` | `device.action` high-risk 或 policy route | Action Policy Manifest、refusal、pending confirmation、manual guidance。 | refused 或 pending decision、确认前没有 command execution、风险说明。 | V1-17, V1-18, V1-20。 | oracle 应验证 decision shape 和没有 remote execution，不能只看文本拒绝。 |
| Memory and notes loop | 用户要求写/读 Daily Notes、记住偏好、或避免保存敏感临时值。 | `/api/agent/turn` | `memory.notes`、memory route 或 device note action | Daily Notes action、Durable Memory candidate/skip、session ledger。 | notes 保留用户原文；memory candidate 有 source/category；敏感 skip 明确；没有误触 device/screen side effect。 | V1-11, V1-12, V1-13, V1-14, V1-21, V1-28。 | 需要更强的实际 note/memory 持久化 artifact 检查；Daily Note write 在有真实写入证据前应保持 device/profile gated。 |
| Diagnostics and repair loop | 用户问刚才 action 或 sync 为什么失败。 | `/api/agent/turn` | diagnostics read intent | metrics ledger、session ledger、Sync Records、repair options。 | trace/build id、failed operation、stage/segments、error summary、安全 repair options、没有自动 retry。 | V1-22。 | 需要 seeded failure fixtures 和更强的 recovery assertions。 |
| WalnutAI delegation loop | 用户要求结合设备健康和项目上下文回答，应该委托 WalnutAI。 | `/api/agent/turn` | `device.action` / `ai` 或 assistant route | `walnut-ai` action、retrieval、memory、本地只读上下文。 | delegation evidence、contextUsed、output failed 分类、用户可见 summary。 | V1-16。 | 需要 Web `agentTurn.v2` 和 CLI `WALNUT_AGENT_TURN_TRACE` 对齐。 |
| Retrieval guidance loop | 用户要求项目/硬件建议，且不改变设备。 | `/api/agent/turn` | `ai.chat` 或 guidance route | Retrieval Corpus、可选只读 action 建议。 | retrieval source/contextUsed、skipped write actions、建议和执行权限清晰分离。 | V1-15。 | 需要 source-level assertion；retrieval 不能授予执行权限。 |
| Widget App loop | 用户要求交互式状态面板或小屏 app。 | 产品流走 `/api/agent/turn`；当前支持面是 `/api/screen/widget-apps/*` | `screen.widget_app` | Widget App workspace、LVGL widget contract、status bindings、action policy decisions、显式 widget sync。 | widget contract、action binding risk、refresh read action、confirmable restart action。 | V1-09。 | 产品合同还不成熟。不要删除已调通 sync path；先分类并补 benchmark evidence，再决定产品化或归档。 |
| Terminal surface loop | 用户要求终端可玩的媒体或 interactive terminal demo。 | `/api/agent/turn` | `terminal.surface` | terminal action 或 Human CLI guidance。 | terminal-action evidence；除非显式经过 Screen Workspace 转换，否则不能算 Screen Manifest success；没有 maintenance side effect。 | V1-19, V1-24。 | 需要更清楚地区分 terminal playable result 和 Screen Workspace Source Asset。 |

## Benchmark 质量等级

讨论 benchmark 质量时使用这些等级，不要把它们等同于 `runnerStatus`。

| 等级 | 含义 | 可接受用途 |
|---|---|---|
| L0: Contract sketch | 描述期望行为，但不能执行或验证闭环。 | 只用于规划，不算产品覆盖。 |
| L1: Route check | 验证 `/api/agent/turn` 选择了正确的大类 route。 | 可防 router 回归，产品信号弱。 |
| L2: Trace check | 验证必要 trace/evidence kind 和 forbidden side effects。 | agent loop 回归的最低门槛。 |
| L3: Semantic evidence check | 验证 evidence 字段语义正确，而不是只看非空。 | read-only 和 policy flow 的良好 offline gate。 |
| L4: Artifact/user-result check | 验证真实用户可见 artifact 或 summary 正确、可用。 | Screen preview、memory、notes、diagnostics、retrieval 必须达到。 |
| L5: Real-device loop check | 验证投递、激活、service state、frame/capture evidence 或设备侧持久化结果。 | 声称真机产品成熟前必须达到。 |

## 当前评估

当前 benchmark 质量不均匀：

- Screen preview 大约是 L2-L3：能看 trace 和安全边界；但在直接验证 Source Asset 获取、视觉输出和恢复路径前，还不是 L4。
- Playlist sync 在 offline 下只是 L2；必须在 device profile 达到 L5，才支撑真机产品声明。
- Device read 在 offline honest failure 下可到 L3；只有 device profile 证明真实 state/frame evidence 时才是 L5。
- Policy boundary 如果 matcher 检查 decision fields、pending state 和 no command execution，可以到 L3。
- Memory/notes 目前是 L2-L3；需要实际持久化 artifact 检查才能到 L4。
- Diagnostics 在 seeded failure 能稳定证明 repair loop 前，是 L2-L3。
- Widget App、Terminal、Retrieval、WalnutAI 多数仍在 L0-L2，应视为产品闭环候选，不是默认产品证明。

## Case 设计检查表

每个新增或提升的 case，在改 `runnerStatus` 前都要回答：

1. 这个用户工作流进入哪条产品闭环？
2. 用户可见结果是什么？
3. 哪个 route、action、workspace step 或 tool 可以产生它？
4. 哪些 artifacts 或 evidence 证明结果？
5. 哪些 side effects 必须不存在？
6. 如果闭环失败，什么 honest failure 或 recovery option 证明系统仍然有用？
7. 这个 case 今天达到哪个质量等级：L0、L1、L2、L3、L4、还是 L5？
8. 哪个 profile 对这个声明有权威性：offline、network、model、search、还是 device？

## 清理顺序

1. 把每个 benchmark case 分配到这份文档中的一条产品闭环。
2. 对每条当前产品闭环，先把一个代表 case 提升到至少 L3。
3. 对 Screen Preview 和 Memory/Notes，补 L4 artifact/user-result 断言。
4. 对 Playlist Sync 和 screen/device evidence，建立小而固定的 L5 device baseline。
5. 在 Widget App 和 Terminal 产品闭环澄清前，保留已调通的工作路径；不要用删除支持面来代替 benchmark 质量提升。
6. 只有当一条闭环有可靠证明后，才继续提升更多 variants 的 `runnerStatus`。

