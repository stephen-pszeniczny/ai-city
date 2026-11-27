// Mission Control's Daily plan: the saved week (Monday to Sunday) with today
// highlighted, the chosen day's blocks, and a "Today" list of due to-dos below.
//
// The fixed blocks come from the settings file; the week is saved by the server
// and edited here. The server decides what can change (past days are read-only,
// gym can be marked for the last 7 days, far weeks aren't created); this screen
// only hides buttons that would be refused anyway.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useOpenApp } from "../desktop/DesktopContext";

import {
  addPlanBlock,
  completeTask,
  editPlanBlock,
  getGrocery,
  getPlanWeek,
  listTasks,
  openPlanWeek,
  rebuildPlanWeek,
  removePlanBlock,
  setGym,
  type GymStatus,
  type PlanBlock,
  type PlanWeek,
} from "../api";
import { categoryLabel } from "../todo/categories";
import { BlockForm } from "./BlockForm";
import { itemCountLabel } from "./grocery";
import { TodayRoutines } from "./RoutineCard";
import { canMarkGym, dayLabel, isPast, overlapping, shiftWeek, todosFor } from "./week";
import "./plan.css";

/** Read the week; if it isn't saved yet, ask the server to open (create) it. */
async function loadWeek(start: string | null): Promise<PlanWeek> {
  const week = await getPlanWeek(start ?? undefined);
  if (!week.configured || week.exists) return week;
  // The server only creates this week or next; anything else comes back unsaved.
  return openPlanWeek(week.week_start);
}

export function PlanPanel() {
  const openApp = useOpenApp();
  const client = useQueryClient();
  const [weekStart, setWeekStart] = useState<string | null>(null); // null: this week
  const [chosenDay, setChosenDay] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmRebuild, setConfirmRebuild] = useState(false);

  const week = useQuery({ queryKey: ["plan", weekStart], queryFn: () => loadWeek(weekStart) });
  const tasks = useQuery({ queryKey: ["tasks", "open"], queryFn: () => listTasks("open") });
  const grocery = useQuery({ queryKey: ["grocery"], queryFn: getGrocery });

  const refresh = () => {
    setError(null);
    void client.invalidateQueries({ queryKey: ["plan"] });
  };
  const onError = (err: Error) => setError(err.message);
  const rebuild = useMutation({
    mutationFn: (start: string) => rebuildPlanWeek(start),
    onSuccess: () => {
      setConfirmRebuild(false);
      refresh();
    },
    onError,
  });
  const complete = useMutation({
    mutationFn: completeTask,
    onSuccess: () => void client.invalidateQueries({ queryKey: ["tasks"] }),
    onError,
  });

  if (week.isPending) return <p className="plan__note">Loading…</p>;
  if (week.isError)
    return (
      <p className="form-error" role="alert">
        {week.error.message}
      </p>
    );
  const w = week.data;
  if (!w.configured)
    return (
      <p
        className="plan__note"
        title="Add a [plan] section to your settings file (see settings.example.toml)"
      >
        Plan not set up
      </p>
    );

  const today = w.today;
  const day =
    chosenDay && w.days.some((d) => d.day === chosenDay)
      ? chosenDay
      : w.days.some((d) => d.day === today)
        ? today
        : w.week_start;
  const blocks = w.days.find((d) => d.day === day)?.blocks ?? [];
  const overlaps = overlapping(blocks);
  const changeable = w.exists && w.days.some((d) => !isPast(d.day, today));
  const todos = todosFor(tasks.data ?? [], day, today);

  const goWeek = (by: number) => {
    setWeekStart(shiftWeek(w.week_start, by));
    setChosenDay(null);
    setConfirmRebuild(false);
    setError(null);
  };

  return (
    <div className="plan">
      <div className="plan__bar">
        <button type="button" className="btn btn--quiet" onClick={() => goWeek(-1)}>
          ‹ <span className="sr-only">Previous week</span>
        </button>
        <h2 className="plan__title">Week of {dayLabel(w.week_start)}</h2>
        <button type="button" className="btn btn--quiet" onClick={() => goWeek(1)}>
          <span className="sr-only">Next week</span> ›
        </button>
        {changeable &&
          (confirmRebuild ? (
            <span className="plan__confirm">
              Refresh untouched blocks from your settings? Your changes stay.
              <button
                type="button"
                className="btn"
                disabled={rebuild.isPending}
                onClick={() => rebuild.mutate(w.week_start)}
              >
                Rebuild
              </button>
              <button
                type="button"
                className="btn btn--quiet"
                onClick={() => setConfirmRebuild(false)}
              >
                Cancel
              </button>
            </span>
          ) : (
            <button
              type="button"
              className="btn btn--quiet"
              onClick={() => setConfirmRebuild(true)}
            >
              Rebuild this week
            </button>
          ))}
      </div>

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      {w.exists && !w.checked_in && w.days.some((d) => !isPast(d.day, today)) && (
        <div className="plan__row">
          <span className="plan__tag plan__tag--warn">Not checked in</span>
          <button type="button" className="btn btn--quiet" onClick={() => openApp("checkin")}>
            Open check-in
          </button>
        </div>
      )}

      {!w.exists ? (
        <p className="plan__note">
          {w.days.length === 0 && w.week_start < today ? "No plan saved" : "Not planned yet"}
        </p>
      ) : (
        <>
          <div className="plan__days" role="tablist" aria-label="Days of the week">
            {w.days.map((d) => (
              <button
                key={d.day}
                type="button"
                role="tab"
                aria-selected={d.day === day}
                className={`plan__day${d.day === today ? " plan__day--today" : ""}${isPast(d.day, today) ? " plan__day--past" : ""}`}
                onClick={() => setChosenDay(d.day)}
              >
                {dayLabel(d.day)}
                {d.day === today && <span className="plan__today"> (today)</span>}
              </button>
            ))}
          </div>

          <ul className="plan__blocks" aria-label={`Plan for ${dayLabel(day)}`}>
            {blocks.length === 0 && <li className="plan__note">Free time</li>}
            {blocks.map((b) => (
              <BlockRow
                key={b.id}
                block={b}
                today={today}
                overlaps={overlaps.has(b.id)}
                onDone={refresh}
                onError={onError}
              />
            ))}
          </ul>

          {w.grocery_day === day && (
            <p className="plan__grocery">
              🛒 Grocery day{grocery.data ? ` · ${itemCountLabel(grocery.data.open)}` : ""}
            </p>
          )}

          {!isPast(day, today) && (
            <AddBlock weekStart={w.week_start} day={day} onDone={refresh} onError={onError} />
          )}
        </>
      )}

      <section className="plan__todo" aria-labelledby="plan-today">
        <h3 id="plan-today">{day === today ? "Today" : dayLabel(day)}</h3>
        {day === today && <TodayRoutines day={day} />}
        <ul>
          {todos.length === 0 && <li className="plan__note">Nothing due</li>}
          {todos.map((t) => (
            <li key={t.id} className="plan__item">
              <label>
                <input
                  type="checkbox"
                  checked={false}
                  disabled={complete.isPending}
                  onChange={() => complete.mutate(t.id)}
                />{" "}
                {t.title}
              </label>
              <span className="plan__tag">
                to-do · {categoryLabel(t.category)}
                {t.goal_date! < today ? " · overdue" : ""}
              </span>
            </li>
          ))}
          <li className="plan__tag">Habits · Phase 2</li>
        </ul>
      </section>
    </div>
  );
}

function BlockRow({
  block,
  today,
  overlaps,
  onDone,
  onError,
}: {
  block: PlanBlock;
  today: string;
  overlaps: boolean;
  onDone: () => void;
  onError: (err: Error) => void;
}) {
  const [editing, setEditing] = useState(false);
  const gym = useMutation({
    mutationFn: (status: GymStatus) => setGym(block.id, status),
    onSuccess: onDone,
    onError,
  });
  const remove = useMutation({
    mutationFn: () => removePlanBlock(block.id),
    onSuccess: onDone,
    onError,
  });

  if (editing)
    return (
      <li className="plan__block">
        <BlockForm
          initial={block}
          submitLabel="Save"
          onCancel={() => setEditing(false)}
          onSubmit={(fields) => editPlanBlock(block.id, fields)}
          onDone={() => {
            setEditing(false);
            onDone();
          }}
          onError={onError}
        />
      </li>
    );

  const past = isPast(block.day, today);
  const mark = (status: GymStatus) => gym.mutate(block.status === status ? "planned" : status);
  return (
    <li className={`plan__block plan__block--${block.kind}`}>
      <span className="plan__time">
        {block.start}–{block.end}
      </span>
      <span className="plan__name">{block.title}</span>
      {block.source === "added" && <span className="plan__tag">added</span>}
      {overlaps && <span className="plan__tag plan__tag--warn">overlaps</span>}
      <span className="plan__actions">
        {block.kind === "gym" && canMarkGym(block.day, today) && (
          <>
            <button
              type="button"
              className={`btn btn--quiet${block.status === "done" ? " is-on" : ""}`}
              aria-pressed={block.status === "done"}
              disabled={gym.isPending}
              onClick={() => mark("done")}
            >
              Done
            </button>
            <button
              type="button"
              className={`btn btn--quiet${block.status === "skipped" ? " is-on" : ""}`}
              aria-pressed={block.status === "skipped"}
              disabled={gym.isPending}
              onClick={() => mark("skipped")}
            >
              Skipped
            </button>
          </>
        )}
        {block.kind === "gym" && !canMarkGym(block.day, today) && block.status !== "planned" && (
          <span className="plan__tag">{block.status}</span>
        )}
        {!past && (
          <>
            <button type="button" className="btn btn--quiet" onClick={() => setEditing(true)}>
              Edit
            </button>
            <button
              type="button"
              className="btn btn--quiet btn--danger"
              disabled={remove.isPending}
              onClick={() => remove.mutate()}
            >
              Remove
            </button>
          </>
        )}
      </span>
    </li>
  );
}

function AddBlock({
  weekStart,
  day,
  onDone,
  onError,
}: {
  weekStart: string;
  day: string;
  onDone: () => void;
  onError: (err: Error) => void;
}) {
  const [open, setOpen] = useState(false);
  if (!open)
    return (
      <button type="button" className="btn btn--quiet plan__add" onClick={() => setOpen(true)}>
        + Add block
      </button>
    );
  return (
    <BlockForm
      key={day}
      initial={{ title: "", kind: "event", start: "19:00", end: "20:00" }}
      submitLabel="Add"
      onCancel={() => setOpen(false)}
      onSubmit={(fields) => addPlanBlock({ week_start: weekStart, day, ...fields })}
      onDone={() => {
        setOpen(false);
        onDone();
      }}
      onError={onError}
    />
  );
}
