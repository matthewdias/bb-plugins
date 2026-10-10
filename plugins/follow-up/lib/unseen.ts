// Characters that draw nothing, and what to do about text that holds one.
//
// Pure, and on its own so both the page's approvals (page.ts) and the agent's
// forms (ask.ts) can use it without importing each other.

/**
 * Characters that draw nothing, or change how what is around them draws: the
 * set next steps refuse (lib/next-steps.ts), less the newline and tab that a
 * command or a plan legitimately holds. A bidi override can make a command
 * read differently from what runs, and a zero-width character can hide part
 * of a path, so in an approval each is shown, as ⟦U+202E⟧, never dropped.
 */
const UNSEEN = /[\p{Cc}\p{Cf}\p{Co}\p{Cn}\p{Zl}\p{Zp}\p{Default_Ignorable_Code_Point}]/u;
const PICTOGRAPH = /[\p{Extended_Pictographic}\p{Emoji_Modifier}]/u;

/** Whether the character at `index` (of code points) draws nothing. */
function unseenAt(chars: readonly string[], index: number): boolean {
  const char = chars[index]!;
  if (char === "\n" || char === "\t" || !UNSEEN.test(char)) return false;
  // An emoji is drawn with these: a variation selector after a pictograph,
  // and a joiner between two, belong to a symbol that does show.
  const before = chars[index - 1] ?? "";
  const after = chars[index + 1] ?? "";
  if ((char === "\uFE0F" || char === "\uFE0E") && PICTOGRAPH.test(before)) return false;
  if (char === "\u200D" && PICTOGRAPH.test(after)) {
    return !(PICTOGRAPH.test(before) || (before === "\uFE0F" && PICTOGRAPH.test(chars[index - 2] ?? "")));
  }
  return true;
}

/** Text with every unseen character shown as ⟦U+XXXX⟧. */
export function reveal(text: string): string {
  const chars = [...text];
  return chars
    .map((char, index) =>
      unseenAt(chars, index) ? `⟦U+${char.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}⟧` : char,
    )
    .join("");
}

/** Whether any string anywhere in a value holds an unseen character. */
export function hasUnseen(value: unknown): boolean {
  if (typeof value === "string") {
    const chars = [...value];
    return chars.some((_, index) => unseenAt(chars, index));
  }
  if (Array.isArray(value)) return value.some(hasUnseen);
  return typeof value === "object" && value !== null && Object.values(value).some(hasUnseen);
}
