/** Fixture page: boots the browser runtime on two plugins and shows its state. */
import { startBrowser } from "../../runtime/browser.ts";
import { move } from "../../runtime/loader.ts";

const host = await startBrowser({
  tree: [
    { id: "provider", plugin: "./plugins/provider.ts" },
    { id: "consumer", plugin: "./plugins/consumer.ts" },
  ],
});

const render = () => {
  document.getElementById("status")!.innerHTML = host.loader
    .status()
    .map((s) => `<tr><td>${s.id}</td><td>${s.state}</td><td>${s.position.join(".")}</td></tr>`)
    .join("");
};
host.onReload = (reloaded, restart) => {
  document.getElementById("log")!.textContent =
    `hot-reloaded: ${reloaded.join(", ") || "nothing"}` + (restart.length ? `; restart for ${restart.join(", ")}` : "");
  render();
};
render();

let disabled = false;
document.getElementById("toggle")!.onclick = async () => {
  disabled = !disabled;
  await host.loader.edit((t) => (t.find((e) => e.id === "provider")!.disabled = disabled, t));
  (document.getElementById("toggle") as HTMLButtonElement).textContent = disabled ? "Enable provider" : "Disable provider";
  render();
};
document.getElementById("swap")!.onclick = async () => {
  await host.loader.edit((t) => move(t, "consumer", null, t[0]!.id === "consumer" ? 1 : 0));
  render();
};

(globalThis as { host?: unknown }).host = host;
