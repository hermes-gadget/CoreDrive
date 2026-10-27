import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app.js";
import { MapPage } from "./map.js";
import { PrivacyPage } from "./privacy.js";
import "./styles.css";

const root = document.getElementById("root");
const path = window.location.pathname;
const page = path.startsWith("/map") ? <MapPage /> : path.startsWith("/privacy") ? <PrivacyPage /> : <App />;
if (root) {
  createRoot(root).render(<StrictMode>{page}</StrictMode>);
}
