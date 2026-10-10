// A diff shaped the way bb draws one, for tests of what Follow Up adds to it:
// a `<diffs-container>` with an open shadow root holding, in unified view,
//
//   <pre><code data-code data-unified>
//     <div data-gutter  style="grid-row: span N"> …N cells… </div>
//     <div data-content style="grid-row: span N"> …N rows…  </div>
//   </code></pre>
//
// with `data-line` and `data-line-type` on each row of code. This mirrors the
// markup read from bb 0.45's diff view; src/page/diff-rows.ts says the same,
// and a live check against the real app is what keeps the two honest.
export interface FixtureLine {
  type: "context" | "addition" | "deletion" | "change-addition" | "change-deletion";
  line: number;
  text: string;
}

export const QUEUE_LINES: FixtureLine[] = [
  { type: "context", line: 12, text: "  const max = 5;" },
  { type: "change-deletion", line: 13, text: "  retry(job);" },
  { type: "change-addition", line: 13, text: "  retry(job, { backoff: true });" },
  { type: "addition", line: 14, text: "  log(job);" },
  { type: "context", line: 15, text: "  return job;" },
];

export function buildDiff(
  parent: HTMLElement,
  lines: readonly FixtureLine[] = QUEUE_LINES,
  { view = "unified", separatorAt = -1 }: { view?: "unified" | "split"; separatorAt?: number } = {},
): HTMLElement {
  const host = document.createElement("diffs-container");
  const root = host.attachShadow({ mode: "open" });
  const pre = document.createElement("pre");
  const code = document.createElement("code");
  code.setAttribute("data-code", "");
  code.setAttribute(view === "unified" ? "data-unified" : "data-additions", "");
  const gutter = document.createElement("div");
  gutter.setAttribute("data-gutter", "");
  const content = document.createElement("div");
  content.setAttribute("data-content", "");
  let rows = 0;
  lines.forEach((line, index) => {
    if (index === separatorAt) {
      // A row that is not a line of code: a hunk separator, in both stacks.
      for (const stack of [gutter, content]) {
        const separator = document.createElement("div");
        separator.setAttribute("data-separator", "");
        stack.append(separator);
      }
      rows += 1;
    }
    const cell = document.createElement("div");
    cell.setAttribute("data-column-number", String(line.line));
    cell.setAttribute("data-line-type", line.type);
    cell.textContent = String(line.line);
    gutter.append(cell);
    const row = document.createElement("div");
    row.setAttribute("data-line", String(line.line));
    row.setAttribute("data-line-type", line.type);
    const text = document.createElement("span");
    text.textContent = line.text;
    row.append(text);
    content.append(row);
    rows += 1;
  });
  gutter.setAttribute("style", `grid-row: span ${rows}`);
  content.setAttribute("style", `grid-row: span ${rows}`);
  code.append(gutter, content);
  pre.append(code);
  root.append(pre);
  parent.append(host);
  return host;
}

export function stacks(host: HTMLElement): { gutter: HTMLElement; content: HTMLElement } {
  const root = host.shadowRoot!;
  return { gutter: root.querySelector("[data-gutter]") as HTMLElement, content: root.querySelector("[data-content]") as HTMLElement };
}
