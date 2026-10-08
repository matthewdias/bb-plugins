// Which threads have a card open right now.
//
// The card and the Git provider live in different React trees: the card under
// a header action, the provider in the app overlay. Git refreshes when a card
// opens and polls while one stays open, so the card says so here and the
// provider listens.
const counts = new Map<string, number>();
const listeners = new Set<(threadId: string, open: boolean) => void>();

/** Mark a card open for `threadId`; returns the close. */
export function markOpen(threadId: string): () => void {
  const before = counts.get(threadId) ?? 0;
  counts.set(threadId, before + 1);
  if (before === 0) for (const listener of [...listeners]) listener(threadId, true);
  let closed = false;
  return () => {
    if (closed) return;
    closed = true;
    const now = (counts.get(threadId) ?? 1) - 1;
    if (now > 0) {
      counts.set(threadId, now);
      return;
    }
    counts.delete(threadId);
    for (const listener of [...listeners]) listener(threadId, false);
  };
}

export function isOpen(threadId: string): boolean {
  return (counts.get(threadId) ?? 0) > 0;
}

export function onOpenChange(listener: (threadId: string, open: boolean) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
