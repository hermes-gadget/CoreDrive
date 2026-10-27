import type { Observation } from "@coredrive/protocol";

export const SESSION_STORAGE_KEY = "coredrive.session";
const SESSION_KEY = SESSION_STORAGE_KEY;
const TOKEN_KEY = "coredrive.token";
const USERNAME_KEY = "coredrive.username";

interface StoredSession {
  token: string;
  username: string;
}

export interface SessionInfo {
  id?: string;
  client: string;
  appVersion: string;
  device: string;
  radioFreq?: string;
}

export interface UploadResult {
  accepted: number;
  rejected: number;
  duplicates: number;
  errors: Array<{ index: number; message: string }>;
}

export class UploadError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "UploadError";
  }
}

function readStoredSession(): StoredSession | null {
  const raw = localStorage.getItem(SESSION_KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Partial<StoredSession>;
      if (typeof parsed.token === "string" && typeof parsed.username === "string") {
        return { token: parsed.token, username: parsed.username };
      }
    } catch {
      // Fall through to the legacy pair.
    }
  }

  // Migrate the old split keys in one write, so a concurrent tab cannot pair a
  // token from one account with the username from another.
  const token = localStorage.getItem(TOKEN_KEY);
  const username = localStorage.getItem(USERNAME_KEY);
  if (!token || !username) return null;

  const session = { token, username };
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USERNAME_KEY);
  return session;
}

export function getSession(): StoredSession | null {
  return readStoredSession();
}

export function getToken(): string | null {
  return readStoredSession()?.token ?? null;
}

export function getUsername(): string | null {
  return readStoredSession()?.username ?? null;
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(SESSION_KEY);
}

/** Forget both halves of the session so a stale name can never outlive its token. */
export function clearSession(): void {
  localStorage.removeItem(SESSION_KEY);
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USERNAME_KEY);
}

export async function login(username: string, password: string): Promise<void> {
  const response = await fetch("/api/v1/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password }),
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
    throw new Error(body?.error?.message ?? "Login failed");
  }

  const body = (await response.json()) as { token: string; user?: { username?: string } };
  const session = {
    token: body.token,
    username: body.user?.username ?? username,
  };
  // One atomic record: token and username can never be read as a mixed pair.
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USERNAME_KEY);
}

/**
 * Best effort revocation. The endpoint may not be deployed yet and a network
 * failure must never trap the user in a signed-in session.
 */
export async function logout(): Promise<void> {
  const token = getToken();
  if (!token) return;

  try {
    await fetch("/api/v1/auth/logout", {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(4000),
    });
  } catch {
    // Ignored on purpose: local sign-out is authoritative.
  }
}

export async function upload(
  session: SessionInfo,
  observations: Observation[],
  token = getToken(),
): Promise<UploadResult> {
  if (!token) throw new Error("Not signed in");

  const response = await fetch("/api/v1/ingest", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ session, data: observations }),
    signal: AbortSignal.timeout(20000),
  });

  if (!response.ok) {
    throw new UploadError(`Upload failed (${response.status})`, response.status);
  }

  return (await response.json()) as UploadResult;
}
