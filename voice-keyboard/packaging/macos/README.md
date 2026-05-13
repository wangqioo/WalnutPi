# macOS 打包

使用 [py2app](https://py2app.readthedocs.io/) 把 `agent/` 打成原生 `.app`。

## 前置

- macOS 11+（与 `LSMinimumSystemVersion` 对齐）
- Python 3.11+（建议官方 python.org 安装包，便于 codesign）
- 仓库根目录已 `pip install -r requirements.txt` 过

## 构建

在**仓库根目录**执行：

```bash
pip install py2app
python packaging/macos/setup.py py2app
```

产物：`dist/Voice Keyboard.app`

开发期可用 alias 模式（不复制依赖，源码修改实时生效）：

```bash
python packaging/macos/setup.py py2app -A
```

## 已知坑

- **adhoc 签名 TCC 漂移**：每次 rebuild 后 bundle 哈希变化，系统设置里的「辅助功能 / 麦克风 / 输入监控」授权会失效，需要手动移除再重新添加。可考虑申请 Apple Developer 证书做正式签名。
- **charset_normalizer mypyc**：py2app 默认会拉错版本。`requirements.txt` 已固定不带 mypyc 编译扩展的版本。
- **Gatekeeper**：未签名 `.app` 首次打开走「右键 → 打开」绕过 Gatekeeper，否则被隔离。
- **SSL 证书**：见仓库 `CLAUDE.md` 的 SSL 段。打包后 app 内置了 certifi，运行时不需要 `SSL_CERT_FILE` 前缀。
