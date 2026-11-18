// Mission Control's to-do list as one floating glass panel.
//
// Self-contained on purpose: today it has its own page (/todo); in session 9
// the same panel opens from a monitor inside the Mission Control scene.
// Clicking a task swaps the list for that task's detail view in the same panel.
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";

import { peekOpenTaskRequest, takeOpenTaskRequest } from "./openRequest";
import { Link } from "react-router-dom";

import { getHealth, type ListFilter, type Task, type TaskStatus } from "../api";
import { ModeBanner } from "./ModeBanner";
import { QuickAdd } from "./QuickAdd";
import { TaskDetail } from "./TaskDetail";
import { Filters, TaskList } from "./TaskList";
import { UndoToast, type Archived } from "./UndoToast";
import "./todo.css";

export function TodoPanel() {
  const [filter, setFilter] = useState<ListFilter>("open");
  // A reminder clicked in the ticker opens straight onto its task.
  const [openId, setOpenId] = useState<number | null>(() => peekOpenTaskRequest());
  useEffect(() => {
    takeOpenTaskRequest(); // used: don't reopen it next time the panel appears
  }, []);
  // The task to put keyboard focus back on when returning to the list.
  const [returnTo, setReturnTo] = useState<number | null>(null);
  const [archived, setArchived] = useState<Archived | null>(null);
  const clearArchived = useCallback(() => setArchived(null), []);
  const listHeadingRef = useRef<HTMLHeadingElement>(null);

  const health = useQuery({
    queryKey: ["health"],
    queryFn: getHealth,
    refetchInterval: 10_000,
    retry: false,
  });

  function backToList() {
    setReturnTo(openId);
    setOpenId(null);
  }

  function handleArchived(task: Task, previous: TaskStatus) {
    setArchived({ task, previous });
    setReturnTo(null);
    setOpenId(null);
  }

  return (
    <>
      <section className="panel" aria-labelledby="todo-title">
        {openId !== null ? (
          <TaskDetail key={openId} id={openId} onBack={backToList} onArchived={handleArchived} />
        ) : (
          <>
            <header className="panel__head">
              <Link className="back-link" to="/">
                <span aria-hidden="true">‹</span> Belt
              </Link>
              <h1 id="todo-title" ref={listHeadingRef} tabIndex={-1}>
                To-do
              </h1>
            </header>

            <ModeBanner />

            <div className="panel__body">
              {health.isPending ? (
                <p className="quiet" role="status">
                  Connecting to the engine…
                </p>
              ) : health.isError ? (
                <EngineDown onRetry={() => void health.refetch()} retrying={health.isFetching} />
              ) : (
                <>
                  <QuickAdd />
                  <Filters value={filter} onChange={setFilter} />
                  <TaskList
                    filter={filter}
                    focusId={returnTo}
                    onFocusHandled={(found) => {
                      // The task may have left this list (e.g. restored while on Archived).
                      if (!found) listHeadingRef.current?.focus();
                      setReturnTo(null);
                    }}
                    onOpen={(id) => {
                      setArchived(null);
                      setOpenId(id);
                    }}
                  />
                </>
              )}
            </div>
          </>
        )}
      </section>

      {/* Outside the panel: the panel's blur would otherwise trap and clip it. */}
      {archived && <UndoToast key={archived.task.id} archived={archived} onDone={clearArchived} />}
    </>
  );
}

function EngineDown({ onRetry, retrying }: { onRetry: () => void; retrying: boolean }) {
  return (
    <div className="engine-down" role="alert">
      <h2>Engine not reachable</h2>
      <p>
        The backend isn't running, so tasks can't load or save. Start it from the project folder
        with <code>.venv/bin/python scripts/run_app.py</code>. This page reconnects on its own.
      </p>
      <button type="button" className="btn" onClick={onRetry} disabled={retrying}>
        {retrying ? "Checking…" : "Check again"}
      </button>
    </div>
  );
}
