// The design kit: the few building blocks every desk-computer app is made from, so
// all screens share one look (blue, grey and black glass) and one spacing scale.
// Styles live in kit.css; wrap a screen in <div className="kit"> to use the tokens.
import type { ButtonHTMLAttributes, ReactNode } from "react";

import { progressPercent } from "./kitMath";
import "./kit.css";

type GlassButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  active?: boolean;
  icon?: ReactNode;
};

/** A frosted rectangle; `active` glows blue with a thin bar on its left edge. */
export function GlassButton({
  active = false,
  icon,
  children,
  className = "",
  ...rest
}: GlassButtonProps) {
  return (
    <button
      type="button"
      className={`kit-btn${active ? " is-active" : ""} ${className}`.trim()}
      aria-current={active ? "page" : undefined}
      {...rest}
    >
      {icon !== undefined && (
        <span className="kit-btn__icon" aria-hidden="true">
          {icon}
        </span>
      )}
      <span className="kit-btn__label">{children}</span>
    </button>
  );
}

/** A glass tile with a small label above a value. */
export function Tile({
  label,
  value,
  children,
}: {
  label: string;
  value?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="kit-tile">
      <span className="kit-tile__label">{label}</span>
      {value !== undefined && <span className="kit-tile__value">{value}</span>}
      {children}
    </div>
  );
}

/** A small rounded label; tone colours it for warnings or good news. */
export function Chip({
  children,
  tone = "default",
}: {
  children: ReactNode;
  tone?: "default" | "warn" | "good";
}) {
  return <span className={`kit-chip kit-chip--${tone}`}>{children}</span>;
}

/** A titled group of content with even spacing. */
export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="kit-section">
      <h3 className="kit-section__title">{title}</h3>
      {children}
    </section>
  );
}

/** A thin bar filled to `value` (0..1). */
export function ProgressBar({ value, label }: { value: number; label?: string }) {
  return (
    <div
      className="kit-progress"
      role="progressbar"
      aria-valuenow={Math.round(value * 100)}
      aria-label={label}
    >
      <span className="kit-progress__fill" style={{ width: progressPercent(value) }} />
    </div>
  );
}

/** A labelled form field wrapper (the input goes inside). */
export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="kit-field">
      <span className="kit-field__label">{label}</span>
      {children}
    </label>
  );
}
