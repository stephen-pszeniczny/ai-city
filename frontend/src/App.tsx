// Placeholder home screen: shows whether the backend engine is reachable.
// The 3D space station scene replaces this in a later session.
import { useQuery } from "@tanstack/react-query";

import { getHealth } from "./api";

export function App() {
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
      <p className="hint">Skeleton build. The space station arrives in session 9.</p>
    </main>
  );
}
