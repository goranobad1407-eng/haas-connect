// Status bar — simple one-liner message at the bottom of the window.

import { state } from "../state";
import { t } from "../translations";

const el = () => document.getElementById("status-message")!;

let clearTimer: ReturnType<typeof setTimeout> | null = null;
let showingReady = true;

/** Set a status message. Optionally auto-clear after `autoClearMs` milliseconds. */
export function setStatus(message: string, autoClearMs?: number): void {
  el().textContent = message;
  showingReady = false;

  if (clearTimer !== null) {
    clearTimeout(clearTimer);
    clearTimer = null;
  }

  if (autoClearMs !== undefined) {
    clearTimer = setTimeout(() => {
      el().textContent = t("status.ready");
      showingReady = true;
      clearTimer = null;
    }, autoClearMs);
  }
}

// Update "Ready" text when language changes (if currently showing ready).
state.subscribe("language", () => {
  if (showingReady) {
    el().textContent = t("status.ready");
  }
});
