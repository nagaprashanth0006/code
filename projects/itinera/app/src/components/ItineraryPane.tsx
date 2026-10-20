import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  DEFAULT_CHECK_OPTIONS,
  findItem,
  formatDuration,
  formatMinutes,
  itemDuration,
  MIN_NIGHTS,
  minLegNights,
  STOPOVER_NIGHTS,
  summarizeWeather,
  totalNights,
  transferLabel,
  transferOnDay,
  TRANSPORT_LABELS,
  TRANSPORT_MODES,
  type Conflict,
  type DayTree,
  type Item,
  type LegTree,
  type ScheduleEntry,
  type SlotTree,
  type Transfer,
  type TransportMode,
} from "@itinera/core";
import { useEffect, useMemo, useRef, useState } from "react";
import { itemLabel, useStore } from "../state/store";
import { shortDate } from "./hooks";
import { NewTripForm } from "./NewTripForm";
import { rainText, Sheet } from "./ui";

const DURATIONS = [30, 45, 60, 90, 120, 150, 180, 240];
const TRANSFER_DURATIONS = [30, 60, 90, 120, 150, 180, 240, 300, 360, 480, 600, 720];
const MODE_ICON: Record<TransportMode, string> = {
  walk: "🚶",
  transit: "🚇",
  road: "🚗",
  rail: "🚆",
  bus: "🚌",
  ferry: "⛴",
  flight: "✈",
};
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const PART_LABEL = { morning: "Morning", afternoon: "Afternoon", evening: "Evening" } as const;

function ConflictList({ conflicts }: { conflicts: Conflict[] }) {
  if (conflicts.length === 0) return null;
  return (
    <ul className="conflicts">
      {conflicts.map((c, i) => (
        <li key={i} className={`conflict conflict--${c.severity}`}>
          {c.message}
        </li>
      ))}
    </ul>
  );
}

function ItemRow({
  item,
  number,
  entry,
  conflicts,
}: {
  item: Item;
  number: number;
  entry: ScheduleEntry | undefined;
  conflicts: Conflict[];
}) {
  const { places, remove, setDuration, selectPlace, selectedPlaceId } = useStore();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id });
  const place = item.placeId ? places.get(item.placeId) : undefined;
  const worst = conflicts.find((c) => c.severity === "error") ?? conflicts.find((c) => c.severity === "warning");

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`item${isDragging ? " is-dragging" : ""}${worst ? ` has-${worst.severity}` : ""}${item.placeId && item.placeId === selectedPlaceId ? " is-selected" : ""}`}
    >
      <button className="handle" aria-label={`Reorder ${itemLabel(item, places)}`} {...attributes} {...listeners}>
        ⋮⋮
      </button>
      <span className="item__num" aria-hidden>
        {number}
      </span>
      <div className="item__body">
        <button className="item__name link-plain" onClick={() => selectPlace(item.placeId)}>
          {itemLabel(item, places)}
        </button>
        <div className="muted small">
          {entry && (
            <>
              {entry.travelMinutes > 0 && `${entry.travelMode === "walk" ? "Walk" : "Transit"} ${formatDuration(entry.travelMinutes)} · `}
              {formatMinutes(entry.start)}–{formatMinutes(entry.end)}
              {entry.waitMinutes > 0 && ` (opens ${formatMinutes(entry.start)})`}
            </>
          )}
        </div>
        <ConflictList conflicts={conflicts} />
      </div>
      <select
        className="item__duration"
        aria-label="Visit length"
        value={item.durationMin ?? itemDuration(item, place)}
        onChange={(e) => void setDuration(item.id, Number(e.target.value))}
      >
        {[...new Set([...DURATIONS, item.durationMin ?? itemDuration(item, place)])]
          .sort((a, b) => a - b)
          .map((m) => (
            <option key={m} value={m}>
              {formatDuration(m)}
            </option>
          ))}
      </select>
      <button className="icon" aria-label={`Remove ${itemLabel(item, places)}`} onClick={() => void remove(item.id)}>
        ×
      </button>
    </li>
  );
}

function AlternateRow({ item, primaries, conflicts }: { item: Item; primaries: Item[]; conflicts: Conflict[] }) {
  const { places, swap, remove, selectPlace } = useStore();
  return (
    <li className="item item--alt">
      <span className="chip small">alt</span>
      <div className="item__body">
        <button className="item__name link-plain" onClick={() => selectPlace(item.placeId)}>
          {itemLabel(item, places)}
        </button>
        <ConflictList conflicts={conflicts} />
      </div>
      {primaries.length > 0 && (
        <select
          aria-label="Swap in for"
          value=""
          onChange={(e) => e.target.value && void swap(item.id, e.target.value)}
        >
          <option value="">Swap in for…</option>
          {primaries.map((p) => (
            <option key={p.id} value={p.id}>
              {itemLabel(p, places)}
            </option>
          ))}
        </select>
      )}
      <button className="icon" aria-label={`Remove ${itemLabel(item, places)}`} onClick={() => void remove(item.id)}>
        ×
      </button>
    </li>
  );
}

function SlotView({
  slot,
  numbering,
  schedule,
  conflictsByItem,
}: {
  slot: SlotTree;
  numbering: Map<string, number>;
  schedule: Map<string, ScheduleEntry>;
  conflictsByItem: Map<string, Conflict[]>;
}) {
  const { targetSlotId, setTargetSlot } = useStore();
  const { setNodeRef, isOver } = useDroppable({ id: `slot:${slot.slot.id}` });
  const primaries = slot.items.filter((i) => i.isPrimary);
  const alternates = slot.items.filter((i) => !i.isPrimary);
  const [start, end] = DEFAULT_CHECK_OPTIONS.slotWindows[slot.slot.part];
  const isTarget = targetSlotId === slot.slot.id;

  return (
    <div ref={setNodeRef} className={`slot${isOver ? " is-over" : ""}${isTarget ? " is-target" : ""}`}>
      <button
        className="slot__header"
        aria-pressed={isTarget}
        aria-label={`${PART_LABEL[slot.slot.part]} ${formatMinutes(start)}–${formatMinutes(end)}${isTarget ? ", places you add go here" : ""}`}
        onClick={() => setTargetSlot(slot.slot.id)}
      >
        {PART_LABEL[slot.slot.part]}{" "}
        <span className="muted small">
          {formatMinutes(start)}–{formatMinutes(end)}
          {isTarget && " · adding here"}
        </span>
      </button>
      <SortableContext items={primaries.map((i) => i.id)} strategy={verticalListSortingStrategy}>
        <ul className="items">
          {primaries.map((item) => (
            <ItemRow
              key={item.id}
              item={item}
              number={numbering.get(item.id) ?? 0}
              entry={schedule.get(item.id)}
              conflicts={conflictsByItem.get(item.id) ?? []}
            />
          ))}
          {primaries.length === 0 && <li className="slot__empty muted small">Drop a place here</li>}
        </ul>
      </SortableContext>
      {alternates.length > 0 && (
        <ul className="items items--alt">
          {alternates.map((item) => (
            <AlternateRow key={item.id} item={item} primaries={primaries} conflicts={conflictsByItem.get(item.id) ?? []} />
          ))}
        </ul>
      )}
    </div>
  );
}

/** A transfer between legs: the first thing on the day it arrives, with mode and duration. */
function TransferRow({ transfer, window }: { transfer: Transfer; window: { start: number; end: number } | null }) {
  const { tree, setTransfer, cityName } = useStore();
  if (!tree) return null;
  const durations = [...new Set([...TRANSFER_DURATIONS, transfer.estMinutes])].sort((a, b) => a - b);
  return (
    <div className="transfer" role="group" aria-label={transferLabel(tree, transfer, cityName)}>
      <span className="transfer__icon" aria-hidden>
        {MODE_ICON[transfer.mode]}
      </span>
      <div className="transfer__body">
        <div className="transfer__name">{transferLabel(tree, transfer, cityName)}</div>
        <div className="muted small">
          {window ? `${formatMinutes(window.start)}–${formatMinutes(window.end)} · ` : ""}estimated, edit if you know better
        </div>
        <div className="transfer__controls">
          <select
            aria-label="Transfer mode"
            value={transfer.mode}
            onChange={(e) => void setTransfer(transfer.id, { mode: e.target.value as TransportMode })}
          >
            {TRANSPORT_MODES.filter((m) => m !== "walk" && m !== "transit").map((m) => (
              <option key={m} value={m}>
                {TRANSPORT_LABELS[m]}
              </option>
            ))}
          </select>
          <select
            aria-label="Transfer duration"
            value={transfer.estMinutes}
            onChange={(e) => void setTransfer(transfer.id, { estMinutes: Number(e.target.value) })}
          >
            {durations.map((m) => (
              <option key={m} value={m}>
                {formatDuration(m)}
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
}

function DayView({ day, index }: { day: DayTree; index: number }) {
  const { tree, check, selectedDayId, selectDay } = useStore();
  const transfer = tree ? transferOnDay(tree, day.day.id) : undefined;
  const [open, setOpen] = useState(true);
  const result = check?.byDay.get(day.day.id);
  const schedule = new Map(result?.schedule.map((s) => [s.itemId, s]) ?? []);
  const conflictsByItem = new Map<string, Conflict[]>();
  const dayConflicts: Conflict[] = [];
  for (const c of result?.conflicts ?? []) {
    if (c.itemId) conflictsByItem.set(c.itemId, [...(conflictsByItem.get(c.itemId) ?? []), c]);
    else dayConflicts.push(c);
  }
  const errors = result?.conflicts.filter((c) => c.severity === "error").length ?? 0;
  const warnings = result?.conflicts.filter((c) => c.severity === "warning").length ?? 0;
  const numbering = new Map<string, number>();
  let n = 1;
  for (const s of day.slots) for (const i of s.items) if (i.isPrimary) numbering.set(i.id, n++);
  const isSel = selectedDayId === day.day.id;

  return (
    <li role="treeitem" aria-expanded={open} className={`day${isSel ? " is-selected" : ""}`}>
      <div className="day__header">
        <button className="tree__toggle" onClick={() => setOpen((o) => !o)} aria-label={open ? "Collapse day" : "Expand day"}>
          <span className="caret">{open ? "▾" : "▸"}</span>
        </button>
        <button className="day__title link-plain" onClick={() => selectDay(day.day.id)}>
          Day {index + 1} · {shortDate(day.day.date)}
        </button>
        {errors > 0 && <span className="badge badge--error">{errors} conflict{errors > 1 ? "s" : ""}</span>}
        {warnings > 0 && <span className="badge badge--warning">{warnings} warning{warnings > 1 ? "s" : ""}</span>}
        {result && result.schedule.length > 0 && (
          <span className="muted small day__ends">ends {formatMinutes(result.endsAt)}</span>
        )}
      </div>
      {open && (
        <div role="group" className="day__body">
          {transfer && <TransferRow transfer={transfer} window={result?.transfer ?? null} />}
          <ConflictList conflicts={dayConflicts} />
          {day.slots.map((s) => (
            <SlotView key={s.slot.id} slot={s} numbering={numbering} schedule={schedule} conflictsByItem={conflictsByItem} />
          ))}
        </div>
      )}
    </li>
  );
}

/** One stop: city, dates, nights, typical weather, and its days. */
function LegView({ leg, index, dayOffset }: { leg: LegTree; index: number; dayOffset: number }) {
  const { tree, normals, cityName, selectedLeg, selectLeg, setNights, setStopover, moveLeg, removeLeg } = useStore();
  const [open, setOpen] = useState(true);
  const [menu, setMenu] = useState(false);
  const first = leg.days[0]?.day.date;
  const last = leg.days[leg.days.length - 1]?.day.date;
  const weather = useMemo(
    () => (first && last ? summarizeWeather(normals.get(leg.leg.cityId) ?? [], first, last) : null),
    [normals, leg.leg.cityId, first, last],
  );
  const ref = useRef<HTMLLIElement | null>(null);
  const isSelected = selectedLeg?.leg.id === leg.leg.id;
  // Bring a stop into view when it's selected from elsewhere (added, or picked on the map).
  useEffect(() => {
    const el = ref.current;
    if (!isSelected || !el) return;
    const panel = el.closest(".panel__body");
    if (!panel) return;
    const a = el.getBoundingClientRect();
    const b = panel.getBoundingClientRect();
    if (a.bottom < b.top || a.top > b.bottom) el.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [isSelected]);
  if (!tree) return null;
  const count = tree.legs.length;
  const min = minLegNights(count);
  const name = cityName(leg.leg.cityId);
  const n = leg.leg.nights;
  const isSel = isSelected;

  return (
    <li ref={ref} role="treeitem" aria-expanded={open} aria-label={name} className={`leg${isSel ? " is-selected" : ""}`}>
      <div className="leg__header">
        <button className="tree__toggle" onClick={() => setOpen((o) => !o)} aria-label={open ? `Collapse ${name}` : `Expand ${name}`}>
          <span className="caret">{open ? "▾" : "▸"}</span>
        </button>
        <span className="leg__num" aria-hidden>
          {index + 1}
        </span>
        <div className="leg__title">
          <button className="link-plain leg__name" onClick={() => selectLeg(leg.leg.id)}>
            {name}
            {leg.leg.isStopover && <span className="chip small">stopover</span>}
          </button>
          {first && last && (
            <span className="muted small">
              {shortDate(first)}
              {last !== first && ` – ${shortDate(last)}`}
            </span>
          )}
        </div>
        <div className="stepper" role="group" aria-label={`Nights in ${name}`}>
          <button
            className="icon"
            aria-label={`One night fewer in ${name}`}
            disabled={n <= min}
            onClick={() => void setNights(new Map([[leg.leg.id, n - 1]]))}
          >
            −
          </button>
          <span className="stepper__value">{plural(n, "night")}</span>
          <button className="icon" aria-label={`One more night in ${name}`} onClick={() => void setNights(new Map([[leg.leg.id, n + 1]]))}>
            +
          </button>
        </div>
        <div className="menu">
          <button className="icon" aria-label={`Actions for ${name}`} aria-expanded={menu} onClick={() => setMenu((m) => !m)}>
            ⋯
          </button>
          {menu && (
            <div className="menu__list" role="menu" onClick={() => setMenu(false)}>
              <button role="menuitem" disabled={index === 0} onClick={() => void moveLeg(leg.leg.id, index - 1)}>
                Move earlier
              </button>
              <button role="menuitem" disabled={index === count - 1} onClick={() => void moveLeg(leg.leg.id, index + 1)}>
                Move later
              </button>
              <button role="menuitem" onClick={() => void setStopover(leg.leg.id, !leg.leg.isStopover)}>
                {leg.leg.isStopover ? "Not a stopover" : "Mark as stopover"}
              </button>
              <button
                role="menuitem"
                className="danger"
                disabled={count === 1}
                onClick={() => {
                  const planned = leg.days.reduce((a, d) => a + d.slots.reduce((b, s) => b + s.items.length, 0), 0);
                  if (planned === 0 || confirm(`Remove ${name} and its ${plural(planned, "planned place")}?`)) void removeLeg(leg.leg.id);
                }}
              >
                Remove {name}
              </button>
            </div>
          )}
        </div>
      </div>
      <p className="leg__weather small" title="Typical weather from 20 years of daily history, not a forecast">
        {weather ? (
          <>
            Typical {Math.round(weather.lowC)}–{Math.round(weather.highC)} °C · {rainText(weather.rainDays)}
            <span className="muted"> · expect {Math.round(weather.coldC)}° to {Math.round(weather.warmC)}°</span>
          </>
        ) : (
          <span className="muted">No typical weather for {name} yet.</span>
        )}
      </p>
      {open && (
        <ul role="group" className="leg__days">
          {leg.days.map((d, i) => (
            <DayView key={d.day.id} day={d} index={dayOffset + i} />
          ))}
        </ul>
      )}
    </li>
  );
}

/** Trip-wide controls: start date, length, adding a stop, ordering and sharing out nights. */
function TripBar() {
  const { tree, cities, addLeg, suggestOrder, setStartDate, notify } = useStore();
  const [sharing, setSharing] = useState(false);
  if (!tree) return null;
  const nights = totalNights(tree);
  const inTrip = new Set(tree.legs.map((l) => l.leg.cityId));
  const candidates = [...cities].sort((a, b) => Number(inTrip.has(a.id)) - Number(inTrip.has(b.id)) || a.name.localeCompare(b.name));

  return (
    <div className="tripbar">
      <div className="tripbar__row">
        <label className="field tripbar__start">
          <span>Starts</span>
          <input
            type="date"
            value={tree.trip.startDate ?? ""}
            onChange={(e) => e.target.value && void setStartDate(e.target.value)}
            required
          />
        </label>
        <div className="tripbar__length small">
          <strong>{plural(nights, "night")}</strong>
          {tree.trip.endDate && <span className="muted"> · ends {shortDate(tree.trip.endDate)}</span>}
          <br />
          <span className="muted">{plural(tree.legs.length, "stop")}</span>
        </div>
      </div>
      <div className="tripbar__row">
        <select
          className="tripbar__add"
          aria-label="Add a stop"
          value=""
          onChange={(e) => e.target.value && void addLeg(tree.trip.id, e.target.value)}
        >
          <option value="">+ Add a stop…</option>
          {candidates.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
              {inTrip.has(c.id) ? " (again)" : ""}
            </option>
          ))}
        </select>
        <button
          disabled={tree.legs.length < 2}
          title="Reorder stops to avoid back-and-forth travel"
          onClick={async () => {
            if (!(await suggestOrder())) notify("The stops are already in the shortest order.");
          }}
        >
          Suggest order
        </button>
        <button disabled={tree.legs.length < 2} onClick={() => setSharing(true)} title="Share the trip's nights between its stops">
          Share nights
        </button>
      </div>
      <p className="muted small tripbar__hint">To add a city that isn't on this device yet, open it from the hub and choose "Add to a trip".</p>
      {sharing && (
        <Sheet title="Share nights between stops" onClose={() => setSharing(false)}>
          <NightsForm initial={nights} onDone={() => setSharing(false)} />
        </Sheet>
      )}
    </div>
  );
}

/** Choose a trip length; nights go to stops by how much is saved or planned there. */
function NightsForm({ initial, onDone }: { initial: number; onDone: () => void }) {
  const { tree, proposeNights, setNights, cityName } = useStore();
  const [total, setTotal] = useState(initial);
  const proposal = proposeNights(total);
  if (!tree || !proposal) return null;
  const tooShort = total < tree.legs.reduce((a, l) => a + (l.leg.isStopover ? STOPOVER_NIGHTS : MIN_NIGHTS), 0);
  return (
    <form
      className="nights-form"
      onSubmit={(e) => {
        e.preventDefault();
        void setNights(proposal.nights).then(onDone);
      }}
    >
      <label className="field">
        <span>Nights in total</span>
        <input type="number" min={1} max={90} value={total} onChange={(e) => setTotal(Math.max(1, Number(e.target.value) || 1))} />
      </label>
      <p className="small muted">
        Each stop gets two nights (one for a stopover); the rest go where you've saved or planned the most places.
      </p>
      <ul className="nights-form__list">
        {tree.legs.map((l) => (
          <li key={l.leg.id}>
            <span>{cityName(l.leg.cityId)}</span>
            <span className="muted small">
              {plural(l.leg.nights, "night")} → <strong>{plural(proposal.nights.get(l.leg.id) ?? 0, "night")}</strong>
            </span>
          </li>
        ))}
      </ul>
      {proposal.warning && <p className={`conflict conflict--${tooShort ? "error" : "info"}`}>{proposal.warning}</p>}
      <button className="primary" type="submit" disabled={tooShort}>
        Apply
      </button>
    </form>
  );
}

export function ItineraryPane() {
  const { tree, move, places, cities: fetched } = useStore();
  const [dragging, setDragging] = useState<string | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  if (!tree) {
    return (
      <div className="plan plan--empty">
        {fetched.length > 0 ? (
          <>
            <p>Start a trip: pick a city and dates, then add places from the Places tab.</p>
            <NewTripForm />
          </>
        ) : (
          <p className="muted">No trips yet. Pick a destination on the hub to plan one.</p>
        )}
      </div>
    );
  }

  const onDragStart = (e: DragStartEvent) => setDragging(String(e.active.id));
  const onDragEnd = (e: DragEndEvent) => {
    setDragging(null);
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const overId = String(over.id);
    if (overId.startsWith("slot:")) {
      const slotId = overId.slice(5);
      const target = tree.legs.flatMap((l) => l.days.flatMap((d) => d.slots)).find((s) => s.slot.id === slotId);
      void move(String(active.id), slotId, target ? target.items.filter((i) => i.id !== active.id).length : 0);
      return;
    }
    const target = findItem(tree, overId);
    if (!target) return;
    void move(String(active.id), target.slot.slot.id, target.slot.items.findIndex((i) => i.id === overId));
  };

  const draggingItem = dragging ? findItem(tree, dragging)?.item : undefined;

  return (
    <div className="plan">
      <TripBar />
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDragCancel={() => setDragging(null)}
      >
        <ul className="tree" role="tree" aria-label={`Itinerary: ${tree.trip.name}`}>
          {tree.legs.map((leg, i) => (
            <LegView
              key={leg.leg.id}
              leg={leg}
              index={i}
              dayOffset={tree.legs.slice(0, i).reduce((a, l) => a + l.days.length, 0)}
            />
          ))}
        </ul>
        <DragOverlay>{draggingItem ? <div className="item item--overlay">{itemLabel(draggingItem, places)}</div> : null}</DragOverlay>
      </DndContext>
    </div>
  );
}
