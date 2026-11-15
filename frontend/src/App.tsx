// The app's pages.
//   /      placeholder home: engine status and a way into the to-do list.
//          The 3D space station scene replaces it in session 9.
//   /todo  City Hall's to-do panel.
import { useQuery } from "@tanstack/react-query";
import { Link, Route, Routes } from "react-router-dom";

import { getHealth } from "./api";
import { TodoPanel } from "./todo/TodoPanel";

export function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route
        path="/todo"
        element={
          <main className="stage">
            <TodoPanel />
          </main>
        }
      />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}

function Home() {
  const health = useQuery({
    queryKey: ["health"],
    queryFn: getHealth,
    refetchInterval: 10_000,
    retry: false,
  });

  const state = health.isPending ? "checking" : health.data?.status === "ok" ? "alive" : "down";
  const label = {
    checking: "Checking engine…",
    alive: "Engine is alive",
    down: "Engine not reachable",
  }[state];

  return (
    <main className="shell">
      <h1>AI City</h1>
      <p className={`status status--${state}`} role="status">
        <span className="dot" aria-hidden="true" />
        {label}
      </p>
      <p>
        <Link className="home-link" to="/todo">
          Open the to-do list
        </Link>
      </p>
      <p className="hint">Skeleton build. The space station arrives in session 9.</p>
    </main>
  );
}

function NotFound() {
  return (
    <main className="shell">
      <h1>Page not found</h1>
      <p>
        <Link className="home-link" to="/">
          Back to the city
        </Link>
      </p>
    </main>
  );
}
