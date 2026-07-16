import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";
import { releaseLegacyServiceWorker } from "./legacy-service-worker";

async function start() {
  if (await releaseLegacyServiceWorker()) {
    window.location.reload();
    return;
  }
  createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}

void start();
