import { createActionDispatcher } from "./gateway/action-dispatcher.ts";

export function createAgentActionsApi({
  policyManifest,
  policyActions,
  actionRegistry,
  opaEnforcer,
  walnutRemote,
  runRemote,
  webSessionLedger,
  webMetricsLedger,
  limitedOutput,
  json,
}) {
  return createActionDispatcher({
    policyManifest,
    policyActions,
    actionRegistry,
    opaEnforcer,
    walnutRemote,
    runRemote,
    webSessionLedger,
    webMetricsLedger,
    limitedOutput,
    json,
  });
}

