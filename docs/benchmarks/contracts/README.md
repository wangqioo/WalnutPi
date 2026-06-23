# Contract Benchmarks

Contract-only benchmark cases describe product contracts that are not executable coverage for the default product agent harness.

Run them with:

```sh
bun run bench:contracts
bun run bench:contracts:holdout
```

The contract runner validates the contract manifests and writes `contract-summary.json` under `screen/benchmark-runs/<runId>/`. It does not start the Walnut Agent Console, does not call `/api/agent/turn`, and does not emit product harness `skip` traces.

Use `bun run bench:product` for runnable product coverage. Promote a contract case into `docs/benchmarks/product/` only when the product harness can execute it as a real `runnable` or `device-gated` case.
