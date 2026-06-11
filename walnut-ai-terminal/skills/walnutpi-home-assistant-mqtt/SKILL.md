---
name: walnutpi-home-assistant-mqtt
description: Work with WalnutPi Home Assistant MQTT docs: MQTT server installation and adding MQTT integration. Use when the user mentions Home Assistant MQTT, MQTT服务器安装, 添加MQTT集成, Mosquitto, MQTTX, /etc/mosquitto, port 1883, allow_anonymous, pwfile, or aclfile.
---

# WalnutPi Home Assistant MQTT

## Sources

- Root: `walnutpi_wiki/docs/walnutpi_1/home_assistant/mqtt`
- `install.md`: MQTT服务器安装
- `add.md`: 添加MQTT集成

## Mosquitto Commands

```sh
sudo apt install mosquitto
sudo service mosquitto start
sudo nano /etc/mosquitto/conf.d/default.conf
sudo mosquitto_passwd /etc/mosquitto/pwfile pi
sudo service mosquitto restart
```

## Notes

- HA image has MQTT server preinstalled per docs.
- Use `walnutpi-home-assistant-mqtt-entities` for LED/KEY/DS18B20 entity docs.
