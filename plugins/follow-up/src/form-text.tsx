// A form's text, drawn from what lib/form-text.ts read: paragraphs, headings,
// lists, quotes, code, strong, emphasis and links. Nothing here can draw an
// image or raw HTML, which is the point; see that file for why a form's text
// is not given to bb's Markdown renderer.
import type { ReactNode } from "react";
import { useBbNavigate } from "@get-bb/plugin-sdk/app";
import { readFormText, type Inline } from "../lib/form-text.ts";
import { cn } from "@/lib/utils";

function Spans({ inline }: { inline: readonly Inline[] }): ReactNode {
  const navigate = useBbNavigate();
  return inline.map((span, index) => {
    switch (span.kind) {
      case "text":
        return <span key={index}>{span.text}</span>;
      case "code":
        return (
          <code key={index} className="rounded bg-muted px-1 py-px font-mono text-[0.92em]">
            {span.text}
          </code>
        );
      case "strong":
        return (
          <strong key={index} className="font-semibold">
            <Spans inline={span.children} />
          </strong>
        );
      case "em":
        return (
          <em key={index}>
            <Spans inline={span.children} />
          </em>
        );
      case "link":
        return (
          // Through bb, so it opens where the browser preference says, and
          // only when pressed. The address shows on hover: the words are the
          // agent's and the destination is what matters.
          <button key={index} type="button" title={span.url} className="inline text-left underline underline-offset-2 hover:text-foreground" onClick={() => navigate.openUrl(span.url)}>
            <Spans inline={span.children} />
          </button>
        );
    }
  });
}

export function FormText({ text, className }: { text: string; className?: string }) {
  const blocks = readFormText(text);
  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5 break-words", className)} data-form-text="">
      {blocks.map((block, index) => {
        switch (block.kind) {
          case "paragraph":
            return (
              <p key={index}>
                <Spans inline={block.inline} />
              </p>
            );
          case "heading":
            return (
              <p key={index} className="font-semibold text-foreground">
                <Spans inline={block.inline} />
              </p>
            );
          case "code":
            return (
              <pre key={index} className="overflow-x-auto rounded-md border border-border bg-muted/50 px-2.5 py-1.5 font-mono text-xs text-foreground">
                {block.text}
              </pre>
            );
          case "quote":
            return (
              <blockquote key={index} className="border-l-2 border-border pl-2.5 text-muted-foreground">
                <Spans inline={block.inline} />
              </blockquote>
            );
          case "list": {
            const List = block.ordered ? "ol" : "ul";
            return (
              <List key={index} className={cn("flex flex-col gap-0.5 pl-5", block.ordered ? "list-decimal" : "list-disc")}>
                {block.items.map((item, at) => (
                  <li key={at}>
                    <Spans inline={item} />
                  </li>
                ))}
              </List>
            );
          }
        }
      })}
    </div>
  );
}
