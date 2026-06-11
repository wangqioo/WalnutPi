---
name: walnutpi-linux-build
description: Work with WalnutPi Linux build docs: walnutpi-build image construction, U-Boot, Linux kernel, Debian rootfs, cross compiler, and compiling drivers on the board. Use when the user mentions Linux系统编译, walnutpi-build, 编译uboot, 编译linux, 编译debian, 交叉编译器, 编译驱动, device tree overlay, dtbo, or kernel modules.
---

# WalnutPi Linux Build

## Sources

- Root: `walnutpi_wiki/docs/walnutpi_1/linux_build`
- `walnutpi-build.md`, `uboot.md`, `linux.md`, `debian.md`, `cross_compiler.md`, `compile_driver.md`

## Key Commands

```sh
git clone https://github.com/walnutpi/walnutpi-build.git
sudo apt install whiptail bc
sudo ./build.sh
export CROSS_COMPILE=aarch64-none-linux-gnu-
export ARCH=arm64
make walnutpi1b_defconfig
```

## Safety

- Confirm target device before `dd`, mount/copy, or SD/EMMC writes.
- Kernel/rootfs build commands can be host-destructive if pointed at the wrong disk.
