import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app.js";
import { MapPage } from "./map.js";
import "./styles.css";

const root = document.getElementById("root");
const isMap = window.location.pathname.startsWith("/map");
if (root) {
  createRoot(root).render(
    <StrictMode>{isMap ? <MapPage /> : <App />}</StrictMode>,
  );
}
