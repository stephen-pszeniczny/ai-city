// Opportunity Office's roster: one card per platform with its status, when it's next
// due for a check, a link to its login page, and a small profile editor (pay range,
// resume label, domains and assessments as chips). Nothing is fetched from platforms.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";

import {
  getPlatforms,
  setPlatformProfile,
  setPlatformStatus,
  type PlatformCard,
  type PlatformStatus,
  type ProfileEdit,
} from "../api";
import { checkLabel } from "./jobs";
import { JobsGate } from "./JobsGate";
import { localToday, PLATFORM_STATUS } from "./labels";

export function PlatformsPanel() {
  return (
    <JobsGate>
      <Platforms />
    </JobsGate>
  );
}

function Platforms() {
  const list = useQuery({ queryKey: ["jobs-platforms"], queryFn: getPlatforms });
  if (list.isPending) return <p className="sw-note">Loading…</p>;
  if (list.isError)
    return (
      <p className="form-error" role="alert">
        {list.error.message}
      </p>
    );
  const { platforms, due, refresh } = list.data;
  return (
    <div className="jobs">
      <div className="jobs__summary">
        <span className="jobs__chip">{platforms.length} platforms</span>
        <span className={`jobs__chip${due.length ? " jobs__chip--warn" : ""}`}>
          {due.length} to check
        </span>
        <span className={`jobs__chip${refresh.length ? " jobs__chip--warn" : ""}`}>
          {refresh.length} profile{refresh.length === 1 ? "" : "s"} to refresh
        </span>
      </div>
      <ul className="jobs__cards" aria-label="Platforms">
        {platforms.map((card) => (
          <Card key={card.id} card={card} />
        ))}
      </ul>
    </div>
  );
}

function Card({ card }: { card: PlatformCard }) {
  const client = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const status = useMutation({
    mutationFn: (s: PlatformStatus) => setPlatformStatus(card.id, s),
    onSuccess: () => {
      setError(null);
      void client.invalidateQueries({ queryKey: ["jobs-platforms"] });
    },
    onError: (err: Error) => setError(err.message),
  });

  return (
    <li className={`jobs-card jobs-card--${card.status}`}>
      <div className="jobs-card__head">
        <strong className="jobs-card__name">{card.name}</strong>
        <select
          className="field jobs-card__status"
          aria-label={`${card.name} status`}
          value={card.status}
          onChange={(e) => status.mutate(e.target.value as PlatformStatus)}
        >
          {Object.entries(PLATFORM_STATUS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>
      <div className="jobs-card__chips">
        <span className={`jobs__chip${card.due ? " jobs__chip--warn" : ""}`}>
          ⏱ {checkLabel(card, localToday())}
        </span>
        {card.pay_low_cents !== null && (
          <span className="jobs__chip">
            ${(card.pay_low_cents / 100).toFixed(0)}
            {card.pay_high_cents !== null && card.pay_high_cents !== card.pay_low_cents
              ? `–${(card.pay_high_cents / 100).toFixed(0)}`
              : ""}{" "}
            {card.pay_currency}/hr
          </span>
        )}
        {card.resume_label && <span className="jobs__chip">📄 {card.resume_label}</span>}
        {card.assessments.map((a) => (
          <span key={a} className="jobs__chip jobs__chip--good">
            ✓ {a}
          </span>
        ))}
        {card.refresh_due && <span className="jobs__chip jobs__chip--warn">Refresh profile</span>}
      </div>
      <div className="jobs-card__actions">
        <a className="btn" href={card.url} target="_blank" rel="noreferrer">
          Open
        </a>
        <button type="button" className="btn btn--quiet" onClick={() => setEditing(!editing)}>
          {editing ? "Close profile" : "Profile"}
        </button>
      </div>
      {editing && <ProfileEditor card={card} onDone={() => setEditing(false)} />}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </li>
  );
}

function ProfileEditor({ card, onDone }: { card: PlatformCard; onDone: () => void }) {
  const client = useQueryClient();
  const cents = (v: number | null) => (v === null ? "" : String(v / 100));
  const [low, setLow] = useState(cents(card.pay_low_cents));
  const [high, setHigh] = useState(cents(card.pay_high_cents));
  const [currency, setCurrency] = useState<"USD" | "CAD">(card.pay_currency ?? "USD");
  const [label, setLabel] = useState(card.resume_label ?? "");
  const [updated, setUpdated] = useState(card.profile_updated_on ?? "");
  const [domains, setDomains] = useState(card.domains);
  const [assessments, setAssessments] = useState(card.assessments);
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: (edit: ProfileEdit) => setPlatformProfile(card.id, edit),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["jobs-platforms"] });
      onDone();
    },
    onError: (err: Error) => setError(err.message),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    const toCents = (v: string) => (v.trim() ? Math.round(Number(v) * 100) : null);
    const lowCents = toCents(low);
    const highCents = toCents(high);
    if ([lowCents, highCents].some((c) => c !== null && !Number.isFinite(c))) {
      setError("Pay must be a number, like 30 or 45.50.");
      return;
    }
    save.mutate({
      pay_low_cents: lowCents,
      pay_high_cents: highCents,
      pay_currency: lowCents === null && highCents === null ? null : currency,
      resume_label: label.trim() || null,
      profile_updated_on: updated || null,
      domains,
      assessments,
    });
  }

  return (
    <form className="jobs-form" onSubmit={submit} aria-label={`${card.name} profile`}>
      <input
        className="field jobs-form__num"
        aria-label="Pay from"
        placeholder="$ from"
        inputMode="decimal"
        value={low}
        onChange={(e) => setLow(e.target.value)}
      />
      <input
        className="field jobs-form__num"
        aria-label="Pay to"
        placeholder="$ to"
        inputMode="decimal"
        value={high}
        onChange={(e) => setHigh(e.target.value)}
      />
      <select
        className="field jobs-form__num"
        aria-label="Currency"
        value={currency}
        onChange={(e) => setCurrency(e.target.value as "USD" | "CAD")}
      >
        <option value="USD">USD</option>
        <option value="CAD">CAD</option>
      </select>
      <input
        className="field"
        aria-label="Resume version"
        placeholder="Resume version"
        maxLength={40}
        value={label}
        onChange={(e) => setLabel(e.target.value)}
      />
      <input
        className="field"
        type="date"
        aria-label="Profile last updated"
        value={updated}
        onChange={(e) => setUpdated(e.target.value)}
      />
      <TagInput label="Domains" tags={domains} onChange={setDomains} />
      <TagInput label="Assessments passed" tags={assessments} onChange={setAssessments} />
      <button type="submit" className="btn" disabled={save.isPending}>
        Save profile
      </button>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}

function TagInput({
  label,
  tags,
  onChange,
}: {
  label: string;
  tags: string[];
  onChange: (tags: string[]) => void;
}) {
  const [text, setText] = useState("");
  function add() {
    const t = text.trim();
    if (t && !tags.includes(t) && tags.length < 20) onChange([...tags, t]);
    setText("");
  }
  return (
    <div className="jobs-tags" role="group" aria-label={label}>
      {tags.map((t) => (
        <span key={t} className="jobs__chip">
          {t}
          <button
            type="button"
            className="jobs-tags__remove"
            aria-label={`Remove ${t}`}
            onClick={() => onChange(tags.filter((x) => x !== t))}
          >
            ×
          </button>
        </span>
      ))}
      <input
        className="field jobs-tags__input"
        aria-label={`Add to ${label}`}
        placeholder={`+ ${label}`}
        maxLength={40}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            add();
          }
        }}
        onBlur={add}
      />
    </div>
  );
}
