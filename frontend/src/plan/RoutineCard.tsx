// Today's routines as compact cards: title, a progress bar, done/total, and one
// tappable chip per item. Before its start time a card is dimmed with a small
// "from 19:00" tag (ticking early still works). A finished card shows a ✓.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { getRoutines, tickRoutine, type RoutineDay } from "../api";
import { isShowing, localHHMM, progress } from "./routines";

export function TodayRoutines() {
  const routines = useQuery({
    queryKey: ["routines"],
    queryFn: getRoutines,
    refetchInterval: 60_000, // so a card lights up when its time comes
  });
  if (!routines.data || routines.data.routines.length === 0) return null;
  const now = localHHMM(new Date());
  return (
    <div className="routines">
      {routines.data.routines.map((r) => (
        <RoutineCard key={r.id} routine={r} showing={isShowing(r, now)} />
      ))}
    </div>
  );
}

function RoutineCard({ routine, showing }: { routine: RoutineDay; showing: boolean }) {
  const client = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const tick = useMutation({
    mutationFn: ({ item, ticked }: { item: string; ticked: boolean }) =>
      tickRoutine(routine.id, item, ticked),
    onSuccess: () => {
      setError(null);
      void client.invalidateQueries({ queryKey: ["routines"] });
      void client.invalidateQueries({ queryKey: ["notifications"] });
    },
    onError: (err: Error) => setError(err.message),
  });
  const p = progress(routine);
  const finished = p.total > 0 && p.done === p.total;

  return (
    <section
      className={`routine${showing ? "" : " routine--later"}${finished ? " routine--done" : ""}`}
      aria-label={`${routine.title}, ${p.done} of ${p.total} done`}
    >
      <div className="routine__head">
        <span className="routine__title">
          {finished && "✓ "}
          {routine.title}
        </span>
        {!showing && <span className="plan__tag">from {routine.shows_from}</span>}
        <span className="routine__bar" aria-hidden="true">
          <span style={{ width: `${p.percent}%` }} />
        </span>
        <span className="routine__count">
          {p.done}/{p.total}
        </span>
      </div>
      <div className="routine__items">
        {routine.items.map((item) => (
          <button
            key={item.name}
            type="button"
            className={`routine__chip${item.ticked ? " is-on" : ""}`}
            aria-pressed={item.ticked}
            disabled={tick.isPending}
            onClick={() => tick.mutate({ item: item.name, ticked: !item.ticked })}
          >
            {item.ticked ? "✓ " : ""}
            {item.name}
          </button>
        ))}
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
