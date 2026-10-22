/** Small shared pieces: sheet, photo with fallback, weather text, labels. */
import { THEMES, type Attribution, type Theme, type WeatherSummary } from "@itinera/core";
import { useEffect, useRef, useState, type ReactNode } from "react";

export const THEME_LABELS: Record<Theme, string> = {
  romantic: "Romantic",
  solo: "Solo",
  adventure: "Adventure",
  nature: "Nature",
  historical: "Historical",
  culture: "Culture",
};
export const ALL_THEMES = THEMES;

export const today = () => new Date().toISOString().slice(0, 10);

export const monthName = (month: number, style: "long" | "short" = "long") =>
  new Date(Date.UTC(2000, month - 1, 1)).toLocaleString("en", { month: style, timeZone: "UTC" });

export function rainText(rainDays: number, period = ""): string {
  const n = Math.round(rainDays);
  if (rainDays < 0.5) return `little rain${period}`;
  return `~${n} rainy day${n === 1 ? "" : "s"}${period}`;
}

/** "350 m", "4.2 km", "1,240 km" */
export function distanceText(km: number): string {
  if (km < 1) return `${Math.max(50, Math.round((km * 1000) / 50) * 50)} m`;
  if (km < 10) return `${km.toFixed(1)} km`;
  return `${Math.round(km).toLocaleString("en")} km`;
}

export function weatherText(w: WeatherSummary, period = ""): string {
  return `${Math.round(w.lowC)}–${Math.round(w.highC)} °C · ${rainText(w.rainDays, period)}`;
}

/** A word for how typical weather scores for chosen dates (from the season factor). */
export function weatherWord(seasonFit: number): string {
  return seasonFit >= 0.8 ? "Great weather" : seasonFit >= 0.55 ? "Fair weather" : "Iffy weather";
}

/** A modal sheet: centred dialog on wide screens, bottom sheet on phones. */
export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog ref={ref} className="sheet" onClose={onClose} aria-label={title}>
      <div className="sheet__head">
        <h2>{title}</h2>
        <button className="icon" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </div>
      {children}
    </dialog>
  );
}

/**
 * A photo that falls back to a soft gradient (seeded by the name) when there
 * is no file or it fails to load, so cards never show a broken image.
 */
export function Photo({ src, alt, className = "" }: { src: string | null; alt: string; className?: string }) {
  const [failed, setFailed] = useState(false);
  const hue = [...alt].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 360, 7);
  return (
    <div className={`photo ${className}`} style={{ "--hue": hue } as React.CSSProperties}>
      {src && !failed && <img src={src} alt={alt} loading="lazy" onError={() => setFailed(true)} />}
    </div>
  );
}

export function PhotoCredit({ attribution, onOpen }: { attribution: Attribution; onOpen: (url: string) => void }) {
  return (
    <span className="credit">
      Photo: {attribution.text}
      {attribution.license && ` · ${attribution.license}`}
      {attribution.url && (
        <>
          {" · "}
          <button className="link" onClick={() => onOpen(attribution.url!)}>
            Commons
          </button>
        </>
      )}
    </span>
  );
}
