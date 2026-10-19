import { addDays, CATEGORY_INFO, describeDayHours, hoursOnRaw, weekdayIndex, WEEKDAY_NAMES, type Place } from "@itinera/core";
import { useStore } from "../state/store";
import { useSelectedDate } from "./hooks";

function weekHours(place: Place, from: string) {
  // The seven days starting on the Monday of the selected week.
  const monday = addDays(from, -weekdayIndex(from));
  return WEEKDAY_NAMES.map((name, i) => ({ name, text: describeDayHours(hoursOnRaw(place.hoursRaw, addDays(monday, i))) }));
}

export function PlaceDetail({ place }: { place: Place }) {
  const { platform, addPlace, targetSlotId, selectPlace } = useStore();
  const date = useSelectedDate() ?? new Date().toISOString().slice(0, 10);
  const photo = platform?.photoUrl(place.photoPath) ?? null;
  const open = (url: string) => platform?.openExternal(url);

  return (
    <article className="detail" aria-label={place.name}>
      {photo && (
        <figure className="detail__photo">
          <img src={photo} alt={place.name} loading="lazy" />
          {place.photoAttribution && (
            <figcaption className="small">
              Photo: {place.photoAttribution.text}
              {place.photoAttribution.license && ` · ${place.photoAttribution.license}`}
              {place.photoAttribution.url && (
                <>
                  {" · "}
                  <button className="link" onClick={() => open(place.photoAttribution!.url!)}>
                    Commons
                  </button>
                </>
              )}
            </figcaption>
          )}
        </figure>
      )}
      <div className="detail__body">
        <div className="detail__title">
          <h3>{place.name}</h3>
          <button className="link" onClick={() => selectPlace(null)} aria-label="Close details">
            ✕
          </button>
        </div>
        <p className="muted small">{CATEGORY_INFO[place.category].label}</p>
        {place.description && (
          <p>
            {place.description}
            {place.descriptionAttribution && (
              <span className="muted small">
                {" "}
                — {place.descriptionAttribution.text}
                {place.descriptionAttribution.license && `, ${place.descriptionAttribution.license}`}
              </span>
            )}
          </p>
        )}
        {place.hoursRaw ? (
          <table className="hours small">
            <tbody>
              {weekHours(place, date).map((d) => (
                <tr key={d.name}>
                  <th scope="row">{d.name}</th>
                  <td className={d.text === "closed" ? "closed" : ""}>{d.text}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="muted small">No opening hours on record.</p>
        )}
        <div className="detail__actions">
          <button className="primary" disabled={!targetSlotId} onClick={() => void addPlace(place.id)}>
            Add to plan
          </button>
          <button disabled={!targetSlotId} onClick={() => void addPlace(place.id, undefined, true)}>
            Add as alternate
          </button>
        </div>
        <p className="small sources">
          {place.sources.map((s, i) => (
            <span key={s.url}>
              {i > 0 && " · "}
              <button className="link" onClick={() => open(s.url)}>
                {s.label}
              </button>
            </span>
          ))}
        </p>
      </div>
    </article>
  );
}
