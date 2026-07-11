import { createRoot } from "react-dom/client";
import { App } from "./app";
import "./styles.css";

// Dark mode follows the OS (DESIGN-APPS: prefers-color-scheme → .dark).
const mql = window.matchMedia("(prefers-color-scheme: dark)");
const applyTheme = (dark: boolean) => document.documentElement.classList.toggle("dark", dark);
applyTheme(mql.matches);
mql.addEventListener("change", (e) => applyTheme(e.matches));

// Agent/touch mode enlarges interactive targets (?agent or ?mode=agent).
const params = new URLSearchParams(window.location.search);
if (params.has("agent") || params.get("mode") === "agent") {
  document.documentElement.setAttribute("data-agent", "");
}

createRoot(document.getElementById("app")!).render(<App />);
