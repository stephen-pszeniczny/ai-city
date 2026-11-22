// Glass labels over each building. Plain page elements (not inside the 3D
// scene): BeltScene moves them every frame to follow their building, and hides
// them when a building is behind the camera.
import { useQuery } from "@tanstack/react-query";
import type { CSSProperties, RefObject } from "react";

import {
  getBuildings,
  getCheckin,
  getJobsBadge,
  getVaultBadge,
  listTasks,
  type BuildingId,
} from "../api";
import { plannerBadge } from "./badges";
import { BUILT } from "./built";
import { tintOf } from "./tints";

export type LabelElements = Map<BuildingId, HTMLElement>;

export function Labels({
  elements,
  onOpen,
  hidden = false,
}: {
  elements: RefObject<LabelElements>;
  onOpen: (id: BuildingId) => void;
  /** Hidden inside a building (they'd clutter the close-up). */
  hidden?: boolean;
}) {
  const buildings = useQuery({
    queryKey: ["buildings"],
    queryFn: getBuildings,
    staleTime: Infinity,
  });
  const open = useQuery({ queryKey: ["tasks", "open"], queryFn: () => listTasks("open") });
  // The Vault's badge is counts only ("2 overdue", "Statement due"), so it needs no Touch ID.
  const vault = useQuery({
    queryKey: ["vault-badge"],
    queryFn: getVaultBadge,
    refetchInterval: 60_000,
    retry: false,
  });
  // Opportunity Office: "2 platforms to check". Counts only, so no Touch ID.
  const jobs = useQuery({
    queryKey: ["jobs-badge"],
    queryFn: getJobsBadge,
    refetchInterval: 60_000,
    retry: false,
  });
  // "Check-in due" from Sunday noon until the coming week is planned (read only).
  const checkin = useQuery({
    queryKey: ["plan-checkin"],
    queryFn: getCheckin,
    refetchInterval: 60_000,
    retry: false,
  });
  const badges: Partial<Record<BuildingId, string | null>> = {
    planner: open.data ? plannerBadge(open.data, new Date(), checkin.data?.due ?? false) : null,
    finance: vault.data?.text ?? null,
    jobs: jobs.data?.text ?? null,
  };

  return (
    <div className="belt__labels" hidden={hidden}>
      {buildings.data?.map((b) => (
        <button
          key={b.id}
          type="button"
          className="belt-label"
          style={{ "--tint": tintOf(b.id) } as CSSProperties}
          onClick={() => onOpen(b.id)}
          tabIndex={-1} // the hidden building list is the keyboard route
          ref={(el) => {
            if (el) elements.current.set(b.id, el);
            else elements.current.delete(b.id);
          }}
        >
          <span className="belt-label__dot" aria-hidden="true" />
          {b.name}
          {/* Asteroids show it as a holographic banner instead; only the Vault needs the tag. */}
          {!BUILT.has(b.id) && (b.id === "planner" || b.id === "finance") && (
            <span className="belt-label__badge belt-label__badge--soon">Under construction</span>
          )}
          {badges[b.id] && (
            <span className="belt-label__badge belt-label__badge--urgent">{badges[b.id]}</span>
          )}
        </button>
      ))}
    </div>
  );
}
