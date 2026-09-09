// Pulling `--flag value` pairs out of an argv.
//
// This exists because of a bug that already shipped once: the CLI strips the
// flags it knows and treats whatever is left as positional, so a flag it did
// not know about became an argument — `handoff <id> --new` read "--new" as the
// skill name and sent a prompt beginning "/--new". A boolean flag costs one
// entry in that filter; a flag that takes a value costs two, and getting the
// second one wrong is the same bug with an extra step.

export type TakenFlags = {
  /** Flag name without the leading dashes, mapped to its value. */
  values: Record<string, string>;
  /** Everything that was not a known flag or one of their values. */
  rest: string[];
  /** The first flag that was given with no value after it, if any. */
  missing: string | null;
};

/**
 * Remove `--name value` pairs, returning the values and what is left.
 *
 * The token after a known flag is taken as its value whatever it looks like,
 * including another flag. Guessing that `--model --json` means "no model" would
 * be a second rule to remember, and it is not the one `bb thread spawn`
 * follows.
 *
 * A repeated flag keeps the last value, so a wrapper script appending an
 * override to someone else's argv wins, which is the direction overrides
 * normally travel.
 */
export function takeValueFlags(
  argv: readonly string[],
  names: readonly string[],
): TakenFlags {
  const wanted = new Set(names.map((name) => `--${name}`));
  const values: Record<string, string> = {};
  const rest: string[] = [];
  let missing: string | null = null;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === undefined || !wanted.has(arg)) {
      if (arg !== undefined) rest.push(arg);
      continue;
    }
    const value = argv[i + 1];
    if (value === undefined) {
      // Reported rather than thrown: the caller turns it into an exit code and
      // a message naming the flag, which a throw here could not do as well.
      if (missing === null) missing = arg.slice(2);
      continue;
    }
    values[arg.slice(2)] = value;
    i += 1;
  }

  return { values, rest, missing };
}
