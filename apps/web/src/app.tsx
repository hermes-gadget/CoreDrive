import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import type { Observation } from "@coredrive/protocol";
import { CompanionConnection } from "./lib/ble.js";
import { decodeRssi, packetHash, parseFrame } from "./lib/frame.js";
import { isPhone, watchGps, type Fix } from "./lib/gps.js";
import { acknowledge, count, enqueue, pending, retryLater } from "./lib/queue.js";
import { clearSession, getToken, getUsername, login, logout, upload, UploadError } from "./lib/api.js";

type Stage = "gate" | "login" | "radio" | "live" | "summary";

interface Counters {
  frames: number;
  queued: number;
  sent: number;
  lastError: string | null;
}

const EMPTY: Counters = { frames: 0, queued: 0, sent: 0, lastError: null };

/** Coordinates drift while the radio keeps moving, so a stale fix must not be stamped on new packets. */
const MAX_FIX_AGE_MS = 15_000;
const MAX_FIX_ACCURACY_M = 100;
const UPLOAD_INTERVAL_MS = 5_000;

export function App() {
  const [username, setUsername] = useState<string | null>(() => getUsername());
  const [stage, setStage] = useState<Stage>(() => {
    if (!isPhone()) return "gate";
    return getToken() && getUsername() ? "radio" : "login";
  });
  const [fix, setFix] = useState<Fix | null>(null);
  const [connected, setConnected] = useState(false);
  const [deviceName, setDeviceName] = useState("");
  const [counters, setCounters] = useState<Counters>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [gpsError, setGpsError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const connection = useRef<CompanionConnection | null>(null);
  const fixRef = useRef<Fix | null>(null);
  const liveRef = useRef(false);
  const sessionRef = useRef<string | null>(null);
  const ownerRef = useRef<string | null>(null);
  const pendingConnect = useRef<symbol | null>(null);
  const flushing = useRef(false);

  useEffect(() => {
    const watch = watchGps(
      (next) => {
        fixRef.current = next;
        setFix(next);
        setGpsError(null);
      },
      (message) => {
        // A failed fix invalidates the last one: never stamp new packets with it.
        fixRef.current = null;
        setFix(null);
        setGpsError(`GPS: ${message}`);
      },
    );
    return () => navigator.geolocation.clearWatch(watch);
  }, []);

  useEffect(() => {
    if (!username) return;
    const timer = window.setInterval(() => {
      void count(username).then((queued) => setCounters((current) => ({ ...current, queued })));
    }, 1500);
    return () => window.clearInterval(timer);
  }, [username]);

  const flush = useCallback(async () => {
    if (flushing.current) return;

    const account = getUsername();
    const token = getToken();
    if (!account || !token) return;

    flushing.current = true;
    try {
      const items = await pending(account);
      if (items.length === 0) return;

      // The signed-in account can change while the queue is being read. Send only
      // when both the owner and the token are still the ones we selected for.
      if (getUsername() !== account || getToken() !== token) return;

      try {
        const groups = new Map<string, typeof items>();
        for (const item of items) {
          const group = groups.get(item.sessionId) ?? [];
          group.push(item);
          groups.set(item.sessionId, group);
        }

        let sent = 0;
        let rejected = 0;
        for (const [sessionId, group] of groups) {
          let result;
          try {
            result = await upload(
              {
                id: sessionId,
                client: "pwa",
                appVersion: "0.1.0",
                device: connection.current?.name ?? "companion",
              },
              group.map((item) => item.obs),
              token,
            );
          } catch (error) {
            // A 400 means the whole group is terminally invalid. Drop it and
            // keep draining independent sessions instead of retrying forever.
            if (error instanceof UploadError && error.status === 400) {
              await acknowledge(group.map((item) => item.id));
              rejected += group.length;
              continue;
            }
            throw error;
          }

          // A 202 can still contain rejected rows. Keep those visible and
          // acknowledge only what the server accepted or already had.
          const bad = new Set(result.errors.map((error) => error.index));
          const accepted = group.filter((_, index) => !bad.has(index));
          const rejectedItems = group.filter((_, index) => bad.has(index));
          // Terminal validation failures are dropped so they cannot trap valid
          // observations in the same batch forever.
          await acknowledge([...accepted, ...rejectedItems].map((item) => item.id));
          sent += accepted.length;
          rejected += result.rejected;
        }

        setCounters((current) => ({
          ...current,
          sent: current.sent + sent,
          queued: Math.max(0, current.queued - sent - rejected),
          lastError: rejected > 0 ? `${rejected} observations rejected` : null,
        }));
      } catch (uploadError) {
        await retryLater(items.map((item) => item.id), 15000);
        setCounters((current) => ({
          ...current,
          lastError: uploadError instanceof Error ? uploadError.message : "Upload failed",
        }));
      }
    } catch (queueError) {
      setCounters((current) => ({
        ...current,
        lastError: queueError instanceof Error ? queueError.message : "Queue unavailable",
      }));
    } finally {
      flushing.current = false;
    }
  }, []);

  // Uploading is owned by the queue, not by the radio: it keeps draining while a
  // session runs, after Stop, on the summary screen, and after a reload.
  useEffect(() => {
    if (!username || !getToken()) return;

    void flush();
    const timer = window.setInterval(() => void flush(), UPLOAD_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [username, flush]);

  const onFrame = useCallback((frame: Uint8Array) => {
    if (!liveRef.current || frame.length < 4 || frame[0] !== 0x88) return;

    const snr = ((frame[1]! << 24) >> 24) / 4;
    const rssi = decodeRssi(frame[2]!);
    const raw = frame.slice(3);
    const parsed = parseFrame(raw);
    const position = fixRef.current;
    const sessionId = sessionRef.current;
    const account = ownerRef.current;
    if (!parsed || !position || !sessionId || !account) return;
    if (getUsername() !== account) return;
    if (position.accuracy > MAX_FIX_ACCURACY_M) return;
    if (Date.now() - position.time > MAX_FIX_AGE_MS) return;

    void packetHash(raw, parsed).then(async (hash) => {
      const obs: Observation = {
        type: "OBS",
        time: Math.floor(position.time / 1000),
        lat: position.lat,
        lon: position.lon,
        accuracyM: Math.round(position.accuracy),
        snr,
        rssi,
        routeType: parsed.routeType,
        packetType: parsed.payloadType,
        hops: parsed.hops,
        hashSize: parsed.hashSize,
        path: parsed.path,
        heardId: parsed.heardId ?? undefined,
        packetHash: hash,
        payloadLen: parsed.payloadLen,
      };

      await enqueue({
        id: crypto.randomUUID(),
        username: account,
        sessionId,
        obs,
        attempts: 0,
        nextAttemptAt: 0,
      });

      setCounters((current) => ({ ...current, frames: current.frames + 1 }));
    }).catch((error) => {
      setCounters((current) => ({
        ...current,
        lastError: error instanceof Error ? error.message : "Could not store observation",
      }));
    });
  }, []);

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError(null);
    try {
      await login(String(form.get("username") ?? ""), String(form.get("password") ?? ""));
      setUsername(getUsername());
      setStage("radio");
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : "Login failed");
    } finally {
      setBusy(false);
    }
  }

  async function connectRadio() {
    setBusy(true);
    setError(null);
    const attempt = Symbol("connect");
    pendingConnect.current = attempt;
    try {
      const next = new CompanionConnection();
      next.onFrame(onFrame);
      next.onDisconnect(() => {
        setConnected(false);
        liveRef.current = false;
        setStage("radio");
        setError("Radio disconnected");
      });
      await next.connect();
      // Sign-out can happen while the GATT handshake is in flight. Never adopt
      // a connection that belongs to an attempt the user has abandoned.
      if (pendingConnect.current !== attempt || !getToken()) {
        next.disconnect();
        return;
      }
      pendingConnect.current = null;
      connection.current = next;
      setDeviceName(next.name);
      setConnected(true);
    } catch (connectError) {
      setError(connectError instanceof Error ? connectError.message : "Could not connect");
    } finally {
      if (pendingConnect.current === attempt) pendingConnect.current = null;
      setBusy(false);
    }
  }

  function start() {
    sessionRef.current = crypto.randomUUID();
    ownerRef.current = username;
    liveRef.current = true;
    setCounters(EMPTY);
    setStage("live");
  }

  function stop() {
    liveRef.current = false;
    sessionRef.current = null;
    ownerRef.current = null;
    // Release the radio first: the queue uploader owns the backlog and keeps
    // retrying, so a stalled upload must never hold the connection open.
    connection.current?.disconnect();
    connection.current = null;
    setConnected(false);
    setStage("summary");
    void flush();
  }

  async function signOut() {
    // Best effort revocation before the token is forgotten locally.
    pendingConnect.current = null;
    await logout();
    clearSession();
    setUsername(null);
    liveRef.current = false;
    sessionRef.current = null;
    ownerRef.current = null;
    connection.current?.disconnect();
    connection.current = null;
    setConnected(false);
    setCounters(EMPTY);
    setStage("login");
  }

  return (
    <main className="shell">
      <header className="top">
        <div className="brand">
          <span className="dot" />
          <span className="wordmark">COREDRIVE</span>
        </div>
        <span className="pill">{stage === "live" ? "listening" : "passive only"}</span>
      </header>

      {stage === "gate" && (
        <section className="panel">
          <p className="eyebrow">phone tool</p>
          <h1>Open this on your phone.</h1>
          <p className="lede">
            CoreDrive connects to a MeshCore radio over Bluetooth. Desktop browsers cannot do that.
          </p>
          <p className="mono">
            <a href="https://wardrive.nemesh.uk">https://wardrive.nemesh.uk</a>
          </p>
          <p className="mono">
            <a href="/map">Open the audibility map</a>
          </p>
        </section>
      )}

      {stage === "login" && (
        <section className="panel">
          <p className="eyebrow">sign in</p>
          <h1>Use your UKMesh credentials.</h1>
          <p className="lede">The same MQTT username and password your radio uses. No new account.</p>
          <form className="form" onSubmit={handleLogin}>
            <label>
              Username
              <input name="username" autoComplete="username" required />
            </label>
            <label>
              Password
              <input name="password" type="password" autoComplete="current-password" required />
            </label>
            <button type="submit" disabled={busy}>
              {busy ? "Checking…" : "Sign in"}
            </button>
          </form>
          {error && <p className="error">{error}</p>}
        </section>
      )}

      {stage === "radio" && (
        <section className="panel">
          <p className="eyebrow">radio</p>
          <h1>{connected ? "Radio connected." : "Connect your radio."}</h1>
          <p className="lede">
            Turn on your MeshCore companion and bring it close. CoreDrive only listens; nothing is
            transmitted.
          </p>
          {!connected ? (
            <button onClick={() => void connectRadio()} disabled={busy}>
              {busy ? "Connecting…" : "Choose radio"}
            </button>
          ) : (
            <>
              <p className="mono">{deviceName}</p>
              <button onClick={start}>Start listening</button>
            </>
          )}
          {fix ? (
            <p className="meta">
              GPS ±{Math.round(fix.accuracy)} m · {fix.lat.toFixed(4)}, {fix.lon.toFixed(4)}
            </p>
          ) : (
            <p className="meta">Waiting for a GPS fix.</p>
          )}
          {error && <p className="error">{error}</p>}
          {gpsError && <p className="error">{gpsError}</p>}
          <button className="link" onClick={() => void signOut()}>
            Sign out
          </button>
        </section>
      )}

      {stage === "live" && (
        <section className="panel">
          <p className="eyebrow">listening</p>
          <h1>{counters.frames} packets</h1>
          <div className="stats">
            <div>
              <span className="stat-value">{counters.queued}</span>
              <span className="stat-label">queued</span>
            </div>
            <div>
              <span className="stat-value">{counters.sent}</span>
              <span className="stat-label">sent</span>
            </div>
            <div>
              <span className="stat-value">{fix ? `±${Math.round(fix.accuracy)}` : "—"}</span>
              <span className="stat-label">GPS m</span>
            </div>
          </div>
          <p className="meta">
            {fix ? `${fix.lat.toFixed(4)}, ${fix.lon.toFixed(4)}` : "No GPS fix yet"}
          </p>
          {counters.lastError && <p className="error">{counters.lastError}</p>}
          {gpsError && <p className="error">{gpsError}</p>}
          <button className="stop" onClick={stop}>
            Stop
          </button>
        </section>
      )}

      {stage === "summary" && (
        <section className="panel">
          <p className="eyebrow">session</p>
          <h1>{counters.frames} packets logged.</h1>
          <p className="lede">
            {counters.sent} uploaded, {counters.queued} still queued. The queue keeps retrying.
          </p>
          <button onClick={() => setStage("radio")}>Back to radio</button>
        </section>
      )}

      <footer className="foot">
        <span>passive only · zero transmissions</span>
        <span>audibility, not TX coverage</span>
      </footer>
    </main>
  );
}
