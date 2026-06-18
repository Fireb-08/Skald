import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import App from "./App";
import { initLogging } from "./lib/log";

// Attach devtools console to the unified log + emit a startup line. Fire-and-forget.
void initLogging();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
