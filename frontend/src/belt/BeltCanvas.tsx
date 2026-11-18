// The belt page: the one 3D canvas, drag-to-rotate and scroll-to-zoom, a small
// top bar, and a hidden list of building buttons for keyboard and screen
// readers. Pauses drawing while the window is hidden. If 3D can't run, it
// shows a message with a link to the plain to-do page instead of a blank screen.
import { OrbitControls } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import { useQuery } from "@tanstack/react-query";
import { Component, useEffect, useRef, useState, type ReactNode } from "react";

import { getBuildings, type BuildingId } from "../api";
import { useSampleReminder } from "../todo/useMode";
import { BeltScene } from "./BeltScene";
import { BELT_HOME, CameraRig, type SceneApi } from "./CameraRig";
import { flightState } from "./flightState";
import type { View } from "./levels";
import { Labels, type LabelElements } from "./Labels";
import { ModeSwitch } from "./ModeSwitch";
import { SkyToggle } from "./SkyToggle";
import { useDayNight } from "./useDayNight";
import "./belt.css";

export function BeltCanvas({ view, onOpen }: { view: View; onOpen: (id: BuildingId) => void }) {
  const hidden = usePageHidden();
  const labels = useRef<LabelElements>(new Map());
  const api = useRef<SceneApi | null>(null);
  const [reducedMotion] = useState(() => matchMedia("(prefers-reduced-motion: reduce)").matches);
  const sample = useSampleReminder();
  const sky = useDayNight();
  const buildings = useQuery({
    queryKey: ["buildings"],
    queryFn: getBuildings,
    staleTime: Infinity,
  });

  return (
    <main className="belt" onPointerDown={() => flightState.skip()}>
      <ThreeErrorBoundary>
        <Canvas
          className="belt__canvas"
          frameloop={hidden ? "never" : "always"}
          dpr={[1, 2]}
          gl={{ antialias: false, powerPreference: "high-performance" }}
          camera={{ fov: 38, near: 0.5, far: 20000, position: [...BELT_HOME.position] }}
        >
          <BeltScene view={view} onOpen={onOpen} labels={labels} api={api} sky={sky} />
          <CameraRig view={view} api={api} reducedMotion={reducedMotion} />
          <OrbitControls
            makeDefault
            enableDamping
            dampingFactor={0.06}
            enablePan={false}
            minDistance={24}
            maxDistance={320}
            maxPolarAngle={1.5}
          />
        </Canvas>
        {/* Inside the boundary: if 3D fails, the labels go with it. */}
        <Labels elements={labels} onOpen={onOpen} hidden={view.level !== "belt"} />
      </ThreeErrorBoundary>

      <header className="belt__top">
        <span className="belt__brand">Asteroid Belt</span>
        {sample && <span className="belt__sample">Sample data</span>}
        {/* Switching is done from the belt only, never from inside a building. */}
        {view.level === "belt" && <SkyToggle choice={sky.choice} onCycle={sky.cycle} />}
        {view.level === "belt" && <ModeSwitch />}
      </header>

      {buildings.isError && (
        <p className="belt__error" role="alert">
          Building names couldn't load: {buildings.error.message}
        </p>
      )}

      <nav className="belt__keys" aria-label="Buildings" hidden={view.level !== "belt"}>
        {buildings.data?.map((b) => (
          <button key={b.id} type="button" onClick={() => onOpen(b.id)}>
            Open {b.name}
          </button>
        ))}
      </nav>
    </main>
  );
}

function usePageHidden(): boolean {
  const [hidden, setHidden] = useState(() => document.hidden);
  useEffect(() => {
    const on = () => setHidden(document.hidden);
    document.addEventListener("visibilitychange", on);
    // Check again now: if the page became visible between the first render and
    // this listener starting, that change was missed and drawing would stay paused.
    on();
    return () => document.removeEventListener("visibilitychange", on);
  }, []);
  return hidden;
}

class ThreeErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="belt__fallback" role="alert">
        <h1>3D isn't available in this browser</h1>
        <p>The belt needs WebGL, which is turned off or failed to start.</p>
        <a href="/todo">Open the to-do list instead</a>
      </div>
    );
  }
}
