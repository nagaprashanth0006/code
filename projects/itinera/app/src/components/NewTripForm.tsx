/** Quick trip creation for a city whose places are already fetched. */
import { addDays, weekdayIndex, type IsoDate } from "@itinera/core";
import { useState, type FormEvent } from "react";
import { useStore } from "../state/store";

function nextSaturday(): IsoDate {
  const today = new Date().toISOString().slice(0, 10);
  return addDays(today, ((5 - weekdayIndex(today) + 7) % 7) || 7);
}

export interface NewTripDraft {
  name: string;
  cityId: string;
  startDate: IsoDate;
  endDate: IsoDate;
}

export function NewTripForm({ onDone, initial }: { onDone?: () => void; initial?: NewTripDraft }) {
  const { cities, createTrip } = useStore();
  const [cityId, setCityId] = useState(initial?.cityId ?? cities[0]?.id ?? "");
  const start = nextSaturday();
  const [name, setName] = useState(initial?.name ?? `${cities[0]?.name ?? "City"} weekend`);
  const [startDate, setStartDate] = useState(initial?.startDate ?? start);
  const [endDate, setEndDate] = useState(initial?.endDate ?? addDays(start, 2));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    await createTrip({ name: name.trim() || "Trip", cityId, startDate, endDate });
    onDone?.();
  };

  return (
    <form className="new-trip" onSubmit={submit}>
      <label className="new-trip__name">
        Name
        <input value={name} onChange={(e) => setName(e.target.value)} required />
      </label>
      <label>
        City
        <select value={cityId} onChange={(e) => setCityId(e.target.value)}>
          {cities.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        From
        <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} required />
      </label>
      <label>
        To
        <input type="date" value={endDate} min={startDate} onChange={(e) => setEndDate(e.target.value)} required />
      </label>
      <button className="primary" type="submit" disabled={!cityId || endDate < startDate}>
        Create trip
      </button>
    </form>
  );
}
