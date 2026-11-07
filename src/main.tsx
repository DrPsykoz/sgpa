import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import LimiteErreur from "./components/LimiteErreur";
import { installerCaptureDErreurs } from "./lib/journal";
import "./index.css";

// Avant le premier rendu : une exception levée pendant le montage initial est
// exactement celle qu'on ne verrait jamais autrement — il n'y a alors ni écran
// ni console pour la dire.
installerCaptureDErreurs();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <LimiteErreur>
      <App />
    </LimiteErreur>
  </React.StrictMode>,
);
