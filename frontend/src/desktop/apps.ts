// The apps on each building's desktop (its modules, spec section 7).
// Built so far: Mission Control's To-do and the Vault's Side work; the rest is "later"
// or under construction.
import type { BuildingId } from "../api";

export type App = { id: string; name: string; ready: boolean };

const MISSION_CONTROL: readonly App[] = [
  { id: "todo", name: "To-do", ready: true },
  { id: "plan", name: "Daily plan", ready: false },
  { id: "review", name: "Weekly review", ready: false },
  { id: "projects", name: "Projects", ready: false },
];

const VAULT: readonly App[] = [
  { id: "sidework", name: "Side work", ready: true },
  { id: "income", name: "Income", ready: true },
  { id: "statements", name: "Statements", ready: true },
];

export function appsFor(id: BuildingId): App[] {
  if (id === "planner") return MISSION_CONTROL.map((a) => ({ ...a }));
  if (id === "finance") return VAULT.map((a) => ({ ...a }));
  return [{ id: "construction", name: "Under construction", ready: false }];
}
