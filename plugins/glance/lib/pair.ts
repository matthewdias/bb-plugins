// The link a Mac opens to pair with this bb: `glance://pair?server=…&token=…`.
//
// The server is whatever base URL that Mac reaches bb through (getbb.app,
// Tailscale, a Cloudflare tunnel, loopback), never a path: the plugin routes
// sit at the same `/api/v1/plugins/<id>/http/…` under every one of them.

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

export function pairingLink(server: string, token: string): string {
  const query = new URLSearchParams({ server, token });
  return `glance://pair?${query.toString()}`;
}
