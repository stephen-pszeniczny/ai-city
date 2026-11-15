// The filter control (Open / Done / Archived / All) and the list of task rows.
// Ticking a row's circle completes the task; unticking reopens it.
// Clicking the rest of the row opens the task's detail view.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";

import { completeTask, listTasks, reopenTask, type ListFilter, type Task } from "../api";
import { categoryLabel } from "./categories";
import { statusNotes } from "./dates";

const FILTERS: readonly { id: ListFilter; label: string; empty: string }[] = [
  { id: "open", label: "Open", empty: "Nothing open. Add a task above." },
  { id: "done", label: "Done", empty: "No finished tasks yet." },
  { id: "archived", label: "Archived", empty: "Nothing archived." },
  { id: "all", label: "All", empty: "No tasks yet. Add one above." },
];

export function Filters({
  value,
  onChange,
}: {
  value: ListFilter;
  onChange: (f: ListFilter) => void;
}) {
  // Shares its cache with the Open list, so it costs nothing extra when Open is shown.
  const open = useQuery({ queryKey: ["tasks", "open"], queryFn: () => listTasks("open") });
  return (
    <div className="segmented" role="group" aria-label="Show tasks">
      {FILTERS.map((f) => (
        <button
          key={f.id}
          type="button"
          className="segmented__item"
          aria-pressed={value === f.id}
          onClick={() => onChange(f.id)}
        >
          {f.label}
          {f.id === "open" && open.data && <span className="count">{open.data.length}</span>}
        </button>
      ))}
    </div>
  );
}

export function TaskList({
  filter,
  focusId,
  onFocusHandled,
  onOpen,
}: {
  filter: ListFilter;
  /** Put keyboard focus on this task's row (after coming back from its detail view). */
  focusId: number | null;
  /** Called once the list has loaded: whether the focusId row was there to focus. */
  onFocusHandled: (found: boolean) => void;
  onOpen: (id: number) => void;
}) {
  const queryClient = useQueryClient();
  const tasks = useQuery({ queryKey: ["tasks", filter], queryFn: () => listTasks(filter) });

  // Waits for a fresh list: the cached one can still show a task that has just
  // left this filter. Runs after the rows' own effects, so a found row has
  // already taken focus.
  const settled = tasks.data !== undefined && !tasks.isFetching;
  useEffect(() => {
    if (focusId === null || !settled) return;
    onFocusHandled(tasks.data.some((t) => t.id === focusId));
  }, [focusId, settled, tasks.data, onFocusHandled]);

  const toggle = useMutation({
    mutationFn: (task: Task) =>
      task.status === "done" ? reopenTask(task.id) : completeTask(task.id),
    onSettled: (_data, _err, task) => {
      void queryClient.invalidateQueries({ queryKey: ["tasks"] });
      void queryClient.invalidateQueries({ queryKey: ["history", task.id] });
    },
  });

  if (tasks.isPending) {
    return (
      <p className="quiet" role="status">
        Loading tasks…
      </p>
    );
  }
  if (tasks.isError) {
    return (
      <p className="form-error" role="alert">
        Couldn't load tasks: {tasks.error.message}
      </p>
    );
  }

  const empty = FILTERS.find((f) => f.id === filter)?.empty;
  const busyId = toggle.isPending ? toggle.variables.id : null;

  return (
    <>
      {toggle.isError && (
        <p className="form-error" role="alert">
          Couldn't update “{toggle.variables.title}”: {toggle.error.message}
        </p>
      )}
      {tasks.data.length === 0 ? (
        <p className="quiet">{empty}</p>
      ) : (
        <ul className="task-list">
          {tasks.data.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              busy={busyId === task.id}
              onToggle={() => toggle.mutate(task)}
              onOpen={() => onOpen(task.id)}
              autoFocus={settled && task.id === focusId}
            />
          ))}
        </ul>
      )}
    </>
  );
}

type RowProps = {
  task: Task;
  busy: boolean;
  onToggle: () => void;
  onOpen: () => void;
  autoFocus: boolean;
};

function TaskRow({ task, busy, onToggle, onOpen, autoFocus }: RowProps) {
  const done = task.status === "done";
  const notes = statusNotes(task);
  const openRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (autoFocus) openRef.current?.focus();
  }, [autoFocus]);
  return (
    <li className={`task-row${done ? " task-row--done" : ""}`}>
      {task.status === "archived" ? (
        <span className="check-spacer" aria-hidden="true" />
      ) : (
        <input
          type="checkbox"
          className="check"
          checked={done}
          disabled={busy}
          onChange={onToggle}
          aria-label={done ? `Reopen “${task.title}”` : `Complete “${task.title}”`}
        />
      )}
      <button
        ref={openRef}
        type="button"
        className="task-row__main"
        onClick={onOpen}
        aria-label={`Open “${task.title}”`}
      >
        <span className="task-row__title">{task.title}</span>
        <span className="task-row__meta">
          <span className={`chip chip--${task.category}`}>{categoryLabel(task.category)}</span>
          {notes.map((n) => (
            <span key={n.text} className={`note note--${n.tone}`}>
              {n.text}
            </span>
          ))}
        </span>
      </button>
    </li>
  );
}
