/**
 * Light or dark: follows the system until the toggle picks one, then keeps
 * that choice on this device. The resolved theme is set as `data-theme` on
 * the root element, which the stylesheet's tokens key off.
 */
import { useSyncExternalStore } from "react";

export type ThemeChoice = "system" | "light" | "dark";

const KEY = "itinera.theme";
const media = window.matchMedia("(prefers-color-scheme: dark)");
const listeners = new Set<() => void>();

function readChoice(): ThemeChoice {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

let choice = readChoice();

const isDark = () => (choice === "system" ? media.matches : choice === "dark");

function apply() {
  document.documentElement.dataset.theme = isDark() ? "dark" : "light";
  for (const l of listeners) l();
}

media.addEventListener("change", () => {
  if (choice === "system") apply();
});
apply();

export function setThemeChoice(next: ThemeChoice) {
  choice = next;
  try {
    if (next === "system") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, next);
  } catch {
    // Private windows can refuse storage; the choice still holds for this session.
  }
  apply();
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** True while the dark theme is showing. */
export function useDark(): boolean {
  return useSyncExternalStore(subscribe, isDark);
}

export function ThemeToggle({ className = "icon-btn" }: { className?: string }) {
  const dark = useDark();
  const label = dark ? "Switch to light mode" : "Switch to dark mode";
  return (
    <button className={`${className} theme-toggle`} onClick={() => setThemeChoice(dark ? "light" : "dark")} aria-label={label} title={label}>
      <span aria-hidden>{dark ? "☀" : "☾"}</span>
    </button>
  );
}
