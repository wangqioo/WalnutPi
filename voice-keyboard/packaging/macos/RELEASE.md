# macOS 发版准备清单

功能开发已完成（见 `packaging/macos/README.md`）。本文档跟踪从「能跑」到「能给陌生用户装」之间的剩余工作。

## 优先级与现状

| # | 项目 | 优先级 | 现状 |
|---|------|--------|------|
| 1 | Apple Developer 签名 + 公证 | **P0** | adhoc 签名，每次 rebuild TCC 权限失效 |
| 2 | 应用图标 | **P0** | `iconfile: None`，显示默认 Python 火箭 |
| 3 | DMG 安装器 | P1 | 仅产出裸 `.app`，无法直接分发 |
| 4 | Universal binary（arm64 + x86_64） | P2 | 仅 arm64，Intel Mac 跑不起来 |
| 5 | 自动更新 | P3 | 无机制，用户须重新下载 |

---

## 1. Apple Developer 签名 + 公证（P0）

**根因**：adhoc 签名（`codesign --sign -`）每次 rebuild 后 bundle hash 变化，系统视作不同 app，「辅助功能 / 麦克风 / 输入监控」三项授权全部失效，用户必须手动移除再重加。Gatekeeper 也会在首次打开时拦截。

**目标**：拿到稳定的 Developer ID 签名，bundle hash 跨版本可识别，且公证后不再触发 Gatekeeper 警告。

**步骤**：
1. 注册 Apple Developer Program（个人 $99/年）
2. 在 Apple Developer 后台申请 `Developer ID Application` 证书，导入 Keychain
3. 修改 `setup.py`：去掉 adhoc 签名步骤，改用 `codesign --deep --options runtime --sign "Developer ID Application: <Name> (<TeamID>)"`
4. 启用 Hardened Runtime，并在 entitlements 文件里授权：
   - `com.apple.security.device.audio-input`（麦克风）
   - `com.apple.security.cs.allow-jit`（部分 Python 运行时需要）
   - `com.apple.security.cs.disable-library-validation`（py2app 嵌入第三方 dylib 需要）
5. `xcrun notarytool submit dist/Voice\ Keyboard.app --apple-id <id> --team-id <team> --password <app-specific-password> --wait`
6. `xcrun stapler staple dist/Voice\ Keyboard.app` 把公证票钉到 bundle 里

**工时估算**：账号申请 1–3 天审核 + 实际配置 0.5–1 天

---

## 2. 应用图标（P0）

**目标**：`.icns` 多分辨率图标，在 Dock / Finder / 设置面板显示一致。

**步骤**：
1. 设计 1024×1024 PNG（建议保留 PSD/SVG 源文件方便迭代）
2. 用 `iconutil` 生成 `.icns`：
   ```bash
   mkdir Voice.iconset
   sips -z 16 16    icon.png --out Voice.iconset/icon_16x16.png
   sips -z 32 32    icon.png --out Voice.iconset/icon_16x16@2x.png
   sips -z 32 32    icon.png --out Voice.iconset/icon_32x32.png
   sips -z 64 64    icon.png --out Voice.iconset/icon_32x32@2x.png
   sips -z 128 128  icon.png --out Voice.iconset/icon_128x128.png
   sips -z 256 256  icon.png --out Voice.iconset/icon_128x128@2x.png
   sips -z 256 256  icon.png --out Voice.iconset/icon_256x256.png
   sips -z 512 512  icon.png --out Voice.iconset/icon_256x256@2x.png
   sips -z 512 512  icon.png --out Voice.iconset/icon_512x512.png
   cp icon.png Voice.iconset/icon_512x512@2x.png
   iconutil -c icns Voice.iconset -o packaging/macos/voice-keyboard.icns
   ```
3. `setup.py` 改 `"iconfile": "packaging/macos/voice-keyboard.icns"`

**工时估算**：设计 1 天（外包或 AI 出图）+ 集成 30 分钟

---

## 3. DMG 安装器（P1）

**目标**：用户拿到一个 `Voice-Keyboard-0.1.0.dmg`，双击挂载后拖到 Applications 完成安装。

**方案**：用 [`create-dmg`](https://github.com/create-dmg/create-dmg) 一行脚本搞定。

**步骤**：
1. `brew install create-dmg`
2. 在 `packaging/macos/` 加 `build-dmg.sh`：
   ```bash
   create-dmg \
     --volname "Voice Keyboard" \
     --window-size 600 400 \
     --icon-size 100 \
     --icon "Voice Keyboard.app" 175 200 \
     --app-drop-link 425 200 \
     "dist/Voice-Keyboard-${VERSION}.dmg" \
     "dist/Voice Keyboard.app"
   ```
3. DMG 本身也需要签名 + 公证（步骤 1 流程的延伸）

**工时估算**：0.5 天

---

## 4. Universal binary（P2）

**目标**：同一个 `.app` 同时在 Apple Silicon 和 Intel Mac 上原生运行。

**前提**：当前 build 路径 `build/bdist.macosx-15.0-arm64` 表明只编了 arm64。

**步骤**：
1. 安装 Universal Python（python.org 的 macOS Universal2 安装包，或用 pyenv 编译 universal2 版本）
2. 重装所有依赖时强制 universal2：`pip install --platform macosx_11_0_universal2 --only-binary=:all: -r requirements.txt -t .venv-universal/`
3. py2app 加 `"arch": "universal2"` 选项
4. 用 `lipo -info <dylib>` 抽查关键二进制都是 fat binary

**风险**：`sounddevice` / `pyobjc` 等部分 wheel 可能没有 universal2 预编译包，需源码编译。

**工时估算**：1–2 天（取决于依赖兼容性）

---

## 5. 自动更新（P3）

**目标**：发布新版本后，已安装用户自动收到提示并一键更新。

**方案对比**：
- **Sparkle**（业界标准）：托管一个 `appcast.xml`，发布时更新 URL 列表；需在 app 内嵌入 Sparkle 框架并打包 EdDSA 公钥
- **自研轮询**：启动时调 GitHub Releases API 看最新 tag，提示用户跳转下载（简单但不无缝）

**建议**：用户量 < 100 时用自研轮询；超过后再上 Sparkle。

**工时估算**：自研 0.5 天 / Sparkle 集成 2–3 天

---

## 发版流程（最终形态）

签名 + 图标完成后的标准流程：

```bash
# 1. 更新版本号（setup.py 里的 CFBundleVersion / CFBundleShortVersionString）
# 2. 构建
python packaging/macos/setup.py py2app

# 3. 签名（已集成进 setup.py 后自动）+ 公证
xcrun notarytool submit dist/Voice\ Keyboard.app ... --wait
xcrun stapler staple dist/Voice\ Keyboard.app

# 4. 打 DMG
bash packaging/macos/build-dmg.sh

# 5. 打 git tag + 上传 GitHub Release
git tag v0.1.0 && git push --tags
gh release create v0.1.0 dist/Voice-Keyboard-0.1.0.dmg --notes-file CHANGELOG.md
```

## 顺序建议

P0（签名 + 图标）一起做，因为图标会影响 bundle 内容，最好在签名前定下来。  
P1（DMG）紧跟 P0，是签名链条的最后一环。  
P2、P3 可推迟到首版上线后根据反馈决定。
