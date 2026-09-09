// The stage catalog: the part of the workflow this plugin owns.
//
// A stage id is the key Ribbon stores placement against, so ids are created
// once and never rewritten — renaming a stage edits its label only. Ribbon's
// `bb sidebar rekey` moves placement between grouping keys, not between group
// ids, so an id rewrite would orphan every thread sitting in that stage.
import type BetterSqlite3 from "better-sqlite3";
import { z } from "zod";
import { isGlyphName, type GlyphName, type IconDataV1 } from "./icons";
import { iconDataSchema } from "./ribbon";

export const stageSchema = z
  .object({
    id: z.string(),
    label: z.string(),
    description: z.string(),
    /** The built-in glyph drawn when nothing has been picked. */
    glyph: z.string(),
    /** A bb icon name the user picked, or "" for the built-in glyph. */
    iconName: z.string(),
    /** What Ribbon draws: the picked icon as data, or null for the glyph. */
    icon: iconDataSchema.nullable(),
    /** Automation never moves a thread out of a sticky stage. */
    sticky: z.boolean(),
    visibleWhenEmpty: z.boolean(),
    defaultCollapsed: z.boolean(),
  })
  .strict();
export type Stage = z.output<typeof stageSchema>;

export const configSchema = z
  .object({
    /** Where a thread with no placement belongs. Required by Ribbon. */
    defaultStageId: z.string(),
    /** Entered when a turn starts, unless the thread sits in a sticky stage. */
    activeStageId: z.string().nullable(),
    /** Entered when work stops, but only from `activeStageId`. */
    idleStageId: z.string().nullable(),
    /** Entered when the agent asks a question or a turn fails. */
    attentionStageId: z.string().nullable(),
  })
  .strict();
export type WorkflowConfig = z.output<typeof configSchema>;

interface StageRow {
  id: string;
  label: string;
  description: string;
  glyph: string;
  position: number;
  icon_name: string;
  icon_data: string;
  sticky: number;
  visible_when_empty: number;
  default_collapsed: number;
}

type SeedStage = Omit<Stage, "glyph" | "iconName" | "icon"> & { glyph: GlyphName };

const SEED: ReadonlyArray<SeedStage> = [
  {
    id: "inbox",
    label: "Inbox",
    description:
      "New work, and anything that needs the user before it can move. Threads land here by default.",
    glyph: "inbox",
    sticky: false,
    visibleWhenEmpty: true,
    defaultCollapsed: false,
  },
  {
    id: "planning",
    label: "Planning",
    description:
      "The approach is still being worked out: reading code, writing a plan, waiting on a plan review.",
    glyph: "pencil",
    sticky: false,
    visibleWhenEmpty: true,
    defaultCollapsed: false,
  },
  {
    id: "building",
    label: "Building",
    description: "A plan exists and the change is being written.",
    glyph: "play",
    sticky: false,
    visibleWhenEmpty: true,
    defaultCollapsed: false,
  },
  {
    id: "review",
    label: "Review",
    description:
      "The change is written and is being checked: tests, a review thread, or a PR waiting on comments.",
    glyph: "eye",
    sticky: false,
    visibleWhenEmpty: true,
    defaultCollapsed: false,
  },
  {
    id: "blocked",
    label: "Blocked",
    description:
      "Stopped on something outside the thread. Say what it is waiting on. Only the user moves a thread out of here.",
    glyph: "alert",
    sticky: true,
    visibleWhenEmpty: false,
    defaultCollapsed: false,
  },
  {
    id: "done",
    label: "Done",
    description: "Finished and merged or abandoned. Nothing here needs attention.",
    glyph: "check",
    sticky: true,
    visibleWhenEmpty: false,
    defaultCollapsed: true,
  },
];

// Stage is where the work is; attention is whether it needs you, which Ribbon
// already draws per row. Filing a question-asking thread back to the default
// stage would undo the first move on every clarification, so the attention
// bounce ships off and stays a setting for anyone who wants that queue.
const DEFAULT_CONFIG: WorkflowConfig = {
  defaultStageId: "inbox",
  activeStageId: null,
  idleStageId: null,
  attentionStageId: null,
};

/** A stored icon is only as trustworthy as whatever wrote it. */
function parseIcon(stored: string): IconDataV1 | null {
  if (stored === "") return null;
  try {
    const parsed = iconDataSchema.safeParse(JSON.parse(stored));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function toStage(row: StageRow): Stage {
  return {
    id: row.id,
    label: row.label,
    description: row.description,
    glyph: isGlyphName(row.glyph) ? row.glyph : "circle",
    iconName: row.icon_name,
    icon: parseIcon(row.icon_data),
    sticky: row.sticky === 1,
    visibleWhenEmpty: row.visible_when_empty === 1,
    defaultCollapsed: row.default_collapsed === 1,
  };
}

/** A label becomes an id once, at creation. Ribbon rejects `:` and `/`. */
export function slugify(label: string, taken: ReadonlySet<string>): string {
  const base =
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/gu, "-")
      .replace(/^-+|-+$/gu, "")
      .slice(0, 100) || "stage";
  if (!taken.has(base)) return base;
  for (let suffix = 2; suffix < 1000; suffix += 1) {
    const candidate = `${base}-${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
  throw new Error("Could not derive a free stage id.");
}

export interface StageStore {
  list(): Stage[];
  get(id: string): Stage | null;
  config(): WorkflowConfig;
  add(label: string): Stage;
  update(patch: { id: string } & Partial<Omit<Stage, "id">>): Stage;
  remove(id: string): boolean;
  move(id: string, direction: "up" | "down"): Stage[];
  setConfig(patch: Partial<WorkflowConfig>): WorkflowConfig;
}

export function createStageStore(database: BetterSqlite3.Database): StageStore {
  const selectAll = database.prepare<[], StageRow>(
    "SELECT * FROM stages ORDER BY position ASC, id ASC",
  );
  const selectOne = database.prepare<[string], StageRow>(
    "SELECT * FROM stages WHERE id = ?",
  );

  function list(): Stage[] {
    return selectAll.all().map(toStage);
  }
  function get(id: string): Stage | null {
    const row = selectOne.get(id);
    return row === undefined ? null : toStage(row);
  }
  function readConfig(): WorkflowConfig {
    const rows = database
      .prepare<[], { key: string; value: string }>("SELECT key, value FROM config")
      .all();
    const stored: Record<string, string | null> = {};
    for (const row of rows) stored[row.key] = row.value === "" ? null : row.value;
    const ids = new Set(list().map((stage) => stage.id));
    const resolve = (key: keyof WorkflowConfig, fallback: string | null) => {
      const value = stored[key];
      if (value === undefined) return fallback;
      // A stage the user deleted stops being an automation target.
      return value !== null && ids.has(value) ? value : null;
    };
    const defaultStageId = resolve("defaultStageId", DEFAULT_CONFIG.defaultStageId);
    return {
      defaultStageId:
        defaultStageId !== null && ids.has(defaultStageId)
          ? defaultStageId
          : (list()[0]?.id ?? DEFAULT_CONFIG.defaultStageId),
      activeStageId: resolve("activeStageId", DEFAULT_CONFIG.activeStageId),
      idleStageId: resolve("idleStageId", DEFAULT_CONFIG.idleStageId),
      attentionStageId: resolve("attentionStageId", DEFAULT_CONFIG.attentionStageId),
    };
  }
  function writeConfig(patch: Partial<WorkflowConfig>): WorkflowConfig {
    const write = database.prepare(
      "INSERT INTO config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    );
    database.transaction(() => {
      for (const [key, value] of Object.entries(patch)) {
        if (value === undefined) continue;
        write.run(key, value ?? "");
      }
    })();
    return readConfig();
  }
  function renumber(): void {
    const rows = selectAll.all();
    const write = database.prepare("UPDATE stages SET position = ? WHERE id = ?");
    database.transaction(() => {
      rows.forEach((row, index) => write.run((index + 1) * 10, row.id));
    })();
  }

  // Seed once. A user who deletes every stage gets the defaults back on the
  // next load rather than a catalog Ribbon would reject for being empty.
  if (selectAll.all().length === 0) {
    const insert = database.prepare(
      `INSERT INTO stages (id, label, description, glyph, position, sticky, visible_when_empty, default_collapsed)
       VALUES (@id, @label, @description, @glyph, @position, @sticky, @visible_when_empty, @default_collapsed)`,
    );
    database.transaction(() => {
      SEED.forEach((stage, index) => {
        insert.run({
          id: stage.id,
          label: stage.label,
          description: stage.description,
          glyph: stage.glyph,
          position: (index + 1) * 10,
          sticky: stage.sticky ? 1 : 0,
          visible_when_empty: stage.visibleWhenEmpty ? 1 : 0,
          default_collapsed: stage.defaultCollapsed ? 1 : 0,
        });
      });
    })();
    writeConfig(DEFAULT_CONFIG);
  }

  return {
    list,
    get,
    config: readConfig,
    add(label) {
      const trimmed = label.trim();
      if (trimmed === "") throw new Error("A stage needs a name.");
      const taken = new Set(list().map((stage) => stage.id));
      const id = slugify(trimmed, taken);
      const position = (list().length + 1) * 10;
      database
        .prepare(
          `INSERT INTO stages (id, label, description, glyph, position, sticky, visible_when_empty, default_collapsed)
           VALUES (?, ?, '', 'circle', ?, 0, 1, 0)`,
        )
        .run(id, trimmed.slice(0, 64), position);
      const created = get(id);
      if (created === null) throw new Error("Could not create the stage.");
      return created;
    },
    update(patch) {
      const current = get(patch.id);
      if (current === null) throw new Error(`No stage with id ${patch.id}.`);
      const next: Stage = {
        ...current,
        ...Object.fromEntries(
          Object.entries(patch).filter(([, value]) => value !== undefined),
        ),
        id: current.id,
      };
      database
        .prepare(
          `UPDATE stages SET label = ?, description = ?, glyph = ?, icon_name = ?,
             icon_data = ?, sticky = ?, visible_when_empty = ?, default_collapsed = ?
           WHERE id = ?`,
        )
        .run(
          next.label.trim().slice(0, 64) || current.label,
          next.description.slice(0, 600),
          isGlyphName(next.glyph) ? next.glyph : "circle",
          next.icon === null ? "" : next.iconName.slice(0, 64),
          next.icon === null ? "" : JSON.stringify(next.icon),
          next.sticky ? 1 : 0,
          next.visibleWhenEmpty ? 1 : 0,
          next.defaultCollapsed ? 1 : 0,
          current.id,
        );
      const saved = get(current.id);
      if (saved === null) throw new Error("Could not save the stage.");
      return saved;
    },
    remove(id) {
      const stages = list();
      if (stages.length <= 1) {
        throw new Error("A workflow needs at least one stage.");
      }
      if (readConfig().defaultStageId === id) {
        throw new Error(
          "This is the default stage. Make another stage the default first.",
        );
      }
      const removed = database.prepare("DELETE FROM stages WHERE id = ?").run(id);
      if (removed.changes === 0) return false;
      renumber();
      // Drop it as an automation target; readConfig() already ignores it.
      writeConfig(readConfig());
      return true;
    },
    move(id, direction) {
      const stages = list();
      const index = stages.findIndex((stage) => stage.id === id);
      const swapWith = direction === "up" ? index - 1 : index + 1;
      if (index === -1 || swapWith < 0 || swapWith >= stages.length) return stages;
      const write = database.prepare("UPDATE stages SET position = ? WHERE id = ?");
      database.transaction(() => {
        write.run((swapWith + 1) * 10, stages[index]!.id);
        write.run((index + 1) * 10, stages[swapWith]!.id);
      })();
      return list();
    },
    setConfig(patch) {
      const ids = new Set(list().map((stage) => stage.id));
      for (const [key, value] of Object.entries(patch)) {
        if (value === undefined || value === null) continue;
        if (!ids.has(value)) throw new Error(`No stage with id ${value}.`);
      }
      if (patch.defaultStageId === null) {
        throw new Error("The workflow needs a default stage.");
      }
      return writeConfig(patch);
    },
  };
}

export const MIGRATIONS: string[] = [
  `CREATE TABLE IF NOT EXISTS stages (
     id TEXT PRIMARY KEY,
     label TEXT NOT NULL,
     description TEXT NOT NULL DEFAULT '',
     glyph TEXT NOT NULL DEFAULT 'circle',
     position INTEGER NOT NULL,
     sticky INTEGER NOT NULL DEFAULT 0,
     visible_when_empty INTEGER NOT NULL DEFAULT 1,
     default_collapsed INTEGER NOT NULL DEFAULT 0
   )`,
  `CREATE TABLE IF NOT EXISTS config (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
  // Append-only: never edit or reorder a shipped statement.
  `ALTER TABLE stages ADD COLUMN icon_name TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE stages ADD COLUMN icon_data TEXT NOT NULL DEFAULT ''`,
];
