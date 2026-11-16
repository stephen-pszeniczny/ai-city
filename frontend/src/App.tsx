// The app's pages.
//   /      the belt: the 3D home screen. Clicking Mission Control opens its
//          to-do list; other buildings are under construction. (Flying into
//          each building comes with the level work in the next step.)
//   /todo  Mission Control's to-do panel on its own page (also the fallback
//          when 3D isn't available).
import { useState } from "react";
import { Link, Route, Routes, useNavigate } from "react-router-dom";

import type { BuildingId } from "./api";
import { BeltCanvas } from "./belt/BeltCanvas";
import { BUILT } from "./belt/built";
import { TodoPanel } from "./todo/TodoPanel";

export function App() {
  return (
    <Routes>
      <Route path="/" element={<BeltHome />} />
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

function BeltHome() {
  const navigate = useNavigate();
  const [note, setNote] = useState<string | null>(null);

  function open(id: BuildingId) {
    if (id === "planner") {
      navigate("/todo");
      return;
    }
    setNote(BUILT.has(id) ? null : "That building is under construction.");
    window.setTimeout(() => setNote(null), 2500);
  }

  return (
    <>
      <BeltCanvas onOpen={open} />
      {note && (
        <p className="belt__note" role="status">
          {note}
        </p>
      )}
    </>
  );
}

function NotFound() {
  return (
    <main className="shell">
      <h1>Page not found</h1>
      <p>
        <Link className="home-link" to="/">
          Back to the belt
        </Link>
      </p>
    </main>
  );
}
