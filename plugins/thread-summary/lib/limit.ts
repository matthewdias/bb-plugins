// At most `max` tasks at once; the rest wait their turn, first come first
// served. A surface that wants Git for every sidebar row would otherwise start
// one `git status` per row on the host, all at the same moment.
export function createLimiter(max: number): <T>(task: () => Promise<T>) => Promise<T> {
  let active = 0;
  const waiting: (() => void)[] = [];
  const next = () => {
    active -= 1;
    waiting.shift()?.();
  };
  return <T>(task: () => Promise<T>) =>
    new Promise<T>((resolve, reject) => {
      const start = () => {
        active += 1;
        // A task that throws synchronously still frees its slot.
        Promise.resolve()
          .then(task)
          .then(resolve, reject)
          .finally(next);
      };
      if (active < max) start();
      else waiting.push(start);
    });
}
