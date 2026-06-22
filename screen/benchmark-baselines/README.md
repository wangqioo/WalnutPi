# Product Benchmark Baselines

Approved baseline summaries live at:

```text
screen/benchmark-baselines/<profile>/summary.json
```

`offline` is the CI gate profile. `network` and `device` are review profiles and can vary with external services or the live WalnutPi.

Refresh a baseline only after reviewing the run:

```powershell
bun scripts/run-product-capability-agent-harness.ts --profile offline --run-id baseline-offline
New-Item -ItemType Directory -Force screen/benchmark-baselines/offline
Copy-Item screen/benchmark-runs/baseline-offline/summary.json screen/benchmark-baselines/offline/summary.json
```

Gate command:

```powershell
bun run bench:product:gate
```
