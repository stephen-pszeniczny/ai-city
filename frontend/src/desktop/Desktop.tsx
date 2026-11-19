// Level 3: zoomed into the robot's screen, which becomes a desktop computer
// (the approved prototype, monitor 10% bigger): bezel and chin, menu bar,
// the building's apps in a dock, the open app in its own scrolling window.
// The real 3D room or asteroid keeps moving around the monitor's edges.
import { useEffect, useRef, useState } from "react";

import type { BuildingId } from "../api";
import { CheckinPanel } from "../plan/CheckinPanel";
import { PlanPanel } from "../plan/PlanPanel";
import { TodoPanel } from "../todo/TodoPanel";
import { IncomePanel } from "../vault/IncomePanel";
import { SideWorkPanel } from "../vault/SideWorkPanel";
import { StatementsPanel } from "../vault/StatementsPanel";
import { useSampleReminder } from "../todo/useMode";
import { appsFor, type App } from "./apps";
import "./desktop.css";

const ICONS: Record<string, string> = {
  todo: "✓",
  plan: "☀",
  checkin: "☑",
  projects: "⚒",
  sidework: "⏱",
  income: "$",
  statements: "▤",
  construction: "⚠",
};

export function Desktop({ id, name }: { id: BuildingId; name: string }) {
  const apps = appsFor(id);
  const firstReady = apps.find((a) => a.ready)?.id ?? null;
  const [openApp, setOpenApp] = useState<string | null>(firstReady ?? "construction");
  const [note, setNote] = useState<string | null>(null);
  const sample = useSampleReminder();
  const clock = useClock();
  const windowRef = useRef<HTMLDivElement>(null);

  // Keyboard and screen-reader focus moves into the open window. (The window
  // itself, named by its title: the app's own heading is hidden in here.)
  useEffect(() => {
    windowRef.current?.focus({ preventScroll: true });
  }, [openApp]);

  function launch(app: App) {
    if (app.id === "construction") {
      setOpenApp("construction");
      return;
    }
    if (!app.ready) {
      setNote(`${app.name} arrives in a later phase.`);
      window.setTimeout(() => setNote(null), 2500);
      return;
    }
    setOpenApp(app.id);
  }

  return (
    <div className="desk-zoom">
      <section className="monitor" aria-label={`${name} computer`}>
        <div className="monitor__screen">
          <header className="menubar">
            <span className="menubar__logo" aria-hidden="true">
              <RobotGlyph />
            </span>
            <strong>{name}</strong>
            <span className="menubar__spacer" />
            {sample && <span className="menubar__sample">Sample data</span>}
            <span className="menubar__clock">{clock}</span>
          </header>

          <div className="desktop">
            {openApp ? (
              <div
                className="window"
                role="dialog"
                aria-label={windowTitle(openApp, apps)}
                ref={windowRef}
                tabIndex={-1}
              >
                <div className="window__bar">
                  <button
                    type="button"
                    className="window__close"
                    aria-label={`Close ${windowTitle(openApp, apps)}`}
                    onClick={() => setOpenApp(null)}
                  />
                  <span className="window__title">{windowTitle(openApp, apps)}</span>
                </div>
                <div className="window__body">
                  {openApp === "todo" ? (
                    <TodoPanel />
                  ) : openApp === "plan" ? (
                    <PlanPanel />
                  ) : openApp === "checkin" ? (
                    <CheckinPanel />
                  ) : openApp === "sidework" ? (
                    <SideWorkPanel />
                  ) : openApp === "income" ? (
                    <IncomePanel />
                  ) : openApp === "statements" ? (
                    <StatementsPanel />
                  ) : (
                    <UnderConstruction name={name} />
                  )}
                </div>
              </div>
            ) : (
              <p className="desktop__hint">Choose an app from the dock.</p>
            )}
            {note && (
              <p className="desktop__note" role="status">
                {note}
              </p>
            )}
          </div>

          <nav className="dock" aria-label="Apps">
            {apps.map((app) => (
              <button
                key={app.id}
                type="button"
                className={`dock__app${app.ready ? "" : " dock__app--later"}`}
                onClick={() => launch(app)}
                aria-label={app.ready ? `Open ${app.name}` : `${app.name} (coming later)`}
              >
                <span className="dock__icon" aria-hidden="true">
                  {ICONS[app.id] ?? "•"}
                </span>
                <span className="dock__name">{app.name}</span>
                {openApp === app.id && <span className="dock__dot" aria-hidden="true" />}
              </button>
            ))}
          </nav>
          <div className="monitor__glare" aria-hidden="true" />
        </div>
        <div className="monitor__chin" aria-hidden="true">
          <span className="monitor__led" />
        </div>
      </section>
    </div>
  );
}

function windowTitle(openApp: string, apps: App[]): string {
  return apps.find((a) => a.id === openApp)?.name ?? "Under construction";
}

function UnderConstruction({ name }: { name: string }) {
  return (
    <div className="construction">
      <h2>Under construction</h2>
      <p>{name}'s screens arrive in a later phase.</p>
      <div className="construction__stripes" aria-hidden="true" />
    </div>
  );
}

function useClock(): string {
  const fmt = () => new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  const [now, setNow] = useState(fmt);
  useEffect(() => {
    const t = window.setInterval(() => setNow(fmt()), 15_000);
    return () => window.clearInterval(t);
  }, []);
  return now;
}

function RobotGlyph() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14">
      <rect x="3" y="4" width="10" height="8" rx="2.5" fill="currentColor" />
      <circle cx="6.2" cy="8" r="1.1" fill="#0b1630" />
      <circle cx="9.8" cy="8" r="1.1" fill="#0b1630" />
      <rect x="7.4" y="1.5" width="1.2" height="2.5" fill="currentColor" />
      <circle cx="8" cy="1.5" r="1" fill="currentColor" />
    </svg>
  );
}
