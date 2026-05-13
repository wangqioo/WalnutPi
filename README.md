# WalnutPi

WalnutPi is a collection of AI-native terminal experiments for a headless WalnutPi Linux device.

The first prototype is **WalnutAI Terminal V0**: a small command-line AI interaction shell that keeps Linux booting into the normal CLI, while allowing the user to enter an AI-native terminal manually with:

```bash
walnut-ai
```

## Current modules

- `walnut-ai-terminal/` - cloud-AI terminal prototype for headless Linux
- `scripts/` - install and helper scripts

## Device philosophy

This project treats WalnutPi as a lightweight local interaction carrier for cloud AI:

- no desktop environment required
- no local large-model inference
- command-line first
- structured card-like terminal output
- local status collection and hardware control
- cloud API for reasoning, writing, translation, and planning

## Prototype status

This is V0. It intentionally does not replace the default shell or boot flow.
