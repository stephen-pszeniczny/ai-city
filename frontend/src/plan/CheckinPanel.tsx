// The Sunday check-in: plan the coming week on one screen, top to bottom.
//   1. the week at a glance (fixed blocks from settings)
//   2. add events: usual-event chips, or any other event, side work or build block
//   3. the grocery day
//   4. to-dos needing attention before the week starts
//   5. finish (can be reopened any time: it edits the saved week, nothing doubles)
// Which week it plans comes from the server (Sunday from noon: next week; otherwise this
// week until it's checked in).
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import {
  addPlanBlock,
  finishCheckin,
  listTasks,
  openCheckin,
  removePlanBlock,
  setGroceryDay,
  type CheckinWeek,
  type Task,
  type UsualEvent,
} from "../api";
import { BlockForm, EVENT_KINDS } from "./BlockForm";
import { addedEvents, chipState, needsAttention } from "./checkin";
import { dayLabel, isPast } from "./week";
import "./plan.css";

export function CheckinPanel() {
  const client = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [adding, setAdding] = useState(false);

  // The week this panel plans: whichever the server picks on first open, then kept, so
  // finishing (which makes the server look ahead to next week) doesn't switch weeks.
  const [pinned, setPinned] = useState<string | null>(null);
  // Opening is a POST (it creates the week if needed) but safe to repeat: the same
  // week comes back each time, so it's fine for the query to refetch.
  const week = useQuery({
    queryKey: ["plan", "checkin", pinned],
    queryFn: async () => {
      const w = await openCheckin(pinned ?? undefined);
      if (pinned === null && w.exists) setPinned(w.week_start);
      return w;
    },
    placeholderData: (previous) => previous, // no "Opening…" flash when the week is pinned
  });
  const tasks = useQuery({ queryKey: ["tasks", "open"], queryFn: () => listTasks("open") });

  const refresh = () => {
    setError(null);
    setSaved(false);
    void client.invalidateQueries({ queryKey: ["plan"] });
    void client.invalidateQueries({ queryKey: ["plan-checkin"] });
  };
  const onError = (err: Error) => setError(err.message);

  const grocery = useMutation({
    mutationFn: ({ start, day }: { start: string; day: string | null }) =>
      setGroceryDay(start, day),
    onSuccess: refresh,
    onError,
  });
  const remove = useMutation({ mutationFn: removePlanBlock, onSuccess: refresh, onError });
  const finish = useMutation({
    mutationFn: finishCheckin,
    onSuccess: () => {
      refresh();
      void client.invalidateQueries({ queryKey: ["notifications"] });
      setSaved(true);
    },
    onError,
  });

  if (week.isPending) return <p className="plan__note">Opening the check-in…</p>;
  if (week.isError)
    return (
      <p className="form-error" role="alert">
        {week.error.message}
      </p>
    );
  const w = week.data;
  if (!w.configured)
    return (
      <p className="plan__note">
        Add a [plan] section to your settings file to plan your week. See settings.example.toml.
      </p>
    );
  if (!w.exists) return <p className="plan__note">This week can't be planned any more.</p>;

  const openDays = w.days.map((d) => d.day).filter((d) => !isPast(d, w.today));
  const events = addedEvents(w);
  const attention = needsAttention(tasks.data ?? [], w.week_start, w.today);

  return (
    <div className="plan checkin">
      <div className="plan__bar">
        <h2 className="plan__title">Plan the week of {dayLabel(w.week_start)}</h2>
        {w.checked_in && <span className="plan__tag">Already checked in</span>}
      </div>

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      <section aria-labelledby="ci-glance">
        <h3 id="ci-glance" className="checkin__h">
          The week at a glance
        </h3>
        <ul className="checkin__glance">
          {w.days.map((d) => {
            const fixed = d.blocks.filter((b) => b.source === "settings");
            return (
              <li key={d.day}>
                <span className="checkin__day">{dayLabel(d.day)}</span>
                {fixed.length === 0
                  ? "Free"
                  : fixed.map((b) => `${b.title} ${b.start}–${b.end}`).join(" · ")}
              </li>
            );
          })}
        </ul>
      </section>

      <section aria-labelledby="ci-events">
        <h3 id="ci-events" className="checkin__h">
          Add events
        </h3>
        {w.usual_events.length > 0 && (
          <div className="checkin__chips">
            {w.usual_events.map((e) => (
              <Chip
                key={`${e.title}|${e.day}|${e.start}`}
                event={e}
                week={w}
                openDays={openDays}
                onDone={refresh}
                onError={onError}
              />
            ))}
          </div>
        )}
        {openDays.length > 0 &&
          (adding ? (
            <BlockForm
              initial={{
                title: "",
                kind: "event",
                start: "19:00",
                end: "20:00",
                day: openDays[0] ?? w.week_start,
              }}
              days={openDays}
              kinds={EVENT_KINDS}
              submitLabel="Add"
              onCancel={() => setAdding(false)}
              onSubmit={({ day, ...fields }) =>
                addPlanBlock({
                  week_start: w.week_start,
                  day: day ?? openDays[0] ?? w.week_start,
                  ...fields,
                })
              }
              onDone={() => {
                setAdding(false);
                refresh();
              }}
              onError={onError}
            />
          ) : (
            <button type="button" className="btn btn--quiet" onClick={() => setAdding(true)}>
              + Add other event
            </button>
          ))}
        <ul className="plan__blocks" aria-label="Events added this week">
          {events.length === 0 && <li className="plan__note">No events added yet.</li>}
          {events.map((b) => (
            <li key={b.id} className={`plan__block plan__block--${b.kind}`}>
              <span className="plan__time">
                {dayLabel(b.day)} {b.start}–{b.end}
              </span>
              <span className="plan__name">{b.title}</span>
              {!isPast(b.day, w.today) && (
                <span className="plan__actions">
                  <button
                    type="button"
                    className="btn btn--quiet btn--danger"
                    disabled={remove.isPending}
                    onClick={() => remove.mutate(b.id)}
                  >
                    Remove
                  </button>
                </span>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="ci-grocery">
        <h3 id="ci-grocery" className="checkin__h">
          Grocery day
        </h3>
        <select
          className="field"
          aria-labelledby="ci-grocery"
          value={w.grocery_day ?? ""}
          disabled={grocery.isPending}
          onChange={(e) =>
            grocery.mutate({
              start: w.week_start,
              day: e.target.value === "" ? null : e.target.value,
            })
          }
        >
          <option value="">None this week</option>
          {openDays.map((d) => (
            <option key={d} value={d}>
              {dayLabel(d)}
            </option>
          ))}
        </select>
      </section>

      <section aria-labelledby="ci-todo">
        <h3 id="ci-todo" className="checkin__h">
          To-dos needing attention
        </h3>
        <TaskGroup label="Overdue" tasks={attention.overdue} />
        <TaskGroup label="Due this week" tasks={attention.dueThisWeek} />
        <TaskGroup label="Stale" tasks={attention.stale} />
        {attention.overdue.length + attention.dueThisWeek.length + attention.stale.length === 0 ? (
          <p className="plan__note">Nothing needs attention.</p>
        ) : (
          <p className="plan__note">Open the To-do app from the dock to change them.</p>
        )}
      </section>

      <div className="plan__bar">
        <button
          type="button"
          className="btn"
          disabled={finish.isPending}
          onClick={() => finish.mutate(w.week_start)}
        >
          {w.checked_in ? "Save the week" : "Finish check-in"}
        </button>
        {saved && (
          <span className="plan__tag" role="status">
            Week saved.
          </span>
        )}
      </div>
    </div>
  );
}

function Chip({
  event,
  week,
  openDays,
  onDone,
  onError,
}: {
  event: UsualEvent;
  week: CheckinWeek;
  openDays: string[];
  onDone: () => void;
  onError: (err: Error) => void;
}) {
  const [pickedDay, setPickedDay] = useState<string | null>(null);
  const add = useMutation({
    mutationFn: (day: string) =>
      addPlanBlock({
        week_start: week.week_start,
        day,
        start: event.start,
        end: event.end,
        title: event.title,
        kind: event.kind,
      }),
    onSuccess: () => {
      setPickedDay(null);
      onDone();
    },
    onError,
  });
  const state = chipState(event, week);
  const label = `${event.title} ${event.start}`;

  if (state === "added")
    return (
      <span className="checkin__chip is-on" aria-label={`${label}: added`}>
        ✓ {label}
      </span>
    );
  if (state === "past")
    return (
      <button type="button" className="checkin__chip" disabled title="That day has passed">
        {label} · {dayLabel(event.day!)}
      </button>
    );
  if (state === "pick-day")
    return pickedDay === null ? (
      <button
        type="button"
        className="checkin__chip"
        disabled={openDays.length === 0}
        onClick={() => setPickedDay(openDays[0] ?? null)}
      >
        + {label}
      </button>
    ) : (
      <span className="checkin__chip checkin__chip--pick">
        {event.title} on{" "}
        <select
          className="field"
          aria-label={`Day for ${event.title}`}
          value={pickedDay}
          onChange={(e) => setPickedDay(e.target.value)}
        >
          {openDays.map((d) => (
            <option key={d} value={d}>
              {dayLabel(d)}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="btn"
          disabled={add.isPending}
          onClick={() => add.mutate(pickedDay)}
        >
          Add
        </button>
        <button type="button" className="btn btn--quiet" onClick={() => setPickedDay(null)}>
          Cancel
        </button>
      </span>
    );
  return (
    <button
      type="button"
      className="checkin__chip"
      disabled={add.isPending}
      onClick={() => add.mutate(event.day!)}
    >
      + {label} · {dayLabel(event.day!)}
    </button>
  );
}

function TaskGroup({ label, tasks }: { label: string; tasks: Task[] }) {
  if (tasks.length === 0) return null;
  return (
    <div className="checkin__group">
      <span className="plan__tag">{label}</span>
      <ul>
        {tasks.map((t) => (
          <li key={t.id}>
            {t.title}
            {t.goal_date && <span className="plan__tag"> · {dayLabel(t.goal_date)}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}
