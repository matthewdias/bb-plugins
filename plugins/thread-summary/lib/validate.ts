// The two fields this surface draws that the registry carries unchecked.
//
// `detail` and `open` are reserved by protocol v1 for "the first surface that
// draws them", which is this one, so this file is where their shapes are
// settled. The registry copies them as JSON and nothing more: a provider is
// another plugin, and what it hands over is checked here, field by field,
// before any of it becomes a link. A field that fails is dropped, not the row
// or the value around it, so one bad link does not hide a whole block.

export interface DetailRow {
  label: string;
  value?: string;
  tone?: string;
  icon?: string;
  /** Checked by `safeHref`: an http(s) URL or an app path. */
  href?: string;
  /** Checked by `safeFile`: relative to the thread's workspace. */
  file?: string;
}

export interface Detail {
  title?: string;
  rows: DetailRow[];
}

export interface Open {
  href: string;
}

const MAX_HREF_LENGTH = 2048;
const MAX_FILE_LENGTH = 1024;
const MAX_TEXT_LENGTH = 256;

/**
 * Whitespace, controls and backslashes, anywhere. Checked before anything
 * else, because a browser strips tabs and newlines out of a URL and reads a
 * backslash as a slash: `/\t/x` and `/\x` both arrive as `//x`, a link to
 * another host, though each looks like an app path with one leading slash.
 */
const UNSAFE_URL_CHARACTER = /[\s\u0000-\u001f\u007f-\u009f\\]/u;

/** Controls in a path: nothing a file name needs, and a way to fool a reader. */
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f-\u009f]/u;

/**
 * An http(s) URL, or an app path with exactly one leading `/`; `null` for
 * anything else. A link is rendered as a real anchor, so this is the whole of
 * what stands between a provider and the reader's click.
 */
export function safeHref(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > MAX_HREF_LENGTH) return null;
  if (UNSAFE_URL_CHARACTER.test(raw)) return null;
  if (raw.startsWith("/")) {
    // `//host` is protocol-relative: another site, not a page in bb.
    return raw.startsWith("//") ? null : raw;
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  return url.protocol === "http:" || url.protocol === "https:" ? raw : null;
}

/** A colon before the first separator: a scheme (`file:`), or a drive (`C:`). */
const SCHEME_OR_DRIVE = /^[^/\\]*:/u;

/**
 * A path inside the thread's workspace, or `null`. Absolute paths, schemes,
 * drive letters and any `..` segment are refused: a provider names a file the
 * thread has, never one outside it.
 *
 * So is a segment with whitespace at either end. Windows drops trailing
 * spaces from a path component, so `a/.. /x` is `..` there, and anything that
 * trims ` /etc/passwd` makes it absolute; no real file needs either.
 */
export function safeFile(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > MAX_FILE_LENGTH) return null;
  if (CONTROL_CHARACTER.test(raw)) return null;
  if (raw.startsWith("/") || raw.startsWith("\\") || SCHEME_OR_DRIVE.test(raw)) return null;
  const segments = raw.split(/[\\/]/u);
  if (segments.some((segment) => segment === ".." || segment !== segment.trim())) return null;
  return raw;
}

function text(raw: unknown): string | undefined {
  return typeof raw === "string" && raw.trim().length > 0 ? raw.slice(0, MAX_TEXT_LENGTH) : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readRow(raw: unknown): DetailRow | null {
  if (!isRecord(raw)) return null;
  const label = text(raw.label);
  if (label === undefined) return null;
  const row: DetailRow = { label };
  const value = text(raw.value);
  if (value !== undefined) row.value = value;
  const tone = text(raw.tone);
  if (tone !== undefined) row.tone = tone;
  const icon = text(raw.icon);
  if (icon !== undefined) row.icon = icon;
  const href = safeHref(raw.href);
  if (href !== null) row.href = href;
  const file = safeFile(raw.file);
  if (file !== null) row.file = file;
  return row;
}

/** A value's `detail`, checked, or `null` when it has none worth drawing. */
export function readDetail(value: unknown): Detail | null {
  if (!isRecord(value) || !isRecord(value.detail)) return null;
  const raw = value.detail;
  const rows = Array.isArray(raw.rows)
    ? raw.rows.map(readRow).filter((row): row is DetailRow => row !== null)
    : [];
  const title = text(raw.title);
  if (title === undefined && rows.length === 0) return null;
  return title === undefined ? { rows } : { title, rows };
}

/** A value's `open`, checked, or `null`. */
export function readOpen(value: unknown): Open | null {
  if (!isRecord(value) || !isRecord(value.open)) return null;
  const href = safeHref(value.open.href);
  return href === null ? null : { href };
}
