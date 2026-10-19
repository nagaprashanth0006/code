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
  type Conflict,
  type DayTree,
  type Item,
  type ScheduleEntry,
  type SlotTree,
} from "@itinera/core";
import { useState } from "react";
import { itemLabel, useStore } from "../state/store";
import { shortDate } from "./hooks";
import { NewTripForm } from "./TripBar";

const DURATIONS = [30, 45, 60, 90, 120, 150, 180, 240];
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

function DayView({ day, index }: { day: DayTree; index: number }) {
  const { check, selectedDayId, selectDay } = useStore();
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
          <ConflictList conflicts={dayConflicts} />
          {day.slots.map((s) => (
            <SlotView key={s.slot.id} slot={s} numbering={numbering} schedule={schedule} conflictsByItem={conflictsByItem} />
          ))}
        </div>
      )}
    </li>
  );
}

export function ItineraryPane() {
  const { tree, move, places, cities } = useStore();
  const [dragging, setDragging] = useState<string | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  if (!tree) {
    return (
      <div className="plan plan--empty">
        <div className="pane__header">
          <h2>Plan</h2>
        </div>
        <p>Start a trip: pick dates and the city, then add places from the list.</p>
        <NewTripForm />
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
      <div className="pane__header">
        <h2>{tree.trip.name}</h2>
        <span className="muted small">
          {tree.legs.map((l) => cities.find((c) => c.id === l.leg.cityId)?.name).join(" → ")} ·{" "}
          {tree.trip.startDate && shortDate(tree.trip.startDate)} – {tree.trip.endDate && shortDate(tree.trip.endDate)}
        </span>
      </div>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDragCancel={() => setDragging(null)}
      >
        <ul className="tree" role="tree" aria-label="Itinerary">
          {tree.legs.flatMap((leg) => leg.days).map((d, i) => (
            <DayView key={d.day.id} day={d} index={i} />
          ))}
        </ul>
        <DragOverlay>{draggingItem ? <div className="item item--overlay">{itemLabel(draggingItem, places)}</div> : null}</DragOverlay>
      </DndContext>
    </div>
  );
}
