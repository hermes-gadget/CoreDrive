import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import type { Observation } from "@coredrive/protocol";
import { CompanionConnection } from "./lib/ble.js";
import { hexFrame, packetHash, parseFrame } from "./lib/frame.js";
import { isPhone, watchGps, type Fix } from "./lib/gps.js";
import { acknowledge, count, enqueue, pending, retryLater } from "./lib/queue.js";
import { clearToken, getToken, login, upload } from "./lib/api.js";

type Stage = "gate" | "login" | "radio" | "live" | "summary";

interface Counters {
  frames: number;
  queued: number;
  sent: number;
  lastError: string | null;
}

const EMPTY: Counters = { frames: 0, queued: 0, sent: 0, lastError: null };

export function App() {
  const [stage, setStage] = useState<Stage>(() => (isPhone() ? (getToken() ? "radio" : "login") : "gate"));
  const [fix, setFix] = useState<Fix | null>(null);
  const [connected, setConnected] = useState(false);
  const [deviceName, setDeviceName] = useState("");
  const [counters, setCounters] = useState<Counters>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const connection = useRef<CompanionConnection | null>(null);
  const fixRef = useRef<Fix | null>(null);
  const liveRef = useRef(false);
  const sessionRef = useRef<string | null>(null);
  const flushTimer = useRef<number | null>(null);

  useEffect(() => {
    const watch = watchGps(
      (next) => {
        fixRef.current = next;
        setFix(next);
      },
      (message) => setError(`GPS: ${message}`),
    );
    return () => navigator.geolocation.clearWatch(watch);
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void count().then((queued) => setCounters((current) => ({ ...current, queued })));
    }, 1500);
    return () => window.clearInterval(timer);
  }, []);

  const flush = useCallback(async () => {
    const session = sessionRef.current;
    if (!session || !getToken()) return;

    const items = await pending(100);
    if (items.length === 0) return;

    try {
      await upload(
        { client: "pwa", appVersion: "0.1.0", device: connection.current?.name ?? "companion" },
        items.map((item) => item.obs),
      );
      await acknowledge(items.map((item) => item.id));
      setCounters((current) => ({
        ...current,
        sent: current.sent + items.length,
        queued: Math.max(0, current.queued - items.length),
        lastError: null,
      }));
    } catch (uploadError) {
      await retryLater(items.map((item) => item.id), 15000);
      setCounters((current) => ({
        ...current,
        lastError: uploadError instanceof Error ? uploadError.message : "Upload failed",
      }));
    }
  }, []);

  const onFrame = useCallback(
    (frame: Uint8Array) => {
      if (!liveRef.current || frame.length < 4 || frame[0] !== 0x88) return;

      const snr = ((frame[1]! << 24) >> 24) / 4;
      const rssi = (frame[2]! << 24) >> 24;
      const raw = frame.slice(3);
      const parsed = parseFrame(raw);
      const position = fixRef.current;
      if (!parsed || !position || position.accuracy > 100) return;

      const sessionId = sessionRef.current;
      if (!sessionId) return;

      void packetHash(raw).then(async (hash) => {
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
          rawFrame: hexFrame(raw),
        };

        await enqueue({
          id: crypto.randomUUID(),
          sessionId,
          obs,
          attempts: 0,
          nextAttemptAt: 0,
        });

        setCounters((current) => ({ ...current, frames: current.frames + 1 }));
      });
    },
    [],
  );

  useEffect(() => {
    if (stage !== "live") {
      if (flushTimer.current) window.clearInterval(flushTimer.current);
      flushTimer.current = null;
      return;
    }

    flushTimer.current = window.setInterval(() => void flush(), 5000);
    void flush();

    return () => {
      if (flushTimer.current) window.clearInterval(flushTimer.current);
      flushTimer.current = null;
    };
  }, [stage, flush]);

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError(null);
    try {
      await login(String(form.get("username") ?? ""), String(form.get("password") ?? ""));
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
      connection.current = next;
      setDeviceName(next.name);
      setConnected(true);
    } catch (connectError) {
      setError(connectError instanceof Error ? connectError.message : "Could not connect");
    } finally {
      setBusy(false);
    }
  }

  function start() {
    sessionRef.current = crypto.randomUUID();
    liveRef.current = true;
    setCounters(EMPTY);
    setStage("live");
  }

  async function stop() {
    liveRef.current = false;
    await flush();
    connection.current?.disconnect();
    connection.current = null;
    setConnected(false);
    setStage("summary");
  }

  function signOut() {
    clearToken();
    connection.current?.disconnect();
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
          <p className="mono">https://wardrive.nemesh.uk</p>
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
          <button className="link" onClick={signOut}>
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
          <button className="stop" onClick={() => void stop()}>
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
