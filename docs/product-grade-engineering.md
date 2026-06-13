# WalnutPi 产品级工程化约定

本文档定义 WalnutPi 从实验工作区走向产品级工程形态时的约束、模块边界和迁移顺序。

它不是一次“大重构”清单，也不是要求把仓库改成通用平台。它的目标是让当前最清晰的产品主线变得可启动、可维护、可验证、可继续演进。

## 背景

当前项目已经形成一条明确主线：

```text
自然语言或引导意图
-> Web 预览小屏 Screen Manifest
-> 用户显式同步到 WalnutPi
-> 远端构建 LVGL 程序
-> WalnutPi 小屏运行同一个 manifest 对应的界面
-> Web 展示状态、执行证据和 AI 可读总结
```

这条链路已经有关键能力：

- `GET /api/screen/manifest` 暴露当前 Screen Manifest 和 `manifestHash`。
- `POST /api/screen/sync` 在任何构建、SSH、设备写入前校验客户端 `manifestHash`。
- `?nossh` 模式阻断 SSH、构建、交付、激活和设备写入。
- 设备侧稳定契约是 `walnut screen ...`。
- 同步记录、delivery manifest、artifact hash、frame evidence、repair candidate、AI summary 已经成形。

当前主要问题不是功能缺失，而是工程形态仍偏实验：

- 根目录缺少产品级统一入口，启动、验证和环境约束分散在脚本与文档里。
- `web-interface/model-terminal-server.js` 同时承担 HTTP 路由、静态文件、SSH、Walnut CLI 预检、screen sync、manifest 编辑、repair、AI summary、memory、session、action routing 等职责。
- 文档中已有 Control Plane API、Device Execution Surface、Screen Manifest 等领域词，但代码布局还没有完全体现这些词。

## 产品级目标

产品级在 WalnutPi 中意味着：

1. 新贡献者能从根目录理解并启动主线产品。
2. 每条用户可见流程都有明确的控制平面、设备执行面和证据面。
3. 初学者 UI 和开发者诊断保持分层，不能因为工程拆分把 hashes、raw logs、PNG bytes 暴露到普通用户路径。
4. 高风险动作继续有显式确认，不把 Web 控制台变成公共 root shell。
5. 模块命名直接对应项目领域语言，后续 agent 能按 `CONTEXT.md` 里的词定位代码。
6. 每次迁移都保持当前 Screen Sync Slice 的外部契约不变，除非先写新的对齐文档。

## 非目标

这轮工程化不做以下事情：

- 不把 WalnutPi 改成通用 IDE、桌面系统、ESP32 板卡平台或 VibeBoard 复刻。
- 不重写 Web UI 视觉设计。
- 不替换 `walnut screen` CLI。
- 不引入任意 LVGL/C 代码生成。
- 不把 `third/VibeBoard` 或 `third/walnutpi` 的 app/services wholesale 搬进主线。
- 不为了拆文件而制造只有一两个函数的浅模块。

## 目标模块形态

### 根目录入口

根目录需要成为产品入口，而不是只作为文件夹索引。

目标形态：

- `package.json` 作为 JavaScript/Bun 命令清单，至少表达 Web 控制台、预览模式、安全回归脚本等入口。
- `pyproject.toml` 作为 Python 运行约束与项目元数据入口，先不强迫把所有 Python 子项目打包成一个发行包。
- 保留现有 PowerShell 和 Bash 脚本作为跨平台/真机工作流封装。
- 不伪造依赖锁。只有当 Bun 依赖实际进入项目时，才引入并维护 lockfile。

根目录命令应该隐藏平台差异，但不能隐藏风险。凡是会连接设备、构建、激活或写设备的命令，名称和输出必须明确说明。

### Web Composition Root

`web-interface/model-terminal-server.js` 的长期角色应收敛为 composition root：

- 读取环境变量。
- 组装模块依赖。
- 注册 HTTP 路由和 WebSocket。
- 启动 Bun server。

它不应长期持有 screen repair 规则、AI summary prompt、manifest 编辑语法、SSH 命令细节、session 存储细节或 evidence ledger 记录格式。

### Control Plane API

Control Plane API 是 Web/API 控制面。它拥有：

- HTTP 路由。
- `?nossh` 阻断。
- 请求体读取和 HTTP 状态码。
- beginner-facing response shape。
- 调用下层模块并持久化证据。

目标模块：

```text
web-interface/routes/
  screen-routes.js
  action-routes.js
  session-routes.js
  memory-routes.js
  static-routes.js
```

路由模块不应该直接拼 SSH 命令，也不应该直接解释 Screen Manifest vocabulary。

### Screen Product Modules

Screen 相关模块应该围绕当前产品词组织：

```text
web-interface/screen/
  manifest-store.js
  manifest-editor.js
  screen-templates.js
  repair.js
  ai-summary.js
  pixel-diff.js
```

职责划分：

- `manifest-store`：读取、规范化、hash、写入 Screen Manifest。
- `manifest-editor`：规则式自然语言编辑与 patch 合并。
- `screen-templates`：模板定义和模板预览。
- `repair`：从同步记录生成 repair hint/candidate/proposal，不连接设备。
- `ai-summary`：从同步记录生成证据受限总结，默认本地规则，可选调用 OpenAI-compatible API。
- `pixel-diff`：验证并持久化 browser-computed Web/device diff。

这些模块默认应是纯逻辑或只依赖显式注入的文件/API 函数。任何会 SSH、构建、抓图、激活、写设备的能力都不能混入这些模块。

### Screen Sync Workflow

`web-interface/screen-sync-workflow.js` 已经是正确方向：它把当前 Screen Manifest 和客户端 `manifestHash` 变成一次 record-ready sync result。

它应该继续拥有：

- build id 生成调用点。
- manifest hash gating。
- preview mode 拒绝。
- delivery adapter 调用。
- failure stage 的同步层分类。

它不应该拥有：

- 具体 SSH 命令。
- HTTP 路由。
- record 文件布局。
- Web UI 文案状态机。

### Delivery Adapter

`web-interface/screen-delivery-adapters/ssh-local-agent.js` 是当前真实 adapter。

它应该继续拥有：

- screen slice 下发。
- 远端 build。
- artifact hash。
- delivery manifest/hash。
- activation。
- `walnut screen state` 和 `sudo -n walnut screen frame` 回证。

它不应该拥有：

- repair policy。
- AI summary。
- browser pixel diff。
- route status code。

当出现第二种真实 delivery adapter 时，再扩大 adapter seam；在此之前不要为了抽象而抽象。

### Device Execution Surface

设备执行面仍然是 `walnut screen ...` 和 `walnut action run ... --json`。

必须保留：

```text
walnut screen lvgl
walnut screen start
walnut screen stop
walnut screen toggle
walnut screen state
walnut screen frame
walnut screen capture
```

Web、WalnutAI、脚本都应该调用这些稳定命令，而不是各自重新实现设备写入、服务控制或 framebuffer 读取。

### Evidence Ledger

`web-interface/screen-evidence-ledger.js` 已经承担了本地记录接口。

它应该继续拥有：

- `record.json`
- `summary.json`
- retention
- cached `frame.png`
- history projection
- record update

它不应该拥有：

- 同步执行。
- repair 规则。
- AI summary 规则。
- HTTP 路由。

### Web UI Shell

`web-interface/model-terminal.html` 当前也是多职责文件，但拆分优先级低于 server。

产品级目标不是立刻引入前端框架，而是让 UI 行为仍然清晰：

- beginner surface 只显示 `未同步`、`同步中`、`已同步到核桃派`、`同步失败` 等可理解状态。
- developer diagnostics 才显示 build id、hashes、delivery manifest、raw command output、frame evidence、pixel diff、AI summary evidence。
- screen preview 永远从 Screen Manifest 派生，不从设备截图反推。

## 迁移顺序

### Phase 0: 文档和基线

目标：先对齐产品级工程化契约。

输出：

- 本文档。
- 后续实现前确认是否需要调整 `CONTEXT.md` 的领域词。

不做：

- 不改运行代码。
- 不新增测试。
- 不启动服务。

### Phase 1: 根目录入口

目标：让根目录成为明确入口。

建议输出：

- `package.json`
- `pyproject.toml`
- 必要时补充 `README.md` 的“开发入口”小节。

验收：

- 命令名能区分 preview-only、local API safety、real-device sync。
- 不新增不真实的第三方依赖。
- 不改变现有脚本行为。

### Phase 2: Screen 纯逻辑模块

目标：先搬不会碰设备的逻辑，降低行为风险。

优先抽出：

- screen repair hint/candidate/proposal
- screen AI summary
- manifest templates
- manifest editor
- pixel diff normalization

验收：

- 所有 `/api/screen/...` 路由 response shape 不变。
- 抽出的模块不引用 SSH、Bun server、WebSocket、`runRemote`。
- `?nossh` 语义不变。

### Phase 3: Remote Execution 模块

目标：把 SSH 和 Walnut CLI 预检从 server composition root 中移出。

建议模块：

```text
web-interface/remote/
  ssh-client.js
  walnut-cli-preflight.js
  remote-actions.js
```

验收：

- `runRemote` 和 `runRemoteScript` 的超时、输出截断、preflight 行为不变。
- Web terminal 和 screen delivery 继续共用同一个远端执行实现。
- SSH 密码和目标参数仍只来自环境变量或显式配置。

### Phase 4: HTTP Routes

目标：让 server 文件只组装路由。

建议顺序：

1. session/memory/retrieval routes
2. screen routes
3. action routes
4. static file routes
5. terminal WebSocket setup

验收：

- public API path 不变。
- HTTP status code 不变。
- beginner summary 文案不漂移，除非单独对齐。

### Phase 5: Web UI 拆分

目标：在 server 稳定后，再考虑拆 `model-terminal.html`。

可选形态：

```text
web-interface/public/
  model-terminal.html
  model-terminal.css
  model-terminal.js
```

不急于引入构建链。当前产品更需要可靠控制面，而不是前端工具链复杂度。

## 验收原则

每个阶段结束时，至少应能回答：

- 初学者还能不能完成“看预览 -> 同步 -> 看状态”？
- `manifestHash` 是否仍然在任何 build/SSH/device-write 前被校验？
- `?nossh` 是否仍然 preview-only？
- `walnut screen` 稳定命令是否未破坏？
- delivery manifest/hash 是否仍承诺 artifact hash 和 screen manifest hash？
- 设备证据是否仍只进入开发者诊断层？
- 失败阶段是否仍可被 repair candidate 和 AI summary 解释？

## 后续实现约束

- 每次只迁移一个产品 seam，不做横跨 UI、server、device CLI 的大替换。
- 能以纯模块抽出的，先抽纯模块。
- 任何会改变 public route、CLI、manifest schema、risk policy 的改动，先补文档再改代码。
- 不为了兼容旧实验保留复杂 compatibility layer；如果确实是 contract-changing，需要先明确新契约。
- 不新增测试夹具或 snapshot，除非用户明确要求。已有安全回归脚本可以作为手动验收入口。

## 当前推荐的第一刀

第一刀不应该是直接拆 HTTP 路由，也不应该是重写 Web UI。

推荐顺序：

1. 补根目录 `package.json` 和 `pyproject.toml`，让产品入口明确。
2. 抽出 `web-interface/screen/repair.js` 和 `web-interface/screen/ai-summary.js`，因为它们只读同步记录、不连接设备，风险最低。
3. 抽出 manifest templates/editor，让 Screen Manifest vocabulary 成为清晰模块。
4. 最后再拆 routes 和 remote execution。

这样做的收益是：先让工程入口变产品化，再把 `model-terminal-server.js` 中最容易独立的领域逻辑拿出去，同时保持当前真机同步链路不变。
