import type { Observation } from "@coredrive/protocol";

const TOKEN_KEY = "coredrive.token";
const USERNAME_KEY = "coredrive.username";

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

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function getUsername(): string | null {
  return localStorage.getItem(USERNAME_KEY);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

/** Forget both halves of the session so a stale name can never outlive its token. */
export function clearSession(): void {
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

  const body = (await response.json()) as { token: string };
  clearSession();
  localStorage.setItem(TOKEN_KEY, body.token);
  localStorage.setItem(USERNAME_KEY, username);
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
  });

  if (!response.ok) {
    throw new Error(`Upload failed (${response.status})`);
  }

  return (await response.json()) as UploadResult;
}
