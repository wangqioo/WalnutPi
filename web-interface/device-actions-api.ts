import { createDeviceActionDispatcher } from "./gateway/device-action-dispatcher.ts";

export function createDeviceActionsApi({
  policyManifest,
  policyActions,
  actionBindings,
  opaEnforcer,
  walnutRemote,
  runRemote,
  webSessionLedger,
  webMetricsLedger,
  limitedOutput,
}) {
  return createDeviceActionDispatcher({
    policyManifest,
    policyActions,
    actionBindings,
    opaEnforcer,
    walnutRemote,
    runRemote,
    webSessionLedger,
    webMetricsLedger,
    limitedOutput,
  });
}
