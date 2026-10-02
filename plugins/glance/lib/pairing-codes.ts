// One-time pairing codes.
//
// A pairing link used to carry the token itself, and a link is copied into
// places that outlive it: a terminal's scrollback, an agent's transcript (which
// bb stores and sends to a model provider), whichever app wins the `glance://`
// scheme. A code is what travels instead. It works once, for two minutes, and
// is exchanged for the token over `POST /pair`; anything that captured the link
// afterwards holds nothing.
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export const CODE_TTL_MS = 2 * 60_000;
/** Codes alive at once. Minting past this drops the oldest. */
export const MAX_OUTSTANDING = 5;
/** Failed redemptions allowed per window before every redemption is refused. */
export const MAX_FAILURES = 10;
export const FAILURE_WINDOW_MS = 60_000;

export type Redemption = "ok" | "invalid" | "throttled";

interface Outstanding {
  digest: Buffer;
  expiresAt: number;
}

function digest(code: string): Buffer {
  return createHash("sha256").update(code).digest();
}

export class PairingCodes {
  private outstanding: Outstanding[] = [];
  private failures: number[] = [];

  /** 128 random bits, URL-safe. Only a digest is kept. */
  mint(now: number, random: () => Buffer = () => randomBytes(16)): { code: string; expiresAt: number } {
    this.prune(now);
    const code = random().toString("base64url");
    const expiresAt = now + CODE_TTL_MS;
    this.outstanding.push({ digest: digest(code), expiresAt });
    if (this.outstanding.length > MAX_OUTSTANDING) this.outstanding.shift();
    return { code, expiresAt };
  }

  redeem(code: string, now: number): Redemption {
    this.prune(now);
    if (this.failures.length >= MAX_FAILURES) return "throttled";
    const candidate = digest(code);
    // Compare against every outstanding code so the time taken says nothing
    // about which one, if any, was close.
    let match = -1;
    this.outstanding.forEach((entry, index) => {
      if (timingSafeEqual(entry.digest, candidate)) match = index;
    });
    if (match === -1) {
      this.failures.push(now);
      return "invalid";
    }
    this.outstanding.splice(match, 1);
    return "ok";
  }

  private prune(now: number): void {
    this.outstanding = this.outstanding.filter((entry) => entry.expiresAt > now);
    this.failures = this.failures.filter((at) => now - at < FAILURE_WINDOW_MS);
  }
}

/** Headers a reverse proxy adds; their presence means the request was relayed. */
const FORWARDING_HEADERS = ["forwarded", "x-forwarded-for", "x-forwarded-host", "x-real-ip", "tailscale-user-login", "cf-connecting-ip"];

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

/**
 * True when a request reached bb straight from this machine: addressed to a
 * loopback name, and not relayed by a proxy that would make a remote caller
 * look local. Header names are lowercase, as Hono hands them over.
 */
export function isDirectLoopback(headers: Record<string, string | undefined>): boolean {
  if (FORWARDING_HEADERS.some((name) => headers[name] !== undefined)) return false;
  const host = headers["host"];
  if (host === undefined) return false;
  const name = host.startsWith("[") ? host.slice(0, host.indexOf("]") + 1) : host.split(":")[0]!;
  return LOOPBACK_HOSTS.has(name.toLowerCase());
}
