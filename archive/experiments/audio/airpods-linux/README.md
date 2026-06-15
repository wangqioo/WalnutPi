# AirPods on WalnutPi headless Linux

This folder records the AirPods/Bluetooth audio investigation on a WalnutPi running headless Debian Linux.

## Environment

- Device: WalnutPi
- OS: Debian GNU/Linux 12 bookworm, arm64/aarch64
- Kernel: 6.1.31
- Bluetooth controller: onboard UART Bluetooth
- Bluetooth-related drivers/modules observed: `sprdbt_tty`, `uwe5622_bsp_sdio`, `hci_uart`
- Headset tested: AirPods Pro 3
- AirPods MAC used during testing: `34:0E:22:C0:C7:CC`

## Current working result

AirPods playback works in A2DP mode.

The stable playback path is:

- PulseAudio owns the Bluetooth A2DP audio endpoint
- BlueALSA is disabled to avoid endpoint conflicts
- Default sink is the AirPods A2DP sink
- Volume is set to 50%

Useful command on this WalnutPi:

```bash
vk-airpods-audio
```

This reconnects AirPods and switches them back to A2DP music playback mode.

## Stable playback state

Expected PulseAudio state:

```text
Default Sink: bluez_sink.34_0E_22_C0_C7_CC.a2dp_sink
bluetooth.protocol = "a2dp_sink"
Mute: no
Volume: 50%
```

Check with:

```bash
sudo -u pi env HOME=/home/pi USER=pi LOGNAME=pi \
  XDG_RUNTIME_DIR=/run/user/1000 \
  PULSE_SERVER=unix:/run/user/1000/pulse/native \
  pactl info | grep 'Default Sink'

sudo -u pi env HOME=/home/pi USER=pi LOGNAME=pi \
  XDG_RUNTIME_DIR=/run/user/1000 \
  PULSE_SERVER=unix:/run/user/1000/pulse/native \
  pactl list sinks | sed -n '/bluez_sink.34_0E_22_C0_C7_CC.a2dp_sink/,/Formats:/p'
```

Playback test:

```bash
sudo -u pi env HOME=/home/pi USER=pi LOGNAME=pi \
  XDG_RUNTIME_DIR=/run/user/1000 \
  PULSE_SERVER=unix:/run/user/1000/pulse/native \
  speaker-test -D pulse -t sine -f 440 -l 1
```

## Important conflict found

During microphone experiments, BlueALSA was installed and enabled. Later, AirPods playback sometimes only sounded once and then stopped.

The cause was a leftover `bluealsa-aplay` process and BlueALSA competing with PulseAudio for Bluetooth audio endpoints.

Fix:

```bash
systemctl disable --now bluealsa
pkill -f '^/usr/bin/bluealsa-aplay' || true
vk-airpods-audio
```

After this, only PulseAudio should handle Bluetooth playback.

Confirm:

```bash
systemctl is-enabled bluealsa 2>/dev/null || true
ps -ef | grep -E 'pulseaudio|bluealsa' | grep -v grep || true
```

Expected:

- `bluealsa` is disabled
- only `pulseaudio` remains for audio playback

## Microphone investigation summary

AirPods microphone capture does not work through this WalnutPi onboard Bluetooth controller in the current system.

This is not a normal audio routing problem. The key diagnostic is the Bluetooth SCO RX counter.

Check:

```bash
hciconfig -a | sed -n '/RX bytes/,+1p'
```

During every microphone recording attempt, `sco RX` stayed at `0`.

That means Linux never received SCO microphone audio packets from the Bluetooth controller.

## PulseAudio microphone result

PulseAudio could expose an HFP source such as:

```text
bluez_source.34_0E_22_C0_C7_CC.handsfree_head_unit
```

But recording produced zero bytes or blocked:

```bash
parec \
  --device=bluez_source.34_0E_22_C0_C7_CC.handsfree_head_unit \
  --format=s16le --rate=8000 --channels=1 --raw > /tmp/airpods.raw
```

Result:

- source visible
- recording starts
- output stays `0 bytes`
- `sco RX` stays `0`

## BlueALSA microphone result

BlueALSA was tested as an HFP/HSP Audio Gateway:

```ini
[Service]
ExecStart=
ExecStart=/usr/bin/bluealsa -p a2dp-source -p a2dp-sink -p hfp-ag -p hsp-ag --initial-volume=50
```

BlueALSA listed a capture device:

```text
bluealsa:SRV=org.bluealsa,DEV=34:0E:22:C0:C7:CC,PROFILE=sco
    capture
    SCO (CVSD): S16_LE 1 channel 8000 Hz
```

Recording command:

```bash
arecord \
  -D bluealsa:SRV=org.bluealsa,DEV=34:0E:22:C0:C7:CC,PROFILE=sco \
  -f S16_LE -c 1 -r 8000 -d 5 -t raw /tmp/bluealsa-sco.raw
```

Result:

- BlueALSA opened the SCO capture device
- logs showed a new SCO link and HFP Audio Gateway transport
- output file stayed `0 bytes`
- `sco RX` stayed `0`

## Firmware experiment

The WalnutPi firmware config contains:

```ini
/lib/firmware/bt_configure_pskey.ini
g_sys_sco_transmit_mode = 0
```

Values tested:

- `0`
- `1`
- `2`
- `3`

For each value:

1. change `g_sys_sco_transmit_mode`
2. restart Bluetooth and BlueALSA
3. reconnect AirPods
4. run SCO recording test
5. check file size and `sco RX`

All values failed in the same way:

- capture device visible
- recording opens
- raw file stays `0 bytes`
- `sco RX` stays `0`

The file was restored to the original value:

```ini
g_sys_sco_transmit_mode = 0
```

## Conclusion

AirPods playback is usable on this WalnutPi.

AirPods microphone capture is not usable through the onboard Bluetooth controller in the current kernel/driver/firmware stack.

The likely low-level reason is that the onboard UART Bluetooth module routes SCO audio through a chip-level PCM/I2S path instead of delivering microphone SCO packets to Linux over HCI. If the board or vendor driver does not expose that PCM path to Linux audio, BlueZ/PulseAudio/BlueALSA can create the profile but cannot receive samples.

A relevant reference is the BlueALSA HFP/HSP documentation, especially its SCO routing notes:

https://github-wiki-see.page/m/Arkq/bluez-alsa/wiki/Using-BlueALSA-with-HFP-and-HSP-Devices

## Practical recommendation

For WalnutPi AI/voice work:

1. Use AirPods for playback only.
2. Use a USB microphone for reliable speech input.
3. If Bluetooth microphone support is required, test a Linux-compatible USB Bluetooth adapter with working SCO/HFP-over-HCI support.
4. Keep BlueALSA disabled unless actively testing Bluetooth microphone capture.
