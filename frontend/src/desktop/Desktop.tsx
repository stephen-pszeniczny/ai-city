// Level 3: zoomed into the robot's screen, which becomes a modern all-in-one computer
// (thin dark border, aluminium chin and stand; no real brand). Menu bar on top; one
// glass window whose left side lists the building's apps as glass buttons (the open one
// glows with a blue bar); the open app fills the rest and slides in when switched.
// The desktop background is tinted with the building's colour (deskTheme).
import { useEffect, useRef, useState, type CSSProperties } from "react";

import type { BuildingId } from "../api";
import { CheckinPanel } from "../plan/CheckinPanel";
import { GroceryPanel } from "../plan/GroceryPanel";
import { LogPanel } from "../jobs/LogPanel";
import { PlatformsPanel } from "../jobs/PlatformsPanel";
import { PlanPanel } from "../plan/PlanPanel";
import { TodoPanel } from "../todo/TodoPanel";
import { IncomePanel } from "../vault/IncomePanel";
import { SideWorkPanel } from "../vault/SideWorkPanel";
import { StatementsPanel } from "../vault/StatementsPanel";
import { useSampleReminder } from "../todo/useMode";
import { GlassButton } from "../ui/Kit";
import { appsFor, type App } from "./apps";
import { appListLayout, switchMode } from "./appTabs";
import { deskTheme } from "./deskTheme";
import "./desktop.css";

const ICONS: Record<string, string> = {
  todo: "✓",
  plan: "☀",
  checkin: "☑",
  grocery: "🛒",
  projects: "⚒",
  sidework: "⏱",
  income: "$",
  statements: "▤",
  platforms: "🛰",
  log: "✎",
  construction: "⚠",
};

export function Desktop({ id, name }: { id: BuildingId; name: string }) {
  const apps = appsFor(id);
  const firstReady = apps.find((a) => a.ready)?.id ?? null;
  const [openApp, setOpenApp] = useState<string>(firstReady ?? "construction");
  const [note, setNote] = useState<string | null>(null);
  const sample = useSampleReminder();
  const clock = useClock();
  const reduceMotion = useReducedMotion();
  const theme = deskTheme(id);
  const layout = appListLayout(apps.length);
  const paneRef = useRef<HTMLDivElement>(null);

  // Keyboard and screen-reader focus moves into the open app.
  useEffect(() => {
    paneRef.current?.focus({ preventScroll: true });
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
      <section
        className="monitor kit"
        aria-label={`${name} computer`}
        style={{ "--desk-accent": theme.accent } as CSSProperties}
      >
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

          <div className="desktop" style={{ backgroundImage: theme.wallpaper }}>
            <div className="window">
              <nav
                className={`window__apps${layout.scroll ? " is-scrolling" : ""}`}
                aria-label="Apps"
              >
                <div className="window__lights" aria-hidden="true">
                  <i />
                  <i />
                  <i />
                </div>
                {apps.map((app) => (
                  <GlassButton
                    key={app.id}
                    active={openApp === app.id}
                    icon={ICONS[app.id] ?? "•"}
                    className={app.ready ? "" : "is-later"}
                    onClick={() => launch(app)}
                    aria-label={app.ready ? `Open ${app.name}` : `${app.name} (coming later)`}
                  >
                    {app.name}
                  </GlassButton>
                ))}
              </nav>
              <div
                key={openApp}
                className={`window__pane window__pane--${switchMode(reduceMotion)}`}
                role="region"
                aria-label={windowTitle(openApp, apps)}
                ref={paneRef}
                tabIndex={-1}
              >
                {openApp === "todo" ? (
                  <TodoPanel />
                ) : openApp === "plan" ? (
                  <PlanPanel />
                ) : openApp === "checkin" ? (
                  <CheckinPanel />
                ) : openApp === "grocery" ? (
                  <GroceryPanel />
                ) : openApp === "sidework" ? (
                  <SideWorkPanel />
                ) : openApp === "income" ? (
                  <IncomePanel />
                ) : openApp === "statements" ? (
                  <StatementsPanel />
                ) : openApp === "platforms" ? (
                  <PlatformsPanel />
                ) : openApp === "log" ? (
                  <LogPanel />
                ) : (
                  <UnderConstruction name={name} />
                )}
              </div>
            </div>
            {note && (
              <p className="desktop__note" role="status">
                {note}
              </p>
            )}
          </div>
          <div className="monitor__glare" aria-hidden="true" />
        </div>
        <div className="monitor__chin" aria-hidden="true" />
        <div className="monitor__stand" aria-hidden="true" />
        <div className="monitor__foot" aria-hidden="true" />
      </section>
    </div>
  );
}

/** True when the Mac asks for less motion (switching apps is then instant). */
function useReducedMotion(): boolean {
  const query = "(prefers-reduced-motion: reduce)";
  const [reduce, setReduce] = useState(() => window.matchMedia?.(query).matches ?? false);
  useEffect(() => {
    const mq = window.matchMedia?.(query);
    if (!mq) return;
    const on = () => setReduce(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return reduce;
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
