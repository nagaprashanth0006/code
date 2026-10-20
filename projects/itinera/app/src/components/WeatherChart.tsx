/**
 * Typical weather by month: a bar from the typical low to the typical high on
 * one temperature scale for the year, with rainy days underneath. Months in
 * the recommendation window are emphasised, the best one is marked, and the
 * months a chosen date range touches are outlined.
 */
import type { WeatherSummary } from "@itinera/core";
import { monthName } from "./ui";

const tempHue = (c: number) => 220 - Math.max(0, Math.min(1, c / 35)) * 200;

export function WeatherChart({
  months,
  window = [],
  best,
  selected = [],
}: {
  months: ReadonlyArray<WeatherSummary | null>;
  /** 1-based months in the recommendation window. */
  window?: readonly number[];
  best?: number | null;
  selected?: readonly number[];
}) {
  const known = months.filter((m): m is WeatherSummary => !!m);
  if (known.length === 0) return <p className="muted small">No weather history for this place yet.</p>;
  const lo = Math.floor(Math.min(...known.map((m) => m.lowC)) - 2);
  const hi = Math.ceil(Math.max(...known.map((m) => m.highC)) + 2);
  const maxRain = Math.max(10, ...known.map((m) => m.rainDays));
  const pos = (c: number) => ((c - lo) / (hi - lo)) * 100;

  return (
    <div className="wchart" role="img" aria-label="Typical temperature range and rainy days for each month">
      {months.map((m, i) => {
        const month = i + 1;
        const cls = [
          "wchart__col",
          window.includes(month) ? "is-window" : "",
          best === month ? "is-best" : "",
          selected.includes(month) ? "is-selected" : "",
        ].join(" ");
        return (
          <div key={month} className={cls} title={m ? `${monthName(month)}: ${Math.round(m.lowC)}–${Math.round(m.highC)} °C, ~${Math.round(m.rainDays)} rainy days` : monthName(month)}>
            <div className="wchart__temp">
              {m && (
                <div
                  className="wchart__bar"
                  style={{
                    bottom: `${pos(m.lowC)}%`,
                    height: `${Math.max(pos(m.highC) - pos(m.lowC), 3)}%`,
                    background: `linear-gradient(to top, hsl(${tempHue(m.lowC)} 75% 60%), hsl(${tempHue(m.highC)} 80% 55%))`,
                  }}
                >
                  <span className="wchart__hi">{Math.round(m.highC)}°</span>
                  <span className="wchart__lo">{Math.round(m.lowC)}°</span>
                </div>
              )}
            </div>
            <div className="wchart__rain">
              {m && <div className="wchart__rainbar" style={{ height: `${(m.rainDays / maxRain) * 100}%` }} />}
            </div>
            <span className="wchart__rainval">{m ? Math.round(m.rainDays) : "–"}</span>
            <span className="wchart__month">{monthName(month, "short").slice(0, 3)}</span>
            {best === month && <span className="wchart__star" aria-label="Best month">★</span>}
          </div>
        );
      })}
      <div className="wchart__legend small muted">
        <span>
          <i className="wchart__key wchart__key--temp" /> typical low–high °C
        </span>
        <span>
          <i className="wchart__key wchart__key--rain" /> rainy days per month
        </span>
      </div>
    </div>
  );
}
