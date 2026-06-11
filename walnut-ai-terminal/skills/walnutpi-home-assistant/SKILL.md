---
name: walnutpi-home-assistant
description: Work with WalnutPi Home Assistant docs: intro, install, initialization, concepts, dashboard, camera monitoring, automation, adding market products, and HomeKit. Use when the user mentions Home Assistant, 智能家居, HA安装, 初始化配置, 仪表盘, 摄像头监控, 自动化, HomeKit, or WalnutPi smart home.
---

# WalnutPi Home Assistant

## Sources

- Root: `walnutpi_wiki/docs/walnutpi_1/home_assistant`
- `intro.md`, `install.md`, `config.md`, `concept.md`, `dashboard.md`, `ip_camera.md`, `automation.md`, `other_device.md`, `homekit.md`

## Install Notes

- Official HA image is simplest.
- Package install preserves existing OS but installs Docker and HA packages.
- 1B 1G should use server image; 2G/4G recommended for beginners.
- Desktop image BlueMan may conflict with HA Bluetooth per docs.

## Child Skills

- `walnutpi-home-assistant-mqtt`
- `walnutpi-home-assistant-mqtt-entities`
