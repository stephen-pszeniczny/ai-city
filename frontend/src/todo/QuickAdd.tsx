// The add-a-task form: title, category and goal date in one row; notes and
// reminder behind "More options". The Sample reminder sits right under it so
// it's seen at the moment of adding.
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRef, useState, type FormEvent } from "react";

import { createTask, type Category } from "../api";
import { CATEGORIES } from "./categories";
import { WarningIcon } from "./ModeBanner";
import { useSampleReminder } from "./useMode";

export function QuickAdd() {
  const queryClient = useQueryClient();
  const showSample = useSampleReminder();
  const titleRef = useRef<HTMLInputElement>(null);

  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<Category>("personal");
  const [goalDate, setGoalDate] = useState("");
  const [moreOpen, setMoreOpen] = useState(false);
  const [notes, setNotes] = useState("");
  const [reminder, setReminder] = useState("");
  const [error, setError] = useState<string | null>(null);

  const add = useMutation({
    mutationFn: createTask,
    onSuccess: () => {
      // Keep the category and the options panel; clear what belongs to this task.
      setTitle("");
      setGoalDate("");
      setNotes("");
      setReminder("");
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ["tasks"] });
      titleRef.current?.focus();
    },
    // Show the backend's own message; the form keeps what was typed.
    onError: (err: Error) => setError(err.message),
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    if (add.isPending) return;
    if (title.trim() === "") {
      setError("Type a task first.");
      titleRef.current?.focus();
      return;
    }
    add.mutate({
      title,
      category,
      notes,
      goal_date: goalDate || null,
      reminder_at: reminder || null,
    });
  }

  return (
    <form className="quick-add" onSubmit={submit} aria-label="Add a task" noValidate>
      <div className="quick-add__row">
        <label className="sr-only" htmlFor="qa-title">
          Task
        </label>
        <input
          ref={titleRef}
          id="qa-title"
          className="field quick-add__title"
          placeholder="Add a task"
          autoComplete="off"
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
            setError(null); // an old message no longer describes what's typed
          }}
          aria-invalid={error !== null}
          aria-describedby={error ? "qa-error" : undefined}
        />
        <label className="sr-only" htmlFor="qa-category">
          Category
        </label>
        <select
          id="qa-category"
          className="field"
          value={category}
          onChange={(e) => setCategory(e.target.value as Category)}
        >
          {CATEGORIES.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
        <label className="sr-only" htmlFor="qa-date">
          Goal date (optional)
        </label>
        <input
          id="qa-date"
          type="date"
          className="field"
          value={goalDate}
          onChange={(e) => setGoalDate(e.target.value)}
        />
        <button type="submit" className="btn" disabled={add.isPending}>
          {add.isPending ? "Adding…" : "Add"}
        </button>
      </div>

      {error && (
        <p id="qa-error" className="form-error" role="alert">
          {error}
        </p>
      )}

      <div className="quick-add__under">
        {showSample && (
          <p className="sample-line">
            <WarningIcon />
            Sample mode: this goes into demo data, not your real list.
          </p>
        )}
        <button
          type="button"
          className="link-btn"
          aria-expanded={moreOpen}
          aria-controls="qa-more"
          onClick={() => setMoreOpen((open) => !open)}
        >
          {moreOpen ? "Fewer options" : "More options"}
        </button>
      </div>

      {moreOpen && (
        <div id="qa-more" className="quick-add__more">
          <label className="field-label">
            Reminder
            <input
              type="datetime-local"
              className="field"
              value={reminder}
              onChange={(e) => setReminder(e.target.value)}
            />
          </label>
          <label className="field-label">
            Notes
            <textarea
              className="field"
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </label>
        </div>
      )}
    </form>
  );
}
