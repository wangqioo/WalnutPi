export function createAgentEventBus() {
  const subscribers = new Map();

  function subscribe(sessionId, send) {
    const key = sessionId || "";
    const bucket = subscribers.get(key) || new Set();
    bucket.add(send);
    subscribers.set(key, bucket);
    return () => {
      bucket.delete(send);
      if (!bucket.size) subscribers.delete(key);
    };
  }

  function publish(event) {
    const targets = new Set([
      ...(subscribers.get("") || []),
      ...(subscribers.get(event?.sessionId || "") || []),
    ]);
    for (const send of targets) send(event);
  }

  return { subscribe, publish };
}
