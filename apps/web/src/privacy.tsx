export function PrivacyPage() {
  return (
    <main className="shell">
      <header className="top">
        <div className="brand">
          <span className="dot" />
          <span className="wordmark">COREDRIVE</span>
        </div>
        <a className="pill" href="/">
          app
        </a>
      </header>

      <article className="legal">
        <p className="eyebrow">privacy</p>
        <h1>Location data, kept small.</h1>
        <p>
          CoreDrive logs what a MeshCore radio hears and where the phone was when it heard it.
          That is location data, so the defaults are conservative.
        </p>

        <h2>What is collected</h2>
        <ul>
          <li>UKMesh MQTT username, used as the account identity.</li>
          <li>Device model and radio configuration.</li>
          <li>GPS position, accuracy and timestamp when a packet is received.</li>
          <li>Radio metadata: SNR, RSSI, route type, packet type, hop count and path.</li>
        </ul>

        <h2>What is not collected</h2>
        <ul>
          <li>Message contents, contacts, or other users' locations.</li>
          <li>Anything from the phone beyond location and the radio connection.</li>
          <li>Advertising or analytics identifiers.</li>
        </ul>

        <h2>What is public</h2>
        <p>
          The public map shows grid cells of roughly 250 metres, with timestamps bucketed to five
          minutes. It never shows a continuous track or an exact position. Signed-in users can see
          their own exact observations.
        </p>

        <h2>Retention and deletion</h2>
        <p>
          Raw observations are kept for 180 days. Aggregated cells are kept indefinitely. An
          account can delete its raw data from the account page; the deletion is recorded in an
          audit log.
        </p>

        <h2>Accounts</h2>
        <p>
          There is no signup. CoreDrive uses existing UKMesh MQTT credentials and stores no
          passwords.
        </p>

        <h2>Contact</h2>
        <p>
          Open an issue for privacy questions that do not involve a vulnerability. Security
          reports go through the private advisory flow in <code>SECURITY.md</code>.
        </p>

        <p className="legal-foot">
          <a href="/">Back to the app</a>
          <span>Last updated 27 October 2026</span>
        </p>
      </article>
    </main>
  );
}
