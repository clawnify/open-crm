import { createRoot } from "react-dom/client";
import { App } from "./app";
import "./styles.css";

// Default to the light (white) theme — do not follow the OS. A future in-app
// toggle can add/remove `.dark`; until then the CRM is white by default.
document.documentElement.classList.remove("dark");

// Agent/touch mode enlarges interactive targets (?agent or ?mode=agent).
const params = new URLSearchParams(window.location.search);
if (params.has("agent") || params.get("mode") === "agent") {
  document.documentElement.setAttribute("data-agent", "");
}

createRoot(document.getElementById("app")!).render(<App />);
