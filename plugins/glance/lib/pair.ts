// The link a Mac opens to pair with this bb: `glance://pair?server=…&code=…`.
//
// The server is whatever base URL that Mac reaches bb through (loopback today;
// Tailscale or a tunnel later), never a path: the plugin routes sit at the same
// `/api/v1/plugins/<id>/http/…` under every one of them. The code is one-time
// (see pairing-codes.ts); the token itself never goes into a link.

export function normalizeServer(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.search !== "" || url.hash !== "") return null;
  return url.origin + url.pathname.replace(/\/+$/, "");
}

export function pairingLink(server: string, code: string): string {
  const query = new URLSearchParams({ server, code });
  return `glance://pair?${query.toString()}`;
}
