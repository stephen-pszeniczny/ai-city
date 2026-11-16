// One task, opened from the list: edit any field (Save / Cancel), complete,
// reopen or archive it, and see every change in its history.
//
// It replaces the list inside the same panel (no sidebar, SPEC section 7).
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, type FormEvent } from "react";

import {
  archiveTask,
  completeTask,
  editTask,
  getHistory,
  getTask,
  reopenTask,
  type Category,
  type Task,
  type TaskEdit,
  type TaskStatus,
} from "../api";
import { CATEGORIES, categoryLabel } from "./categories";
import { statusNotes } from "./dates";
import { describeEvent } from "./history";
import { confirmLeave, setDirty as setLeaveDirty } from "../leaveGuard";
import { ModeBanner } from "./ModeBanner";

type Props = {
  id: number;
  onBack: () => void;
  onArchived: (task: Task, previous: TaskStatus) => void;
};

export function TaskDetail({ id, onBack, onArchived }: Props) {
  const task = useQuery({ queryKey: ["tasks", "one", id], queryFn: () => getTask(id) });
  const [dirty, setDirty] = useState(false);
  // Share unsaved state with every other way out (belt Back, Escape, browser Back).
  useEffect(() => {
    setLeaveDirty(dirty);
  }, [dirty]);
  useEffect(() => () => setLeaveDirty(false), []);
  const headingRef = useRef<HTMLHeadingElement>(null);

  // Move keyboard and screen-reader focus to the new view.
  useEffect(() => headingRef.current?.focus(), []);

  function back() {
    if (!confirmLeave()) return;
    onBack();
  }

  return (
    <div className="detail">
      <header className="panel__head">
        <button type="button" className="back-link" onClick={back}>
          <span aria-hidden="true">‹</span> To-do
        </button>
        <h1 id="todo-title" ref={headingRef} tabIndex={-1}>
          Task details
        </h1>
      </header>

      <ModeBanner />

      <div className="panel__body">
        {task.isPending ? (
          <p className="quiet" role="status">
            Loading task…
          </p>
        ) : task.isError ? (
          <p className="form-error" role="alert">
            Couldn't load this task: {task.error.message}
          </p>
        ) : (
          <>
            {/* Remounts when the saved task changes, so the form always starts from it. */}
            <EditForm key={task.data.updated_at} task={task.data} onDirtyChange={setDirty} />
            <Actions task={task.data} locked={dirty} onArchived={onArchived} />
            <History id={id} />
          </>
        )}
      </div>
    </div>
  );
}

// --- Editing -----------------------------------------------------------------

type Draft = {
  title: string;
  category: Category;
  goal_date: string;
  reminder_at: string;
  notes: string;
};

const draftOf = (t: Task): Draft => ({
  title: t.title,
  category: t.category,
  goal_date: t.goal_date ?? "",
  reminder_at: t.reminder_at ?? "",
  notes: t.notes,
});

/** Only what differs from the saved task. Empty dates are sent as null (cleared). */
function changesBetween(task: Task, draft: Draft): TaskEdit {
  const changes: TaskEdit = {};
  if (draft.title.trim() !== task.title) changes.title = draft.title;
  if (draft.category !== task.category) changes.category = draft.category;
  if ((draft.goal_date || null) !== task.goal_date) changes.goal_date = draft.goal_date || null;
  if ((draft.reminder_at || null) !== task.reminder_at)
    changes.reminder_at = draft.reminder_at || null;
  if (draft.notes !== task.notes) changes.notes = draft.notes;
  return changes;
}

function EditForm({
  task,
  onDirtyChange,
}: {
  task: Task;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<Draft>(() => draftOf(task));
  const [error, setError] = useState<string | null>(null);
  const changes = changesBetween(task, draft);
  const dirty = Object.keys(changes).length > 0;
  const archived = task.status === "archived";

  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);

  const save = useMutation({
    mutationFn: (c: TaskEdit) => editTask(task.id, c),
    onSuccess: () => {
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ["tasks"] });
      void queryClient.invalidateQueries({ queryKey: ["history", task.id] });
    },
    onError: (err: Error) => setError(err.message),
  });

  const set =
    <K extends keyof Draft>(key: K) =>
    (value: Draft[K]) => {
      setDraft((d) => ({ ...d, [key]: value }));
      setError(null);
    };

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!dirty || save.isPending) return;
    if (draft.title.trim() === "") {
      setError("The title can't be empty.");
      return;
    }
    save.mutate(changes);
  }

  const notes = statusNotes(task);

  return (
    <form className="edit-form" onSubmit={submit} aria-label="Edit task" noValidate>
      <p className="detail__status">
        <span className={`chip chip--${task.category}`}>{categoryLabel(task.category)}</span>
        {task.status === "open" && notes.length === 0 && <span className="note--muted">Open</span>}
        {notes.map((n) => (
          <span key={n.text} className={`note note--${n.tone}`}>
            {n.text}
          </span>
        ))}
      </p>

      {archived && (
        <p className="quiet quiet--tight">
          Archived tasks can't be edited. Restore it to change it.
        </p>
      )}

      <fieldset className="edit-form__fields" disabled={archived || save.isPending}>
        <legend className="sr-only">Task fields</legend>
        <label className="field-label">
          Title
          <input
            className="field"
            value={draft.title}
            onChange={(e) => set("title")(e.target.value)}
            autoComplete="off"
          />
        </label>
        <div className="edit-form__pair">
          <label className="field-label">
            Category
            <select
              className="field"
              value={draft.category}
              onChange={(e) => set("category")(e.target.value as Category)}
            >
              {CATEGORIES.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
          <label className="field-label">
            Goal date
            <input
              type="date"
              className="field"
              value={draft.goal_date}
              onChange={(e) => set("goal_date")(e.target.value)}
            />
          </label>
        </div>
        <label className="field-label">
          Reminder
          <input
            type="datetime-local"
            className="field"
            value={draft.reminder_at}
            onChange={(e) => set("reminder_at")(e.target.value)}
          />
        </label>
        <label className="field-label">
          Notes
          <textarea
            className="field"
            rows={4}
            value={draft.notes}
            onChange={(e) => set("notes")(e.target.value)}
          />
        </label>
      </fieldset>

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      {!archived && (
        <div className="button-row">
          <button type="submit" className="btn" disabled={!dirty || save.isPending}>
            {save.isPending ? "Saving…" : "Save changes"}
          </button>
          <button
            type="button"
            className="btn btn--quiet"
            disabled={!dirty || save.isPending}
            onClick={() => {
              setDraft(draftOf(task));
              setError(null);
            }}
          >
            Cancel
          </button>
        </div>
      )}
    </form>
  );
}

// --- Complete / reopen / archive ------------------------------------------------

function Actions({
  task,
  locked,
  onArchived,
}: {
  task: Task;
  locked: boolean;
  onArchived: Props["onArchived"];
}) {
  const queryClient = useQueryClient();
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["tasks"] });
    void queryClient.invalidateQueries({ queryKey: ["history", task.id] });
  };

  const change = useMutation({
    mutationFn: (action: "complete" | "reopen" | "archive") =>
      action === "complete"
        ? completeTask(task.id)
        : action === "reopen"
          ? reopenTask(task.id)
          : archiveTask(task.id),
    onSuccess: (updated, action) => {
      refresh();
      if (action === "archive") onArchived(updated, task.status);
    },
  });

  const busy = change.isPending || locked;

  return (
    <section className="actions" aria-label="Task actions">
      <div className="button-row">
        {task.status === "open" && (
          <button
            type="button"
            className="btn btn--quiet"
            disabled={busy}
            onClick={() => change.mutate("complete")}
          >
            Mark as done
          </button>
        )}
        {task.status === "done" && (
          <button
            type="button"
            className="btn btn--quiet"
            disabled={busy}
            onClick={() => change.mutate("reopen")}
          >
            Reopen
          </button>
        )}
        {task.status === "archived" && (
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={() => change.mutate("reopen")}
          >
            Restore
          </button>
        )}
        {task.status !== "archived" && (
          <button
            type="button"
            className="btn btn--danger"
            disabled={busy}
            onClick={() => change.mutate("archive")}
          >
            Archive
          </button>
        )}
      </div>
      {locked && <p className="quiet quiet--tight">Save or cancel your changes first.</p>}
      {change.isError && (
        <p className="form-error" role="alert">
          {change.error.message}
        </p>
      )}
    </section>
  );
}

// --- History -------------------------------------------------------------------

function History({ id }: { id: number }) {
  const history = useQuery({ queryKey: ["history", id], queryFn: () => getHistory(id) });

  return (
    <section className="history" aria-labelledby="history-title">
      <h2 id="history-title">History</h2>
      {history.isPending ? (
        <p className="quiet quiet--tight">Loading history…</p>
      ) : history.isError ? (
        <p className="form-error" role="alert">
          Couldn't load the history: {history.error.message}
        </p>
      ) : (
        <ol className="timeline">
          {history.data.map((event, i) => {
            const text = describeEvent(event);
            return (
              <li key={i} className="timeline__item">
                <span className="timeline__label">{text.label}</span>
                <span className="timeline__when">{text.when}</span>
                {text.details.length > 0 && (
                  <ul className="timeline__details">
                    {text.details.map((d) => (
                      <li key={d}>{d}</li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
