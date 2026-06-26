import { Inngest } from "inngest";

export const walnutInngest = new Inngest({
  id: "walnutpi",
});

export const collectDeviceEvidenceFunction = walnutInngest.createFunction(
  {
    id: "collect-device-evidence",
    name: "Collect device evidence",
    triggers: {
      event: "walnut/device.evidence.requested",
    },
  },
  async ({ event }) => {
    return {
      ok: true,
      eventName: event.name,
      queuedOnly: true,
    };
  },
);

export const walnutInngestFunctions = [
  collectDeviceEvidenceFunction,
];
