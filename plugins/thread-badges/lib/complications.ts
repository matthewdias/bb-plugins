// Complications: small values one plugin provides and another draws.
//
// VENDORED. This file is copied byte for byte into every plugin in this
// repository that provides or draws a complication, and
// `scripts/check-vendored.mjs` fails the repository check when the copies
// drift. Copying is how it ships, not how it runs: bb bundles each plugin's
// dependencies into that plugin, so a published npm package would still put
// one copy in every bundle. A package would add versioning for plugins outside
// this repository; a workspace-only one would not install at all, because bb
// installs each plugin from its own subdirectory.
//
// The registry lives on `globalThis`, under a versioned symbol. bb imports
// every plugin's frontend bundle into the same document — a plain
// `import(url)`, with no iframe, worker or realm between them — so this is the
// one place two bundles meet without a server round trip. It is also the one
// place that is live across plugins: realtime delivers a plugin only its own
// signals, so a provider that hears its own change can tell everyone else here.
//
// Whichever bundle loads first creates the registry, and every later bundle
// uses that object, methods included. An older copy's code may therefore be
// the one answering a newer copy's calls, depending only on which plugin
// loaded first. Three rules follow, and they are what "protocol v1" means:
//
// - Behaviour is frozen. `provide`, `want`, `read`, `isProvided`, `subscribe`,
//   `providers` and `subscribeProviders` keep exactly these semantics under
//   this symbol. A new method or a changed meaning is a new symbol.
// - The schema is not. The registry validates the fields it names and carries
//   every other JSON-safe field across untouched, so a field added later
//   reaches surfaces even through an older copy. A surface must check any
//   field this file does not name before it draws it.
// - Which copy is running is never a guess. Bump `COMPLICATIONS_IMPLEMENTATION`
//   with any change to this file's behaviour, fixes included. The registry
//   reports the number of the copy that created it, and a newer copy that
//   finds an older one in charge says so, once, in the console: its fix does
//   not apply until every plugin carrying the older copy updates.

export const COMPLICATIONS_PROTOCOL = 1 as const;

/** This copy's implementation. Bump it with any change in behaviour. */
export const COMPLICATIONS_IMPLEMENTATION = 1;

const REGISTRY_KEY = Symbol.for("bb-community.complications.v1");

/** The largest value the registry carries, in characters of its JSON. */
export const MAX_VALUE_LENGTH = 4096;

/** `<pluginId>/<name>`, each lowercase letters, digits and single dashes. */
const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*\/[a-z0-9]+(?:-[a-z0-9]+)*$/;

const MAX_KIND_LENGTH = 64;
const MAX_SUBJECT_ID_LENGTH = 2048;
const MAX_TONE_LENGTH = 32;

/**
 * What a complication is about. The registry checks only the shape: `kind` is
 * open, and `id` is opaque.
 *
 * Kinds in use: `thread`, `project`, `environment`, `app`, `url`, `message`,
 * `file`. A singleton has an empty id — `{ kind: "app", id: "" }`. Each kind's
 * canonical id is a convention between its providers and surfaces, not the
 * registry's business: a `url` is `new URL(…).href`, so a trailing slash or a
 * capitalised host cannot split one link into two subjects.
 */
export interface ComplicationSubject {
  kind: string;
  id: string;
}

/**
 * The tones every surface understands. A tone is an open string: a surface
 * draws one it does not know as `default`, so adding one costs nothing.
 * `running` is the one with behaviour — bb animates it.
 */
export type ComplicationTone = "default" | "info" | "success" | "warning" | "error" | "running";

/**
 * One value that can be read at a glance. Data, not a component: the surface
 * draws it, in whichever size its slot has room for, and a surface outside bb
 * can draw it too. Smallest to largest: a glyph (`icon`, `tone`), inline
 * (`text`), a gauge (`fraction`).
 *
 * Fields not named here pass through the registry as JSON; read them with care.
 * Two names are reserved for what no surface draws yet: `detail`, the large
 * size a card or hover shows, and `open`, where clicking goes. Their shapes
 * will be settled by the first surface that draws them, so the registry does
 * not check them — a surface must, before it draws one, and an `href` above
 * all.
 */
export interface ComplicationValue {
  /** A bb icon name: a built-in glyph, or a namespaced `"<pluginId>/<name>"`. */
  readonly icon: string;
  /** Accessible label and tooltip. Required: a glyph alone is not a sentence. */
  readonly label: string;
  readonly tone?: ComplicationTone | (string & {});
  /** A few characters beside the glyph — a count, a port, a percentage. */
  readonly text?: string;
  /** Progress from 0 to 1. Present, it makes the value a gauge. */
  readonly fraction?: number;
}

export interface ComplicationProviderRegistration {
  /** `"<pluginId>/<name>"`. One provider per id; a second replaces the first. */
  id: string;
  /** What the settings list calls it: "Follow-up progress". */
  name: string;
  description?: string;
  /** The subject kinds it answers, so a slot offers it only where it can speak. */
  subjects?: readonly string[];
  /** A representative value, for previews in settings. */
  sample?: ComplicationValue;
  /**
   * Subjects that have just become wanted, batched per microtask — including,
   * just after registering, every subject that was wanted before the provider
   * loaded. Answer with the handle's `set`, now or later.
   */
  onWanted?: (subjects: readonly ComplicationSubject[]) => void;
}

/** A provider as `providers()` lists it: the registration without its callback. */
export interface ComplicationProviderInfo {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly subjects?: readonly string[];
  readonly sample?: ComplicationValue;
}

export interface ComplicationProviderHandle {
  /** Publish a value, or `null` for "nothing to say". Ignored once withdrawn. */
  set(subject: ComplicationSubject, value: ComplicationValue | null): void;
  /** Whether any surface currently wants this subject. */
  isWanted(subject: ComplicationSubject): boolean;
  /** Every subject currently wanted. */
  wanted(): ComplicationSubject[];
  /**
   * Withdraw, clearing every value this provider set. Idempotent, and a no-op
   * once another registration has replaced this one, so a hot reload's late
   * cleanup cannot wipe the generation that replaced it.
   */
  dispose(): void;
}

export interface ComplicationsRegistry {
  readonly protocol: typeof COMPLICATIONS_PROTOCOL;
  /**
   * `COMPLICATIONS_IMPLEMENTATION` of the copy that created this registry —
   * the copy whose code every plugin in the window is running.
   */
  readonly implementation: number;
  /** Throws on a malformed id or a blank name: those are bugs in the caller. */
  provide(registration: ComplicationProviderRegistration): ComplicationProviderHandle;
  /** Say that a surface needs this value. Returns the release. */
  want(id: string, subject: ComplicationSubject): () => void;
  /**
   * `undefined` until a provider has answered for this subject, `null` once it
   * has said there is nothing to show. The object is stable until it changes,
   * so it is safe as a `useSyncExternalStore` snapshot.
   */
  read(id: string, subject: ComplicationSubject): ComplicationValue | null | undefined;
  isProvided(id: string): boolean;
  /** A value's changes, or with a `null` subject, that provider coming and going. */
  subscribe(id: string, subject: ComplicationSubject | null, listener: () => void): () => void;
  /** Every live provider. The array is stable until one comes, goes or is replaced. */
  providers(): readonly ComplicationProviderInfo[];
  subscribeProviders(listener: () => void): () => void;
}

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonBlank(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isSubject(value: unknown): value is ComplicationSubject {
  return (
    isRecord(value) &&
    isNonBlank(value.kind) &&
    value.kind.length <= MAX_KIND_LENGTH &&
    typeof value.id === "string" &&
    value.id.length <= MAX_SUBJECT_ID_LENGTH
  );
}

/** JSON, so no choice of separator can make two subjects collide. */
function subjectKey(subject: ComplicationSubject): string {
  return JSON.stringify([subject.kind, subject.id]);
}

/** Own data properties only: `__proto__` must stay a key, not become a prototype. */
function put(into: Record<string, unknown>, key: string, value: unknown): void {
  Object.defineProperty(into, key, { value, enumerable: true, writable: true, configurable: true });
}

/** A JSON-safe deep copy, or `undefined` when there is none: a function, a cycle, a BigInt. */
function jsonCopy(value: unknown): Json | undefined {
  try {
    // `JSON.stringify` gives `undefined` for a function, a symbol or
    // `undefined` itself, and throws for a cycle or a BigInt.
    const text = JSON.stringify(value);
    return text === undefined ? undefined : (JSON.parse(text) as Json);
  } catch {
    return undefined;
  }
}

/**
 * Carry across every field `known` does not name, each only if it survives as
 * JSON. This is the half of the protocol that lets the schema grow.
 */
function passThrough(
  raw: Record<string, unknown>,
  known: ReadonlySet<string>,
  into: Record<string, unknown>,
): void {
  for (const key of Object.keys(raw)) {
    if (known.has(key)) continue;
    const copy = jsonCopy(raw[key]);
    if (copy !== undefined) put(into, key, copy);
  }
}

function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null) {
    for (const key of Object.keys(value)) deepFreeze((value as Record<string, unknown>)[key]);
    Object.freeze(value);
  }
  return value;
}

function normalizeTone(raw: unknown): string | undefined {
  return isNonBlank(raw) && raw.length <= MAX_TONE_LENGTH ? raw : undefined;
}

const VALUE_KNOWN: ReadonlySet<string> = new Set(["icon", "label", "tone", "text", "fraction"]);
const REGISTRATION_KNOWN: ReadonlySet<string> = new Set([
  "id",
  "name",
  "description",
  "subjects",
  "sample",
  "onWanted",
]);

/**
 * The value as the registry stores it, with its JSON for comparison, or
 * `undefined` when it is not a value at all.
 *
 * Named fields are checked: a bad required one rejects the value, a bad
 * optional one is dropped. Other fields are copied as JSON. Copying rather
 * than keeping the provider's object is the point — the provider is another
 * plugin, and what it handed over must not change under a surface drawing it.
 */
function normalize(value: unknown): { value: ComplicationValue; json: string } | null | undefined {
  if (value === null) return null;
  if (!isRecord(value)) return undefined;
  try {
    if (!isNonBlank(value.icon) || !isNonBlank(value.label)) return undefined;
    const next: Record<string, unknown> = { icon: value.icon, label: value.label };
    const tone = normalizeTone(value.tone);
    if (tone !== undefined) next.tone = tone;
    if (isNonBlank(value.text)) next.text = value.text;
    if (typeof value.fraction === "number" && Number.isFinite(value.fraction)) {
      next.fraction = Math.min(1, Math.max(0, value.fraction));
    }
    passThrough(value, VALUE_KNOWN, next);
    const json = JSON.stringify(next);
    if (json.length > MAX_VALUE_LENGTH) return undefined;
    return { value: deepFreeze(next) as unknown as ComplicationValue, json };
  } catch {
    // A getter that throws, a proxy that lies: not a value.
    return undefined;
  }
}

/** Exported for tests: what `set` would store, or `undefined` for "refused". */
export function normalizeValue(value: unknown): ComplicationValue | null | undefined {
  const normalized = normalize(value);
  return normalized === null ? null : normalized?.value;
}

/** The registration as `providers()` lists it. Throws on what is a caller's bug. */
function describe(registration: ComplicationProviderRegistration): ComplicationProviderInfo {
  const raw = registration as unknown as Record<string, unknown>;
  if (typeof raw.id !== "string" || !ID_PATTERN.test(raw.id)) {
    throw new TypeError(
      `complications: provider id ${JSON.stringify(raw.id)} is not "<pluginId>/<name>"`,
    );
  }
  if (!isNonBlank(raw.name)) {
    throw new TypeError(`complications: provider ${raw.id} needs a name`);
  }
  const info: Record<string, unknown> = { id: raw.id, name: raw.name };
  if (isNonBlank(raw.description)) info.description = raw.description;
  if (Array.isArray(raw.subjects)) {
    info.subjects = raw.subjects.filter(
      (kind): kind is string => isNonBlank(kind) && kind.length <= MAX_KIND_LENGTH,
    );
  }
  const sample = normalizeValue(raw.sample);
  if (sample != null) info.sample = sample;
  passThrough(raw, REGISTRATION_KNOWN, info);
  return deepFreeze(info) as unknown as ComplicationProviderInfo;
}

/**
 * Run another plugin's code without letting it take this one down. A listener
 * belongs to whichever surface subscribed and a callback to whichever plugin
 * provided; a throw in either would otherwise land in the caller's commit.
 */
function contain(run: () => void): void {
  try {
    run();
  } catch (error) {
    console.error("[complications]", error);
  }
}

/** Exported for tests. Plugins use `getComplications`. */
export function createRegistry(): ComplicationsRegistry {
  const providers = new Map<
    string,
    {
      token: object;
      info: ComplicationProviderInfo;
      onWanted: ComplicationProviderRegistration["onWanted"];
    }
  >();
  const values = new Map<string, Map<string, { value: ComplicationValue | null; json: string }>>();
  const wants = new Map<string, Map<string, { subject: ComplicationSubject; count: number }>>();
  const listeners = new Map<string, Set<() => void>>();
  const providerListeners = new Set<() => void>();
  /** Newly wanted subjects not yet delivered, by complication id. */
  const fresh = new Map<string, Map<string, ComplicationSubject>>();
  let flushQueued = false;
  let providerList: readonly ComplicationProviderInfo[] | null = null;

  const valueKey = (id: string, key: string) => `${id}\n${key}`;
  const presenceKey = (id: string) => `${id}\n`;

  function notify(key: string): void {
    const set = listeners.get(key);
    if (set === undefined) return;
    for (const listener of [...set]) contain(listener);
  }

  function providersChanged(id: string): void {
    providerList = null;
    notify(presenceKey(id));
    for (const listener of [...providerListeners]) contain(listener);
  }

  function isWanted(id: string, subject: ComplicationSubject): boolean {
    return wants.get(id)?.has(subjectKey(subject)) ?? false;
  }

  /** Hand subjects to the provider, skipping any released since they were queued. */
  function deliver(id: string, subjects: Iterable<ComplicationSubject>): void {
    const onWanted = providers.get(id)?.onWanted;
    if (typeof onWanted !== "function") return;
    // A row that mounted and unmounted within the batch asks for nothing.
    const still = [...subjects].filter((subject) => isWanted(id, subject));
    if (still.length > 0) contain(() => onWanted(still));
  }

  function flush(): void {
    flushQueued = false;
    const batch = [...fresh];
    fresh.clear();
    for (const [id, subjects] of batch) deliver(id, subjects.values());
  }

  return {
    protocol: COMPLICATIONS_PROTOCOL,
    implementation: COMPLICATIONS_IMPLEMENTATION,

    provide(registration) {
      const info = describe(registration);
      const { id } = info;
      const token = {};
      providers.set(id, { token, info, onWanted: registration.onWanted });
      providersChanged(id);
      // Whatever was wanted before this provider loaded. A microtask rather
      // than now: the provider's `onWanted` answers through the handle, which
      // it does not have until this call returns.
      if (wants.has(id)) {
        queueMicrotask(() => {
          if (providers.get(id)?.token !== token) return;
          deliver(id, [...(wants.get(id)?.values() ?? [])].map((want) => want.subject));
        });
      }

      const current = () => providers.get(id)?.token === token;
      return {
        set(subject, value) {
          if (!current() || !isSubject(subject)) return;
          const next = normalize(value);
          if (next === undefined) {
            console.warn(`[complications] ${id}: ignored a value that is not a complication`);
            return;
          }
          const stored = next ?? { value: null, json: "null" };
          let byId = values.get(id);
          if (byId === undefined) {
            byId = new Map();
            values.set(id, byId);
          }
          const key = subjectKey(subject);
          // Unchanged keeps its identity, so a surface does not re-render.
          if (byId.get(key)?.json === stored.json) return;
          byId.set(key, stored);
          notify(valueKey(id, key));
        },
        isWanted(subject) {
          return isSubject(subject) && isWanted(id, subject);
        },
        wanted() {
          return [...(wants.get(id)?.values() ?? [])].map((want) => ({ ...want.subject }));
        },
        dispose() {
          if (!current()) return;
          providers.delete(id);
          const had = values.get(id);
          values.delete(id);
          for (const key of had?.keys() ?? []) notify(valueKey(id, key));
          providersChanged(id);
        },
      };
    },

    want(id, subject) {
      if (!isSubject(subject)) return () => undefined;
      const key = subjectKey(subject);
      let byId = wants.get(id);
      if (byId === undefined) {
        byId = new Map();
        wants.set(id, byId);
      }
      let entry = byId.get(key);
      if (entry === undefined) {
        entry = { subject: { kind: subject.kind, id: subject.id }, count: 0 };
        byId.set(key, entry);
        let queued = fresh.get(id);
        if (queued === undefined) {
          queued = new Map();
          fresh.set(id, queued);
        }
        queued.set(key, entry.subject);
        if (!flushQueued) {
          flushQueued = true;
          queueMicrotask(flush);
        }
      }
      entry.count += 1;
      const held = entry;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        held.count -= 1;
        if (held.count > 0) return;
        // Released, but the value stays: sidebar rows unmount and remount
        // constantly, and dropping it would blink every badge on each pass.
        // Wanting it again asks the provider afresh.
        const current = wants.get(id);
        if (current?.get(key) === held) current.delete(key);
        if (current?.size === 0) wants.delete(id);
      };
    },

    read(id, subject) {
      if (!isSubject(subject)) return undefined;
      return values.get(id)?.get(subjectKey(subject))?.value;
    },

    isProvided(id) {
      return providers.has(id);
    },

    subscribe(id, subject, listener) {
      if (subject !== null && !isSubject(subject)) return () => undefined;
      const key = subject === null ? presenceKey(id) : valueKey(id, subjectKey(subject));
      let set = listeners.get(key);
      if (set === undefined) {
        set = new Set();
        listeners.set(key, set);
      }
      set.add(listener);
      return () => {
        const current = listeners.get(key);
        if (current === undefined) return;
        current.delete(listener);
        if (current.size === 0) listeners.delete(key);
      };
    },

    providers() {
      providerList ??= Object.freeze([...providers.values()].map((entry) => entry.info));
      return providerList;
    },

    subscribeProviders(listener) {
      providerListeners.add(listener);
      return () => {
        providerListeners.delete(listener);
      };
    },
  };
}

function isRegistry(value: unknown): value is ComplicationsRegistry {
  if (!isRecord(value) || value.protocol !== COMPLICATIONS_PROTOCOL) return false;
  return ["provide", "want", "read", "isProvided", "subscribe", "providers", "subscribeProviders"].every(
    (method) => typeof value[method] === "function",
  );
}

/** Registries this copy has already complained about, so it says so once. */
const warnedAbout = new WeakSet<object>();

/**
 * Say, once, that an older copy is answering for everyone. Not an error: the
 * older copy keeps working, by the frozen behaviour. But a fix in this copy
 * does not apply until every plugin carrying the older one updates, and
 * without this line that is indistinguishable from the fix not working.
 */
function warnIfOlder(registry: ComplicationsRegistry): void {
  const running = typeof registry.implementation === "number" ? registry.implementation : 0;
  if (running >= COMPLICATIONS_IMPLEMENTATION || warnedAbout.has(registry)) return;
  warnedAbout.add(registry);
  console.warn(
    `[complications] An older copy (implementation ${running}) created this ` +
      `window's registry, so its code is what runs; this copy is ` +
      `implementation ${COMPLICATIONS_IMPLEMENTATION}. Update the plugin that ` +
      `carries the older copy to get this one's behaviour.`,
  );
}

/**
 * The window's registry, created by whichever bundle asks first. `null` only
 * if something other than a registry already holds the symbol — draw nothing
 * and provide nothing, rather than guess at its shape.
 */
export function getComplications(scope: object = globalThis): ComplicationsRegistry | null {
  const holder = scope as Record<symbol, unknown>;
  const existing = holder[REGISTRY_KEY];
  if (existing !== undefined) {
    if (!isRegistry(existing)) return null;
    warnIfOlder(existing);
    return existing;
  }
  const created = createRegistry();
  // Not writable or configurable: a later bundle must find this object, not
  // replace it and strand everyone who already subscribed to the old one.
  Object.defineProperty(scope, REGISTRY_KEY, { value: created });
  return created;
}
