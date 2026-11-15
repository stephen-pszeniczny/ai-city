// City Hall's to-do list as one floating glass panel.
//
// Self-contained on purpose: today it has its own page (/todo); in session 9
// the same panel opens from a monitor inside the City Hall scene.
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";

import { getHealth, type ListFilter } from "../api";
import { ModeBanner } from "./ModeBanner";
import { QuickAdd } from "./QuickAdd";
import { Filters, TaskList } from "./TaskList";
import "./todo.css";

export function TodoPanel() {
  const [filter, setFilter] = useState<ListFilter>("open");
  const health = useQuery({
    queryKey: ["health"],
    queryFn: getHealth,
    refetchInterval: 10_000,
    retry: false,
  });

  return (
    <section className="panel" aria-labelledby="todo-title">
      <header className="panel__head">
        <Link className="back-link" to="/">
          <span aria-hidden="true">‹</span> City
        </Link>
        <h1 id="todo-title">To-do</h1>
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
            <TaskList filter={filter} />
          </>
        )}
      </div>
    </section>
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
