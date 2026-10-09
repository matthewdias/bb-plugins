import { describe, expect, it } from "vitest";
import { STYLESHEET } from "../src/style";

const rules = STYLESHEET.replace(/\s+/g, " ");

describe("the glass panel's stylesheet", () => {
  it("draws an opaque popover first, the fallback wherever blur is missing", () => {
    expect(rules).toMatch(/^.*?\[data-thread-summary-card\] \{ border-radius: 16px; padding: 6px; background: var\(--popover\);/);
    expect(rules).toContain("border: 1px solid color-mix(in srgb, var(--foreground) 9%, transparent);");
    expect(rules).toContain("box-shadow: 0 12px 36px rgba(0, 0, 0, 0.18)");
  });

  it("turns to glass only where backdrop-filter is supported", () => {
    expect(rules).toContain(
      "@supports (backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px)) { [data-thread-summary-card] { background: color-mix(in srgb, var(--popover) 70%, transparent); -webkit-backdrop-filter: blur(18px) saturate(1.5); backdrop-filter: blur(18px) saturate(1.5); } }",
    );
  });

  it("goes back to the opaque popover when less transparency is asked for, after the glass", () => {
    const glass = rules.indexOf("@supports (backdrop-filter");
    const reduce = rules.indexOf(
      "@media (prefers-reduced-transparency: reduce) { [data-thread-summary-card] { background: var(--popover); -webkit-backdrop-filter: none; backdrop-filter: none; } }",
    );
    expect(glass).toBeGreaterThan(-1);
    expect(reduce).toBeGreaterThan(glass);
  });

  it("tints a line faintly on hover", () => {
    expect(rules).toContain("[data-thread-summary-line]:hover { background: color-mix(in srgb, var(--foreground) 5%, transparent); }");
  });
});
