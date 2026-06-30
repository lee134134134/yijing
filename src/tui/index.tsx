import { render } from "ink";
import App from "./app.js";

/**
 * Launch the full-screen TUI.
 * Injected as a plain function so src/index.ts can call it via dynamic import.
 */
export async function runTui(): Promise<void> {
  const { waitUntilExit } = render(<App />);
  await waitUntilExit();
}
