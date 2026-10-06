import { describe, expect, it } from "vitest";
import { summarizeSource, vetPrompt } from "../lib/source";

describe("a source summary", () => {
  it("shows the range a BB Community entry tracks, since bb resolves nothing more", () => {
    expect(
      summarizeSource({ kind: "git", url: "https://github.com/VladPolet/bb-plugin-thread-tags.git", range: "^0.1.0" }),
    ).toEqual({
      label: "github.com/VladPolet/bb-plugin-thread-tags @ ^0.1.0",
      url: "https://github.com/VladPolet/bb-plugin-thread-tags",
      exact: false,
    });
  });

  it("shows the exact tag and commit when bb resolved them", () => {
    const summary = summarizeSource({
      kind: "git",
      url: "https://github.com/acme/plugins.git",
      range: "*",
      tagPrefix: "notes/",
      subdir: "plugins/notes",
      resolvedTag: "notes/v1.2.0",
      resolvedCommit: "0123456789abcdef0123",
    });
    expect(summary.label).toBe("github.com/acme/plugins/plugins/notes @ notes/v1.2.0 (0123456789ab)");
    expect(summary.exact).toBe(true);
  });

  it("names a tag-prefixed range with its prefix", () => {
    expect(
      summarizeSource({ kind: "git", url: "https://github.com/a/b.git", range: "*", tagPrefix: "x/" }).label,
    ).toBe("github.com/a/b @ x/*");
  });

  it("handles npm sources", () => {
    expect(summarizeSource({ kind: "npm", package: "@acme/bb-plugin-x", range: "^1.0.0", resolvedVersion: "1.2.3" })).toEqual({
      label: "@acme/bb-plugin-x@1.2.3",
      url: "https://www.npmjs.com/package/@acme/bb-plugin-x",
      exact: true,
    });
  });
});

describe("the vet prompt", () => {
  it("names the plugin and its source, asks for a verdict, and says not to install", () => {
    const prompt = vetPrompt({
      displayName: "Thread Tags",
      entryId: "thread-tags",
      marketplaceDisplayName: "BB Community",
      author: "VladPolet",
      source: "git:https://github.com/VladPolet/bb-plugin-thread-tags.git@semver:^0.1.0",
      sourceLabel: "github.com/VladPolet/bb-plugin-thread-tags @ ^0.1.0",
      link: "https://getbb.app/marketplace/thread-tags",
    });
    expect(prompt).toContain('"Thread Tags" (thread-tags from BB Community, by VladPolet)');
    expect(prompt).toContain("Do not install it.");
    expect(prompt).toContain("Source: github.com/VladPolet/bb-plugin-thread-tags @ ^0.1.0");
    expect(prompt).toContain("Listing: https://getbb.app/marketplace/thread-tags");
    expect(prompt).toContain("verdict");
  });
});
