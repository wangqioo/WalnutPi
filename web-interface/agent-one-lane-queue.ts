export function createOneLaneQueue() {
  const jobs = [];
  let running = false;
  let scheduled = false;

  function enqueue(job) {
    jobs.push(job);
    if (scheduled) return;
    scheduled = true;
    setTimeout(drain, 0);
  }

  async function drain() {
    if (running) return;
    scheduled = false;
    running = true;
    try {
      while (jobs.length) {
        const job = jobs.shift();
        await job();
      }
    } finally {
      running = false;
    }
  }

  return {
    enqueue,
    size: () => jobs.length + (running ? 1 : 0),
  };
}
