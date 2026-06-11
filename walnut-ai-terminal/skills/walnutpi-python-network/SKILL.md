---
name: walnutpi-python-network
description: Work with WalnutPi Python network application experiments, including TCP socket communication and MQTT publish/subscribe using paho-mqtt. Use when the user mentions WalnutPi 网络应用, Socket通讯, MQTT通讯, paho-mqtt, publish, subscribe, TCP client/server, MQTT topic, or network debugging assistants.
---

# WalnutPi Python Network

## Sources

- Local docs root: `walnutpi_wiki/docs/walnutpi_1/python/network`
- Socket: `socket.md`
- MQTT: `mqtt.md`

## Network Preconditions

- Put PC and WalnutPi on the same LAN for local socket tests.
- Verify board IP:

```sh
ip addr
sudo ifconfig
```

- PC firewall can block socket tests.

## Socket Pattern

Docs use WalnutPi as TCP client:

```python
import socket, time

s = socket.socket()
addr = ("192.168.1.111", 10000)
s.connect(addr)
s.send(b"Hello 01Studio!")
```

The user must replace server IP and port.

## MQTT Pattern

Install:

```sh
sudo pip3 install paho-mqtt
```

Publisher shape:

```python
import paho.mqtt.client as mqtt
import time

host = "mq.tongxinmao.com"
port = 18830
topic = "/public/walnutpi/1"

client = mqtt.Client()
client.connect(host, port)
client.publish(topic, "Hello WalnutPi!")
```

Subscriber uses `on_connect`, `on_message`, `client.subscribe(topic)`, and `client.loop_forever()`.

Treat public brokers as demos; for production, use a private broker and credentials.
