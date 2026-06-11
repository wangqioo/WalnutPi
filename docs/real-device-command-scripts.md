# 真机运行脚本说明

这些脚本把常用的 WalnutPi 真机运行命令固定成 Windows PowerShell 入口，方便从当前开发机重复启动 Web、同步小屏、读取设备回证和保存截图。

默认参数和当前真机环境一致：

- 设备地址：`192.168.1.24`
- SSH 用户：`root`
- SSH 密码：`root`
- 远端项目根：`/home/pi/projects/WalnutPi`
- 远端构建用户：`pi`
- Web 控制台端口：`4173`
- 独立 SSH 终端端口：`4174`

## 前置工具

Windows 本机需要能找到这些命令：

```powershell
bun --version
ssh -V
sshpass -V
```

如果工具来自 Scoop，先确认 Scoop shim 已经在 `PATH` 上。

## 启动 Web 控制台

```powershell
.\scripts\start-web-console.ps1
```

打开：

```text
http://127.0.0.1:4173/
```

只看 Web 预览、不连接真机：

```text
http://127.0.0.1:4173/?nossh
```

覆盖设备或端口：

```powershell
.\scripts\start-web-console.ps1 -HostName 192.168.1.24 -User root -Password root -Port 4173
```

这个脚本只设置当前进程的环境变量，然后运行：

```powershell
bun web-interface/model-terminal-server.js
```

## 启动独立 SSH 终端页面

如果只想打开浏览器里的 SSH 终端，用：

```powershell
.\scripts\start-ssh-terminal.ps1
```

打开：

```text
http://127.0.0.1:4174/
```

`4174` 是包装脚本默认端口，用来避免和 Web 控制台的 `4173` 冲突。

## 通过 Web API 同步小屏

先启动 Web 控制台，再运行：

```powershell
.\scripts\sync-screen-via-web-api.ps1
```

脚本会先读：

```text
GET /api/screen/manifest
```

再带当前 `manifestHash` 请求：

```text
POST /api/screen/sync
```

它会打印 `buildId`、`artifactHash`、`deliveryHash`、`visualMatch` 和 frame hash。

如果 Web 控制台不是默认端口：

```powershell
.\scripts\sync-screen-via-web-api.ps1 -BaseUri http://127.0.0.1:4183
```

## 一键真机完整测试

已有脚本仍然是完整验收入口：

```powershell
.\scripts\collect-screen-sync-evidence.ps1 -Sync
```

它会：

- 检查远端项目根
- 读取 `walnut screen state`
- 读取 `sudo -n walnut screen frame`
- 读取 `sudo -n walnut screen capture`
- 检查构建产物和 ownership
- 临时启动 Web API
- 请求 `/api/screen/manifest`
- 请求 `/api/screen/sync`
- 打印同步证据

只读采集，不触发同步：

```powershell
.\scripts\collect-screen-sync-evidence.ps1
```

## 保存真机屏幕 PNG

```powershell
.\scripts\save-screen-capture.ps1
```

默认输出：

```text
web-interface/screen-sync-records/latest-device-frame.png
```

指定输出路径：

```powershell
.\scripts\save-screen-capture.ps1 -OutputPath web-interface/screen-sync-records/manual-frame.png
```

这个脚本调用的是只读设备命令：

```bash
sudo -n walnut screen capture --png-base64
```

## 运行 walnut screen 命令

统一入口：

```powershell
.\scripts\invoke-walnut-screen.ps1 -Action state
```

支持的 `-Action`：

- `state`：`walnut screen state`
- `frame`：`sudo -n walnut screen frame`
- `capture`：`sudo -n walnut screen capture`
- `capture-base64`：`sudo -n walnut screen capture --png-base64`
- `start`：`sudo -n walnut screen start`
- `stop`：`sudo -n walnut screen stop`
- `toggle`：`sudo -n walnut screen toggle`
- `lvgl`：`walnut screen lvgl`

示例：

```powershell
.\scripts\invoke-walnut-screen.ps1 -Action frame
.\scripts\invoke-walnut-screen.ps1 -Action start
```

## 在真机上构建 LVGL

```powershell
.\scripts\build-lvgl-on-device.ps1
```

默认会 SSH 到真机，在 `/home/pi/projects/WalnutPi` 下以 `pi` 用户运行：

```bash
./scripts/build-lvgl-app.sh
```

构建完成后会打印：

```bash
sha256sum build/lvgl_app/walnut-lvgl-screen
```

## 常用流程

完整手动流程：

```powershell
.\scripts\start-web-console.ps1
```

另开一个 PowerShell：

```powershell
.\scripts\sync-screen-via-web-api.ps1
.\scripts\save-screen-capture.ps1
```

完整自动验收：

```powershell
.\scripts\collect-screen-sync-evidence.ps1 -Sync
```

只看页面不碰真机：

```powershell
.\scripts\start-web-console.ps1
```

然后打开：

```text
http://127.0.0.1:4173/?nossh
```
