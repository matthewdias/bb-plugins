// Shared by the server and the app.

/** Realtime channel: the catalog or the hidden list changed; refetch. */
export const CHANGED = "declutter.changed";

/** Items one report may carry; a window finds a few dozen at most. */
export const REPORT_MAX = 200;

/** Items the catalog keeps. Far above what any setup shows. */
export const CATALOG_MAX = 1000;
