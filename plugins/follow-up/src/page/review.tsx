// Reviewing a pull request on its card: its files against the base branch, a
// comment on any line, and one message with all of them.
//
// The diff is bb's own, and the comments are drawn inside it, under the lines
// they are about (diff-rows.ts holds every assumption that takes). Where bb's
// diff is not shaped as that expects, a file falls back to a comment box
// under it that takes a line number: the same comments, less neatly placed.
//
// A comment is a draft, kept while bb stays open, until Request changes puts
// them all in one message. That message is shown in a box first, like every
// message the page sends (lib/review.ts composes it).
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { experimental_Diff as Diff, useBbNavigate, useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../../server";
import {
  lineAt,
  orderComments,
  REVIEW_COMMENT_MAX,
  reviewGaps,
  reviewMessage,
  type LineComment,
  type ReviewDiff,
  type ReviewFile,
} from "../../lib/review.ts";
import type { Card } from "../../lib/page.ts";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import { findDiff, placeRows, removeRows, rowAtGutter, type Anchor, type DiffParts, type DiffRow } from "./diff-rows.ts";

// --- drafts -----------------------------------------------------------------------

/** Comments not yet sent, by thread and pull request. Module scope, so leaving the page keeps them. */
const drafts = new Map<string, LineComment[]>();
const listeners = new Set<() => void>();
const NONE: LineComment[] = [];
let nextId = 0;

const draftKey = (threadId: string, prNumber: number) => `${threadId}:${prNumber}`;

function setDrafts(key: string, comments: LineComment[]): void {
  if (comments.length === 0) drafts.delete(key);
  else drafts.set(key, comments);
  for (const listener of listeners) listener();
}

/** Forget a pull request's drafts, once they have been sent. */
export function clearReviewDrafts(threadId: string, prNumber: number): void {
  setDrafts(draftKey(threadId, prNumber), []);
}

function useDrafts(key: string): LineComment[] {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => drafts.get(key) ?? NONE,
    () => NONE,
  );
}

// --- the panel --------------------------------------------------------------------

/** How many files start open; the rest open when pressed. */
const OPEN_AT_FIRST = 3;
/** How long bb's diff has to appear before a file falls back to the plain comment box. */
const DIFF_WAIT_MS = 1500;

type Loaded = { kind: "loading" } | { kind: "ok"; diff: ReviewDiff } | { kind: "none" } | { kind: "unavailable" };

export function Review({
  card,
  pr,
  onRequest,
  onClose,
}: {
  card: Card;
  pr: { number: number; title: string; url: string };
  /** Open the message box with this text; nothing is sent from here. */
  onRequest: (message: string) => void;
  onClose: () => void;
}) {
  const rpc = useRpc<typeof rpcContract>();
  const navigate = useBbNavigate();
  // Read once per pull request, whatever the client's identity does between renders.
  const rpcRef = useRef(rpc);
  rpcRef.current = rpc;
  const key = draftKey(card.threadId, pr.number);
  const comments = useDrafts(key);
  const [loaded, setLoaded] = useState<Loaded>({ kind: "loading" });
  const [open, setOpen] = useState<ReadonlySet<string> | null>(null);

  useEffect(() => {
    let gone = false;
    void (async () => {
      try {
        const result = await rpcRef.current.call("page_pr_diff", { threadId: card.threadId });
        if (gone) return;
        if (result.outcome === "ok" && result.diff !== null) {
          setLoaded({ kind: "ok", diff: result.diff });
          setOpen(new Set(result.diff.files.slice(0, OPEN_AT_FIRST).map((file) => file.path)));
        } else setLoaded({ kind: result.outcome === "none" ? "none" : "unavailable" });
      } catch {
        if (!gone) setLoaded({ kind: "unavailable" });
      }
    })();
    return () => {
      gone = true;
    };
  }, [card.threadId, pr.number]);

  const add = useCallback(
    (comment: Omit<LineComment, "id">) => setDrafts(key, [...(drafts.get(key) ?? []), { ...comment, id: `c${(nextId += 1)}` }]),
    [key],
  );
  const edit = useCallback(
    (id: string, body: string) => setDrafts(key, (drafts.get(key) ?? []).map((entry) => (entry.id === id ? { ...entry, body } : entry))),
    [key],
  );
  const remove = useCallback((id: string) => setDrafts(key, (drafts.get(key) ?? []).filter((entry) => entry.id !== id)), [key]);

  if (loaded.kind !== "ok") {
    return (
      <div className="flex items-center gap-2 rounded-md border border-border px-2.5 py-2 text-xs text-muted-foreground">
        {loaded.kind === "loading" ? (
          <Icon name="Spinner" className="size-3.5 animate-spin" aria-label="Loading the changes" />
        ) : (
          <span className="flex-1">
            {loaded.kind === "none" ? "There are no changes to read on this thread's worktree." : "The changes could not be read here. They are on GitHub."}
          </span>
        )}
        {loaded.kind !== "loading" && (
          <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={onClose}>
            Close
          </Button>
        )}
      </div>
    );
  }

  const { diff } = loaded;
  const gaps = reviewGaps(diff);
  const paths = diff.files.map((file) => file.path);
  const ordered = orderComments(comments, paths);
  const toggle = (path: string) => {
    const next = new Set(open ?? []);
    if (!next.delete(path)) next.add(path);
    setOpen(next);
  };

  return (
    <section aria-label={`Changes in #${pr.number}`} className="flex min-w-0 flex-col gap-1.5">
      {/* Said before anything else: reading part of a change is not reviewing it. */}
      {gaps !== null && (
        <p role="alert" className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md border border-amber-500/60 bg-amber-500/10 px-2.5 py-1.5 text-xs text-foreground">
          <Icon name="AlertTriangle" className="size-3.5 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
          <span className="min-w-0 flex-1">
            This is not the whole change.{" "}
            {[
              gaps.more > 0 ? (gaps.more === 1 ? "1 more file is not shown" : `${gaps.more} more files are not shown`) : null,
              gaps.cut > 0 ? (gaps.cut === 1 ? "1 file is cut short or not shown" : `${gaps.cut} files are cut short or not shown`) : null,
              gaps.partial ? "bb listed only part of it" : null,
            ]
              .filter((part): part is string => part !== null)
              .join(", ")}
            . Read the rest on GitHub before you merge.
          </span>
          <Button size="sm" variant="outline" className="h-6 px-2 text-xs" onClick={() => navigate.openUrl(pr.url)}>
            GitHub
            <Icon name="ArrowUpRight" className="size-3" aria-hidden />
          </Button>
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        {diff.files.length === 1 ? "1 file" : `${diff.files.length} files`} against <span className="font-mono">{diff.base}</span>, as committed in the
        thread's worktree. That can be ahead of or behind what is pushed: GitHub has what will merge. Press a line's number to comment on it.
      </p>
      {diff.files.map((file) => (
        <ReviewFileView
          key={file.path}
          file={file}
          open={open?.has(file.path) === true}
          onToggle={() => toggle(file.path)}
          comments={comments.filter((comment) => comment.path === file.path)}
          onAdd={add}
          onEdit={edit}
          onRemove={remove}
        />
      ))}
      {diff.more > 0 && (
        <p className="text-xs text-muted-foreground">
          {diff.more === 1 ? "1 more file is" : `${diff.more} more files are`} not shown here. They are on GitHub.
        </p>
      )}
      <div className="flex flex-wrap items-center gap-1.5 pt-1">
        <Button size="sm" disabled={ordered.length === 0} onClick={() => onRequest(reviewMessage(pr, ordered))}>
          Request changes{ordered.length > 0 ? ` (${ordered.length})` : ""}
        </Button>
        <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={onClose}>
          Close the changes
        </Button>
        {ordered.length > 0 && <span className="text-xs text-muted-foreground">Comments are kept until you send them.</span>}
      </div>
    </section>
  );
}

// --- one file ---------------------------------------------------------------------

type Mode = "waiting" | "inline" | "plain";

/** bb's diff under `wrapper`, once it is there; "plain" when it never is, or is not as expected. */
function useDiffParts(wrapper: React.RefObject<HTMLDivElement | null>, active: boolean): { mode: Mode; parts: DiffParts | null } {
  const [found, setFound] = useState<{ mode: Mode; parts: DiffParts | null }>({ mode: "waiting", parts: null });
  useEffect(() => {
    if (!active) {
      setFound({ mode: "waiting", parts: null });
      return;
    }
    let stopped = false;
    const started = Date.now();
    const look = () => {
      if (stopped || wrapper.current === null) return;
      const parts = findDiff(wrapper.current);
      if (parts !== null) setFound({ mode: "inline", parts });
      else if (Date.now() - started >= DIFF_WAIT_MS) setFound({ mode: "plain", parts: null });
      else timer = setTimeout(look, 100);
    };
    let timer: ReturnType<typeof setTimeout> | null = null;
    look();
    return () => {
      stopped = true;
      if (timer !== null) clearTimeout(timer);
    };
  }, [wrapper, active]);
  return found;
}

function ReviewFileView({
  file,
  open,
  onToggle,
  comments,
  onAdd,
  onEdit,
  onRemove,
}: {
  file: ReviewFile;
  open: boolean;
  onToggle: () => void;
  comments: LineComment[];
  onAdd: (comment: Omit<LineComment, "id">) => void;
  onEdit: (id: string, body: string) => void;
  onRemove: (id: string) => void;
}) {
  const wrapper = useRef<HTMLDivElement | null>(null);
  const readable = file.patch !== "";
  const { mode, parts } = useDiffParts(wrapper, open && readable);
  const [composing, setComposing] = useState<DiffRow | null>(null);
  const [holders, setHolders] = useState<ReadonlyMap<string, HTMLElement>>(new Map());

  const anchors: Anchor[] = [
    ...comments.map((comment) => ({ key: comment.id, side: comment.side, line: comment.line, text: comment.text })),
    ...(composing === null ? [] : [{ key: "new", side: composing.side, line: composing.line }]),
  ];
  // The rows are placed again when the anchors change, not on every render:
  // placing them sets state, and a fresh array each render would never settle.
  const anchorsRef = useRef(anchors);
  anchorsRef.current = anchors;
  const anchored = anchors.map((anchor) => `${anchor.key}:${anchor.side}:${anchor.line}:${anchor.text ?? ""}`).join("|");

  // Place the rows, and place them again whenever bb redraws its diff.
  useEffect(() => {
    if (parts === null) {
      setHolders(new Map());
      return;
    }
    let observer: MutationObserver | null = null;
    const place = () => {
      observer?.disconnect();
      const current = wrapper.current === null ? null : findDiff(wrapper.current);
      setHolders(current === null ? new Map() : placeRows(current, anchorsRef.current));
      observer?.observe(parts.root, { childList: true, subtree: true });
    };
    observer = new MutationObserver(place);
    place();
    const pick = (event: Event) => {
      const current = wrapper.current === null ? null : findDiff(wrapper.current);
      const row = current === null ? null : rowAtGutter(current, event);
      if (row !== null) setComposing(row);
    };
    parts.root.addEventListener("click", pick);
    return () => {
      observer?.disconnect();
      parts.root.removeEventListener("click", pick);
      removeRows(parts);
    };
  }, [parts, anchored]);

  const save = (body: string) => {
    if (composing === null) return;
    onAdd({ path: file.path, side: composing.side, line: composing.line, text: composing.text, body });
    setComposing(null);
  };
  // Comments whose line the diff does not show (or every one, in the plain view) go under the file.
  const under = comments.filter((comment) => !holders.has(comment.id));

  return (
    <div className="overflow-hidden rounded-md border border-border">
      <button type="button" aria-expanded={open} onClick={onToggle} className="flex w-full items-center gap-2 bg-muted/50 px-2.5 py-1 text-left text-xs hover:bg-state-hover">
        <Icon name={open ? "ChevronDown" : "ChevronRight"} className="size-3 shrink-0" aria-hidden />
        <span className="min-w-0 flex-1 break-all font-mono text-foreground">
          {file.previousPath !== null && <>{file.previousPath} → </>}
          {file.path}
        </span>
        {file.cut && <span className="shrink-0 rounded bg-amber-500/10 px-1.5 text-amber-700 dark:text-amber-300">partial</span>}
        {comments.length > 0 && <span className="shrink-0 rounded bg-sky-500/10 px-1.5 text-sky-700 dark:text-sky-300">{comments.length}</span>}
        <span className="shrink-0 tabular-nums text-emerald-600 dark:text-emerald-400">+{file.additions}</span>
        <span className="shrink-0 tabular-nums text-destructive">−{file.deletions}</span>
      </button>
      {open && (
        <div className="flex flex-col">
          {!readable ? (
            <p className="px-2.5 py-1.5 text-xs text-muted-foreground">{file.binary ? "A binary file." : "Too large to show here. It is on GitHub."}</p>
          ) : (
            <div ref={wrapper} className="max-h-[32rem] overflow-auto">
              <Diff patch={file.patch} path={file.path} view="unified" />
            </div>
          )}
          {file.cut && readable && <p className="border-t border-border px-2.5 py-1 text-xs text-muted-foreground">The rest of this file's changes are on GitHub.</p>}
          {[...holders].map(([key, holder]) => {
            const comment = comments.find((entry) => entry.id === key);
            return createPortal(
              comment !== undefined ? (
                <CommentRow comment={comment} onEdit={onEdit} onRemove={onRemove} />
              ) : (
                <Composer label={composing === null ? "" : `Comment on line ${composing.line}`} onSave={save} onCancel={() => setComposing(null)} />
              ),
              holder,
              key,
            );
          })}
          {readable && (under.length > 0 || mode === "plain") && (
            <div className="flex flex-col gap-1.5 border-t border-border px-2.5 py-2">
              {under.map((comment) => (
                <CommentRow
                  key={comment.id}
                  comment={comment}
                  onEdit={onEdit}
                  onRemove={onRemove}
                  showLine
                  changed={lineAt(file.patch, comment.side, comment.line)?.text.trim() !== comment.text.trim()}
                />
              ))}
              {mode === "plain" && <PlainComposer file={file} onAdd={onAdd} />}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// --- comments ---------------------------------------------------------------------

const fieldClass =
  "w-full resize-y rounded-md border border-border bg-background px-2.5 py-1.5 text-sm text-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring";

function Shell({ children }: { children: ReactNode }) {
  // Drawn inside bb's diff, whose rows are code: set the type back to the page's.
  return <div className="my-1 flex flex-col gap-1.5 rounded-md border border-sky-500/50 bg-card px-2.5 py-2 font-sans text-sm text-foreground">{children}</div>;
}

function Composer({ label, onSave, onCancel }: { label: string; onSave: (body: string) => void; onCancel: () => void }) {
  const [body, setBody] = useState("");
  return (
    <Shell>
      <textarea
        autoFocus
        rows={2}
        value={body}
        maxLength={REVIEW_COMMENT_MAX}
        aria-label={label}
        placeholder="What should change here?"
        onChange={(event) => setBody(event.target.value)}
        className={fieldClass}
      />
      <div className="flex gap-1.5">
        <Button size="sm" className="h-7 px-2 text-xs" disabled={body.trim() === ""} onClick={() => onSave(body.trim())}>
          Add comment
        </Button>
        <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </Shell>
  );
}

function CommentRow({
  comment,
  onEdit,
  onRemove,
  showLine = false,
  changed = false,
}: {
  comment: LineComment;
  onEdit: (id: string, body: string) => void;
  onRemove: (id: string) => void;
  /** Under the file rather than under its line: say which line, and quote it. */
  showLine?: boolean;
  /** The changes no longer show this line reading as it did when the comment was written. */
  changed?: boolean;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  return (
    <Shell>
      {showLine && (
        <p className="min-w-0 text-xs text-muted-foreground">
          Line {comment.line}
          {comment.side === "old" ? " (removed)" : ""}: <span className="break-all font-mono text-foreground">{comment.text.trim() === "" ? "(blank line)" : comment.text.trim()}</span>
          {changed && <span className="ml-1.5 text-amber-700 dark:text-amber-300">That line has changed since, or is not in the changes shown.</span>}
        </p>
      )}
      {editing === null ? (
        <>
          <p className="whitespace-pre-wrap break-words">{comment.body}</p>
          <div className="flex gap-1.5">
            <Button size="sm" variant="ghost" className="h-6 px-2 text-xs text-muted-foreground" onClick={() => setEditing(comment.body)}>
              Edit
            </Button>
            <Button size="sm" variant="ghost" className="h-6 px-2 text-xs text-muted-foreground" onClick={() => onRemove(comment.id)}>
              Remove
            </Button>
          </div>
        </>
      ) : (
        <>
          <textarea rows={2} value={editing} maxLength={REVIEW_COMMENT_MAX} aria-label={`Edit the comment on line ${comment.line}`} onChange={(event) => setEditing(event.target.value)} className={fieldClass} />
          <div className="flex gap-1.5">
            <Button
              size="sm"
              className="h-7 px-2 text-xs"
              disabled={editing.trim() === ""}
              onClick={() => {
                onEdit(comment.id, editing.trim());
                setEditing(null);
              }}
            >
              Save
            </Button>
            <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setEditing(null)}>
              Cancel
            </Button>
          </div>
        </>
      )}
    </Shell>
  );
}

/** The comment box under a file, for when its diff takes no rows: a line number, then the comment. */
function PlainComposer({ file, onAdd }: { file: ReviewFile; onAdd: (comment: Omit<LineComment, "id">) => void }) {
  const [line, setLine] = useState("");
  const [body, setBody] = useState("");
  const number = Number(line);
  const found = line.trim() !== "" && Number.isInteger(number) ? lineAt(file.patch, "new", number) : null;
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-xs text-muted-foreground">Comments can't be placed inside this diff, so give the line.</p>
      <div className="flex flex-wrap items-start gap-1.5">
        <input
          type="text"
          inputMode="numeric"
          value={line}
          aria-label={`Line in ${file.path}`}
          placeholder="Line"
          onChange={(event) => setLine(event.target.value)}
          className={cn(fieldClass, "w-20 resize-none")}
        />
        <textarea rows={1} value={body} maxLength={REVIEW_COMMENT_MAX} aria-label={`Comment on ${file.path}`} placeholder="What should change there?" onChange={(event) => setBody(event.target.value)} className={cn(fieldClass, "min-w-0 flex-1")} />
        <Button
          size="sm"
          className="h-8 px-2 text-xs"
          disabled={found === null || body.trim() === ""}
          onClick={() => {
            if (found === null) return;
            onAdd({ path: file.path, side: "new", line: number, text: found.text, body: body.trim() });
            setLine("");
            setBody("");
          }}
        >
          Add comment
        </Button>
      </div>
      {line.trim() !== "" && found === null && <p className="text-xs text-muted-foreground">The changes shown don't include that line of the new file.</p>}
    </div>
  );
}
