// The app's pages.
//   /todo        Mission Control's to-do panel on its own page (also the
//                fallback when 3D isn't available).
//   everything   the belt, at one of three levels taken from the address:
//   else         /  the belt · /b/<id>  inside a building · /b/<id>/screen  its screen.
//                One 3D canvas stays mounted across all three, so the camera
//                flies between them instead of the page reloading.
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import {
  createBrowserRouter,
  Navigate,
  useBlocker,
  useLocation,
  useNavigate,
} from "react-router-dom";

import { getBuildings, type BuildingId } from "./api";
import { BeltCanvas } from "./belt/BeltCanvas";
import { back, parsePath, toPath, type View } from "./belt/levels";
import { confirmLeave, isDirty, setDirty } from "./leaveGuard";
import { Desktop } from "./desktop/Desktop";
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

  /** Leave the current level, asking first if there are unsaved edits. */
  const go = (next: View) => {
    if (!confirmLeave()) return;
    setDirty(false); // already confirmed: don't ask again on the way out
    navigate(toPath(next));
  };

  function open(id: BuildingId) {
    // Clicking the building you're already in goes to its screen.
    if (view.level === "building" && view.id === id) go({ level: "screen", id });
    else if (view.level === "belt") go({ level: "building", id });
  }

  // Escape steps out one level.
  useEffect(() => {
    if (view.level === "belt") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      // Escape inside a text field belongs to the field (and protects a half-typed task).
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName))) {
        return;
      }
      go(back(view));
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
      <BeltCanvas view={view} onOpen={open} />

      {view.level !== "belt" && (
        <button type="button" className="belt__back" onClick={() => go(back(view))}>
          <span aria-hidden="true">‹</span>{" "}
          {view.level === "screen" ? nameOf(view.id) || "Back" : "Belt"}
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

      {view.level === "screen" && <Desktop key={view.id} id={view.id} name={nameOf(view.id)} />}
    </>
  );
}
