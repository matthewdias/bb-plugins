/** bb's row: a container carrying `group/thread-row`, the anchor inside it. */
export function bbRow(threadId: string): { row: HTMLElement; anchor: HTMLAnchorElement; glyph: HTMLElement } {
  const row = document.createElement("div");
  row.className = "group/thread-row flex w-full";
  const glyph = document.createElement("span");
  const anchor = document.createElement("a");
  anchor.href = `/threads/${threadId}`;
  anchor.setAttribute("data-sidebar-thread-id", threadId);
  anchor.textContent = threadId;
  row.append(glyph, anchor);
  return { row, anchor, glyph };
}
