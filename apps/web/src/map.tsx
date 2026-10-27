import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

interface Cell {
  grid_id: string;
  observations: number;
  repeaters: number;
  best_snr: number | null;
  lat: number;
  lon: number;
}

const LAT_HALF = 0.001125;
const LON_HALF = 0.00192;

export function MapPage() {
  const container = useRef<HTMLDivElement>(null);
  const [cells, setCells] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!container.current) return;

    const map = L.map(container.current, { center: [54.7, -1.6], zoom: 9 });
    L.tileLayer("/tiles/osm/{z}/{x}/{y}.png", {
      maxZoom: 18,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map);

    fetch("/api/v1/coverage?mode=any&days=30&limit=5000")
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error("coverage"))))
      .then((data: { cells: Cell[] }) => {
        const layer = L.layerGroup().addTo(map);
        for (const cell of data.cells) {
          const opacity = Math.min(0.65, 0.18 + Math.log10(cell.observations + 1) * 0.25);
          L.rectangle(
            [
              [cell.lat - LAT_HALF, cell.lon - LON_HALF],
              [cell.lat + LAT_HALF, cell.lon + LON_HALF],
            ],
            { color: "#35d0ff", weight: 1, fillColor: "#35d0ff", fillOpacity: opacity },
          )
            .bindPopup(
              `${cell.observations} observations<br/>${cell.repeaters} repeaters<br/>best SNR ${
                cell.best_snr ?? "—"
              } dB`,
            )
            .addTo(layer);
        }
        setCells(data.cells.length);
      })
      .catch(() => setError("Could not load coverage"));

    return () => {
      map.remove();
    };
  }, []);

  return (
    <main className="shell map-shell">
      <header className="top">
        <div className="brand">
          <span className="dot" />
          <span className="wordmark">COREDRIVE</span>
        </div>
        <a className="pill" href="/">
          app
        </a>
      </header>

      <section className="map-head">
        <div>
          <p className="eyebrow">audibility</p>
          <h1>What the mesh can hear.</h1>
        </div>
        <p className="meta">
          {error ?? `${cells} cells · 30 days · 250 m grid`}
          <br />
          Passive observations only.
        </p>
      </section>

      <div ref={container} className="map" role="application" aria-label="Coverage map" />

      <p className="meta legend">
        Cell colour shows observation density. Popups show repeaters heard. No exact tracks are
        public.
      </p>
    </main>
  );
}
