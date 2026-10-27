import type { Observation } from "@coredrive/protocol";

const TOKEN_KEY = "coredrive.token";

export interface SessionInfo {
  client: string;
  appVersion: string;
  device: string;
  radioFreq?: string;
}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
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
  localStorage.setItem(TOKEN_KEY, body.token);
}

export async function upload(session: SessionInfo, observations: Observation[]): Promise<void> {
  const token = getToken();
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
}
