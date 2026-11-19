// The add/edit form for a plan block (title, kind, start, end, and optionally the day),
// shared by the Daily plan and the Sunday check-in. The server checks everything again.
import { useMutation } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";

import type { PlanBlock, PlanKind } from "../api";
import { dayLabel } from "./week.ts";

export const KINDS: readonly { id: PlanKind; label: string }[] = [
  { id: "event", label: "Event" },
  { id: "side_work", label: "Side work" },
  { id: "build", label: "Build" },
  { id: "gym", label: "Gym" },
  { id: "work", label: "Work" },
  { id: "commute", label: "Commute" },
  { id: "other", label: "Other" },
];

/** Kinds Steve adds at the check-in (fixed kinds come from settings). */
export const EVENT_KINDS = KINDS.filter((k) =>
  ["event", "side_work", "build", "other"].includes(k.id),
);

export type Fields = { title: string; kind: PlanKind; start: string; end: string; day?: string };

export function BlockForm({
  initial,
  submitLabel,
  days,
  kinds = KINDS,
  onSubmit,
  onCancel,
  onDone,
  onError,
}: {
  initial: Fields;
  submitLabel: string;
  /** When given, the form also asks for the day (one of these). */
  days?: readonly string[];
  kinds?: readonly { id: PlanKind; label: string }[];
  onSubmit: (fields: Fields) => Promise<PlanBlock>;
  onCancel: () => void;
  onDone: () => void;
  onError: (err: Error) => void;
}) {
  const [fields, setFields] = useState<Fields>({
    title: initial.title,
    kind: initial.kind,
    start: initial.start,
    end: initial.end,
    ...(days ? { day: initial.day ?? days[0] } : {}),
  });
  const save = useMutation({ mutationFn: () => onSubmit(fields), onSuccess: onDone, onError });
  const set = (patch: Partial<Fields>) => setFields((f) => ({ ...f, ...patch }));
  const tooEarly = fields.end <= fields.start;

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!fields.title.trim() || tooEarly) return;
    save.mutate();
  }

  return (
    <form className="plan__form" onSubmit={submit}>
      <input
        className="field"
        aria-label="Title"
        placeholder="Title"
        maxLength={100}
        value={fields.title}
        onChange={(e) => set({ title: e.target.value })}
      />
      <select
        className="field"
        aria-label="Kind"
        value={fields.kind}
        onChange={(e) => set({ kind: e.target.value as PlanKind })}
      >
        {kinds.map((k) => (
          <option key={k.id} value={k.id}>
            {k.label}
          </option>
        ))}
      </select>
      {days && (
        <select
          className="field"
          aria-label="Day"
          value={fields.day}
          onChange={(e) => set({ day: e.target.value })}
        >
          {days.map((d) => (
            <option key={d} value={d}>
              {dayLabel(d)}
            </option>
          ))}
        </select>
      )}
      <input
        className="field"
        type="time"
        aria-label="Start"
        value={fields.start}
        onChange={(e) => set({ start: e.target.value })}
      />
      <input
        className="field"
        type="time"
        aria-label="End"
        aria-invalid={tooEarly}
        value={fields.end}
        onChange={(e) => set({ end: e.target.value })}
      />
      <button
        type="submit"
        className="btn"
        disabled={save.isPending || !fields.title.trim() || tooEarly}
      >
        {submitLabel}
      </button>
      <button type="button" className="btn btn--quiet" onClick={onCancel}>
        Cancel
      </button>
      {tooEarly && <span className="plan__tag plan__tag--warn">End must be after start</span>}
    </form>
  );
}
