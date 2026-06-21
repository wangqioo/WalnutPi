# Use agent turn trace for product capability benchmarks

WalnutPi Product Capability Benchmark V2 should evaluate the product loop through agent turn traces, not through one runner branch per benchmark case.

The benchmark harness owns only the generic loop:

- submit the user input to Walnut Agent Console / `/api/agent/turn`;
- persist the returned `agentTurn` trace;
- classify side effects from the trace;
- evaluate product goal, evidence, and safety boundaries from the trace;
- write a report.

Direct API runners are not part of the product capability benchmark surface. Narrow product contracts such as screen generation, source-asset processing, stale playlist hash rejection, and device-gated sync should be covered by module self-checks or focused tests, not by a parallel benchmark runner.

**Consequences**

New product capability work should improve the product loop's trace quality instead of adding benchmark-only adapters. Cases should describe user goals, expected evidence categories, and safety boundaries. A case should not require a runner-specific tool list.
