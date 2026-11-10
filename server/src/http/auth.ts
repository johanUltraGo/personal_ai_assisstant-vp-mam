import { createHmac, timingSafeEqual } from "crypto";
import { NextFunction, Request, Response, Router } from "express";
import { z } from "zod";

/**
 * Single-user access protection (design §5).
 * - APP_ACCESS_PIN set: every /api route except login/status needs the
 *   vp_session cookie issued by POST /api/auth/login.
 * - Not set: /api answers only requests made on this same computer that did
 *   not arrive through a proxy. Her phone therefore needs a PIN.
 */
const COOKIE = "vp_session";
const MAX_FAILURES = 5;
const WINDOW_MS = 15 * 60_000;
const failures = new Map<string, number[]>();

export function resetLoginAttempts() {
  failures.clear();
}

function configuredPin(): string | undefined {
  const pin = process.env.APP_ACCESS_PIN?.trim();
  return pin ? pin : undefined;
}

function sessionToken(pin: string): string {
  return createHmac("sha256", pin).update("vp-session-v1").digest("base64url");
}

function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return undefined;
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function isSignedIn(req: Request): boolean {
  const pin = configuredPin();
  if (!pin) return false;
  const cookie = readCookie(req, COOKIE);
  return !!cookie && safeEqual(cookie, sessionToken(pin));
}

function isLocalDirect(req: Request): boolean {
  if (req.headers["x-forwarded-for"] || req.headers["forwarded"]) return false;
  const address = req.socket.remoteAddress ?? "";
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

function hostName(hostHeader: string | undefined): string {
  return (hostHeader ?? "").trim().toLowerCase().replace(/:\d+$/, "");
}

/**
 * Changes must come from this app's own page: a browser sends Origin on POST,
 * and another site's page (or another app on localhost) has a different one.
 * Requests without Origin (curl, the phone's service worker GETs) pass.
 */
function sameOrigin(req: Request): boolean {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return true;
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    const originHost = new URL(origin).host.toLowerCase();
    const allowed = [req.headers.host, req.headers["x-forwarded-host"], process.env.PUBLIC_ORIGIN && new URL(process.env.PUBLIC_ORIGIN).host]
      .filter(Boolean)
      .map((h) => String(h).split(",")[0].trim().toLowerCase());
    return allowed.includes(originHost);
  } catch {
    return false;
  }
}

export function requireAccess(req: Request, res: Response, next: NextFunction) {
  if (!sameOrigin(req)) return res.status(403).json({ error: "Requests from other web pages are not allowed." });
  // Without a PIN only this computer may use the API — and only under a local
  // host name, so a web page re-pointed at 127.0.0.1 (DNS rebinding) is refused.
  if (!configuredPin() && !LOCAL_HOSTS.has(hostName(req.headers.host))) {
    return res.status(403).json({ error: "Set APP_ACCESS_PIN to use this server from another address." });
  }
  if (configuredPin() ? isSignedIn(req) : isLocalDirect(req)) return next();
  res.status(401).json({
    error: configuredPin()
      ? "Please enter your access PIN."
      : "This server only accepts requests from its own computer until APP_ACCESS_PIN is set.",
    pinRequired: !!configuredPin(),
  });
}

function recentFailures(ip: string): number[] {
  const now = Date.now();
  const list = (failures.get(ip) ?? []).filter((at) => now - at < WINDOW_MS);
  failures.set(ip, list);
  return list;
}

export const authRouter = Router();

authRouter.get("/status", (req, res) => {
  res.json({ pinRequired: !!configuredPin(), signedIn: configuredPin() ? isSignedIn(req) : isLocalDirect(req) });
});

authRouter.post("/login", (req, res) => {
  if (!sameOrigin(req)) return res.status(403).json({ error: "Requests from other web pages are not allowed." });
  const pin = configuredPin();
  if (!pin) return res.status(400).json({ error: "No access PIN is configured on this server." });
  const ip = req.socket.remoteAddress ?? "unknown";
  if (recentFailures(ip).length >= MAX_FAILURES) {
    return res.status(429).json({ error: "Too many wrong PINs. Try again in 15 minutes." });
  }
  const parsed = z.object({ pin: z.string() }).safeParse(req.body);
  if (!parsed.success || !safeEqual(parsed.data.pin, pin)) {
    recentFailures(ip).push(Date.now());
    return res.status(401).json({ error: "That PIN is not right." });
  }
  res.cookie(COOKIE, sessionToken(pin), {
    httpOnly: true,
    sameSite: "lax",
    secure: req.secure || process.env.COOKIE_SECURE === "true",
    maxAge: 180 * 24 * 3600_000,
    path: "/",
  });
  res.json({ ok: true });
});

authRouter.post("/logout", (_req, res) => {
  res.clearCookie(COOKIE, { path: "/" });
  res.json({ ok: true });
});
