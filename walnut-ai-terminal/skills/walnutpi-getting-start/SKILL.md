---
name: walnutpi-getting-start
description: Work with WalnutPi 1st-generation getting-started docs: hardware details, 1B/ZeroW accessory assembly, OS image flashing, EMMC flashing, and first boot. Use when the user mentions 开箱指南, 硬件详解, 配件组装, 1B配件, ZeroW配件, 系统镜像烧录, 开机, first boot, SD flashing, EMMC flashing, Rufus, balenaEtcher, or Phoenix-style bring-up.
---

# WalnutPi Getting Started

## Sources

- Root: `walnutpi_wiki/docs/walnutpi_1/getting_start`
- `hw-detail.md`: 硬件详解
- `1b-peripherals.md`: 核桃派1B配件组装
- `zerow-peripherals.md`: 核桃派ZeroW配件组装
- `os-install.md`: 系统镜像烧录
- `start_up.md`: 开机

## Key Workflows

- Identify board connectors and required peripherals.
- Flash SD image with Rufus or balenaEtcher.
- For EMMC variants, verify hardware and image version before writing.
- First boot can take several minutes on desktop image.

## Safety

- Image flashing and EMMC commands are destructive.
- Confirm target storage device before any `dd`, Rufus, PhoenixCard, or `set-emmc` operation.
