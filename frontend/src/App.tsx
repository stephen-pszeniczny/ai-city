// The app's pages.
//   /todo        Mission Control's to-do panel on its own page (also the
//                fallback when 3D isn't available).
//   everything   the belt, at one of three levels taken from the address:
//   else         /  the belt · /b/<id>  inside a building · /b/<id>/screen  its screen.
//                One 3D canvas stays mounted across all three, so the camera
//                flies between them instead of the page reloading.
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import {
  createBrowserRouter,
  Navigate,
  useBlocker,
  useLocation,
  useNavigate,
} from "react-router-dom";

import { getBuildings, type BuildingId } from "./api";
import { HoldProvider } from "./belt/HoldContext";
import { BeltCanvas } from "./belt/BeltCanvas";
import { BuildingXpBar } from "./belt/BuildingXpBar";
import { escapeAction, flightState } from "./belt/flightState";
import { back, otherStationRoom, parsePath, toPath, type View } from "./belt/levels";
import { confirmLeave, isDirty, setDirty } from "./leaveGuard";
import { Desktop } from "./desktop/Desktop";
import { stepsToTask } from "./notifications/journey";
import { Ticker } from "./notifications/Ticker";
import { useNotifications } from "./notifications/useNotifications";
import { requestOpenTask, takeOpenTaskRequest } from "./todo/openRequest";
import { TodoPanel } from "./todo/TodoPanel";

export const router = createBrowserRouter([
  {
    path: "/todo",
    element: (
      <main className="stage">
        <TodoPanel />
      </main>
    ),
  },
  { path: "*", element: <BeltHome /> },
]);

function BeltHome() {
  const location = useLocation();
  const navigate = useNavigate();
  const view = parsePath(location.pathname);
  const buildings = useQuery({
    queryKey: ["buildings"],
    queryFn: getBuildings,
    staleTime: Infinity,
  });
  const nameOf = (id: BuildingId) => buildings.data?.find((b) => b.id === id)?.name ?? "";
  const notifications = useNotifications(view.level === "belt");
  const [reducedMotion] = useState(() => matchMedia("(prefers-reduced-motion: reduce)").matches);

  // Opening a task from the ticker: the normal flights, one level at a time, each
  // step waiting for the camera to finish the last one.
  const [journey, setJourney] = useState<View[]>([]);
  function openTask(taskId: number) {
    const steps = stepsToTask(view);
    if (steps.length === 0) return;
    if (!confirmLeave()) return;
    setDirty(false);
    requestOpenTask(taskId);
    setJourney(steps);
  }
  useEffect(() => {
    if (journey.length === 0) return;
    const id = window.setInterval(() => {
      if (flightState.flying()) return;
      const [next, ...rest] = journey;
      if (next) navigate(toPath(next));
      setJourney(rest);
    }, 250);
    return () => window.clearInterval(id);
  }, [journey, navigate]);

  /** Leave the current level, asking first if there are unsaved edits. */
  const go = (next: View) => {
    if (!confirmLeave()) return;
    setDirty(false); // already confirmed: don't ask again on the way out
    // Going somewhere yourself cancels a ticker trip still under way (and its task request).
    setJourney([]);
    takeOpenTaskRequest();
    navigate(toPath(next));
  };

  function open(id: BuildingId) {
    // Clicking the building you're already in goes to its screen.
    if (view.level === "building" && view.id === id) go({ level: "screen", id });
    else if (view.level === "belt") go({ level: "building", id });
  }

  // Escape finishes a flight first; otherwise steps out one level.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      // Escape inside a text field belongs to the field (and protects a half-typed task).
      const el = e.target as HTMLElement | null;
      const inTextField =
        !!el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName));
      const action = escapeAction({
        flying: flightState.flying(),
        inTextField,
        atBelt: view.level === "belt",
      });
      if (action === "skip") flightState.skip();
      else if (action === "back") go(back(view));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // The browser's Back button: same unsaved-edits rule.
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      isDirty() &&
      parsePath(currentLocation.pathname).level === "screen" &&
      nextLocation.pathname !== currentLocation.pathname,
  );
  useEffect(() => {
    if (blocker.state !== "blocked") return;
    if (confirmLeave()) {
      setDirty(false);
      blocker.proceed();
    } else {
      blocker.reset();
    }
  }, [blocker]);

  // Unknown addresses (e.g. /b/nope) are tidied up to the belt.
  if (location.pathname !== toPath(view)) return <Navigate to={toPath(view)} replace />;

  return (
    <>
      <HoldProvider hold={view.level === "screen"}>
        <BeltCanvas view={view} onOpen={open} notifications={notifications} />
      </HoldProvider>

      {view.level !== "belt" && (
        <button type="button" className="belt__back" onClick={() => go(back(view))}>
          <span aria-hidden="true">‹</span>{" "}
          {view.level === "screen" ? nameOf(view.id) || "Back" : "Belt"}
        </button>
      )}

      {view.level === "building" && otherStationRoom(view.id) && (
        <button
          type="button"
          className="belt__back belt__next"
          onClick={() => go({ level: "building", id: otherStationRoom(view.id)! })}
        >
          {nameOf(otherStationRoom(view.id)!)} <span aria-hidden="true">›</span>
        </button>
      )}

      {view.level === "building" && (
        <div className="belt__inside">
          <h1 className="belt__inside-name">{nameOf(view.id)}</h1>
          <button
            type="button"
            className="belt__use"
            onClick={() => go({ level: "screen", id: view.id })}
          >
            Use the computer
          </button>
        </div>
      )}

      {view.level === "building" && (
        <BuildingXpBar key={view.id} id={view.id} name={nameOf(view.id)} />
      )}

      {view.level === "screen" && <Desktop key={view.id} id={view.id} name={nameOf(view.id)} />}

      {/* Reminders: on the belt and inside buildings, not on the computer screen. */}
      {view.level !== "screen" && (
        <Ticker
          items={notifications.items}
          reducedMotion={reducedMotion}
          onOpen={openTask}
          onDismiss={notifications.dismiss}
        />
      )}
    </>
  );
}
