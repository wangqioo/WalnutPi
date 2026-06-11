---
name: walnutpi-c
description: Work with WalnutPi C embedded programming docs: compiling C on the board, GPIO IO control, I2C, SPI, and UART serial programming. Use when the user mentions C嵌入式编程, gcc, Geany, IO控制, C GPIO, -lgpio, C I2C, C SPI, C UART, /dev/i2c-1, /dev/spidev1.0, /dev/ttyS4, ioctl, or compiling C on WalnutPi.
---

# WalnutPi C

## Sources

- Root: `walnutpi_wiki/docs/walnutpi_1/c`
- `c_run.md`: 在开发板上编译C语言代码
- `io_gpioc.md`: IO控制
- `i2c.md`: I2C
- `spi.md`: SPI
- `uart.md`: UART

## Commands

```sh
gcc test.c -o test
./test
gcc -Wall -o test test.c -lgpio
sudo ./test
gpio pin i2c
gpio pin spi
gpio pin uart
set-device status
```

## Notes

- C GPIO links with `-lgpio` and usually runs with sudo.
- I2C/SPI/UART alternate functions need `set-device` and reboot.
- Confirm `/dev/i2c-1`, `/dev/spidev1.0`, or `/dev/ttyS4` exists before debugging C code.
