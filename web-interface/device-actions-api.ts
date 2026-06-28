import { createDeviceActionDispatcher } from "./gateway/device-action-dispatcher.ts";

export function createDeviceActionsApi({
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
  return createDeviceActionDispatcher({
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
