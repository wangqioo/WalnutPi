# Device Benchmark Profile

`device` profile is for local verification against one concrete WalnutPi device. It is not a universal reproducibility profile and should not be used as the default CI gate.

Use these profiles as gates:

- `offline`: deterministic local product-loop checks where any case with `requirements.device`, `requirements.network`, `requirements.model`, or `requirements.search` is recorded as a profile skip.
- `network`: default product-loop checks that may use `requirements.network`, `requirements.model`, or `requirements.search` behavior but still record `requirements.device` cases as profile skips.

Use `device` only when the operator intentionally wants live-device coverage. Device results depend on the selected target, credentials, remote checkout path, current network route, physical peripherals, service state, display frame, and prior sync state.

## Recorded metadata

Every harness run records device preflight metadata in:

- `screen/benchmark-runs/<runId>/summary.json` at `environment.devicePreflight`
- `screen/benchmark-runs/<runId>/device-preflight.json`

The metadata records:

- selected profile and whether `includeDevice` is active
- `baseUrl`
- whether the Web Console was reachable before and after harness startup
- whether the harness started the Web Console
- target label from `SSH_USER@SSH_HOST`
- whether `SSH_HOST`, `SSH_USER`, and `SSH_PASSWORD` came from env or defaults
- remote root resolution from `WALNUT_REMOTE_PROJECT_ROOT`, then `WALNUT_PROJECT_ROOT`, then `/home/pi/projects/WalnutPi`
- `/api/actions` HTTP reachability and action policy manifest pointer when available
- known non-repeatable factors

Secret values are not recorded. `SSH_PASSWORD` is stored only as configured/default metadata.

Profile selection is driven only by the structured `requirements` object in each benchmark case. The harness does not infer network, model, search, or device needs from prompt text, flow names, titles, or old compatibility fields.

## Strict preflight

Default behavior records metadata and continues. For local live-device verification where missing target metadata should stop the run:

```text
bun scripts/run-product-capability-agent-harness.ts --profile device --strict-device-preflight
```

`--strict-device-preflight` fails fast only when `device`/`includeDevice` is active and a critical lightweight check fails:

- `baseUrl` reachable after optional local Web Console startup
- `/api/actions` reachable
- explicit `SSH_HOST`
- explicit `SSH_USER`
- explicit `SSH_PASSWORD`
- explicit `WALNUT_REMOTE_PROJECT_ROOT` or `WALNUT_PROJECT_ROOT`
- remote project root looks like an absolute device path

This preflight intentionally does not SSH, run `walnut`, inspect services, read frames, capture the screen, sync assets, restart services, or change the device.

## Interpretation

A passing strict device preflight means the harness has enough local target metadata to start a device-profile run. It does not prove that the device is online, that credentials work, that the remote checkout is current, or that real-device verification will pass.

For repeatable regression gating, use `offline` or `network`. Treat `device` output as evidence for one target at one time, with the preflight metadata attached so later readers can explain drift.
