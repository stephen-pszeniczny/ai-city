// The Vault's Income app: this month against the goal (gross, with net beside
// it), recent months stacked by source, side work by platform, the tax
// set-aside, and main-job pay with its stub details. Main-job pay can be typed in
// on payday ("not yet confirmed"); the month-end statement confirms it.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import {
  addMainJob,
  archiveMainJob,
  editMainJob,
  getIncome,
  type IncomeView,
  type MainJobPay,
} from "../api";
import { StackedMonths } from "./charts";
import { goalProgress, payStatus } from "./income";
import { formatCad, formatDay } from "./sideWork";
import { errorText, todayIso, VaultGate } from "./VaultGate";

const KEY = ["income"];

export function IncomePanel() {
  return (
    <VaultGate>
      <Income />
    </VaultGate>
  );
}

function Income() {
  const view = useQuery({ queryKey: KEY, queryFn: getIncome, retry: false });
  if (view.status === "pending") return <p className="sw-note">Adding it up…</p>;
  if (view.status === "error") return <p className="sw-note">{errorText(view.error)}</p>;
  const v = view.data;
  return (
    <div className="sw">
      <ThisMonth v={v} />
      <section aria-labelledby="in-months">
        <h3 id="in-months" className="sw-h">
          Last 6 months
        </h3>
        <StackedMonths months={v.months} goalCents={v.month.goal_cents} />
      </section>
      <Platforms v={v} />
      <MainJobPays v={v} />
    </div>
  );
}

function ThisMonth({ v }: { v: IncomeView }) {
  const m = v.month;
  const progress = goalProgress(m.gross_cents, m.goal_cents);
  return (
    <section className="sw-summary" aria-label="This month">
      <div className="sw-tile in-goal">
        <span className="sw-tile__label">This month, gross</span>
        <strong>{formatCad(m.gross_cents)}</strong>
        <div
          className="in-bar"
          role="meter"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.min(100, progress.percent)}
          aria-label={progress.label}
        >
          <span style={{ width: `${progress.fill * 100}%` }} />
        </div>
        <span className="sw-tile__label">
          {progress.label} ({formatCad(m.goal_cents)})
          {m.gross_missing && <span className="sw-chip">gross missing</span>}
        </span>
        {m.goal_split && (
          <>
            <GoalPart
              label="Main job"
              cents={m.main_job_gross_cents}
              goalCents={m.goal_split.main_job_cents}
            />
            <GoalPart
              label="Side income"
              cents={m.side_gross_cents}
              goalCents={m.goal_split.side_income_cents}
            />
          </>
        )}
      </div>
      <div className="sw-tile">
        <span className="sw-tile__label">Net this month (after the tax set-aside)</span>
        <strong>{formatCad(m.net_cents)}</strong>
        {m.employer_match_cents > 0 && (
          <span className="sw-tile__label">
            + {formatCad(m.employer_match_cents)} employer contributions (not in the goal)
          </span>
        )}
      </div>
      <div className="sw-tile">
        <span className="sw-tile__label">{v.year.year} so far, gross</span>
        <strong>{formatCad(v.year.gross_cents)}</strong>
        <span className="sw-tile__label">net {formatCad(v.year.net_cents)}</span>
        <span className="sw-tile__label">
          Main job {formatCad(v.year.main_job_gross_cents)} · Side income{" "}
          {formatCad(v.year.side_gross_cents)}
        </span>
      </div>
      <div className="sw-tile">
        <span className="sw-tile__label">
          Tax set-aside ({v.set_aside.percent}% of this year's side income)
          {v.set_aside.is_placeholder && <span className="sw-chip">placeholder</span>}
        </span>
        <strong>{formatCad(v.set_aside.cents)}</strong>
      </div>
    </section>
  );
}

/** One part of the split goal: a small bar toward that part's goal, "$X / $Y". */
function GoalPart({
  label,
  cents,
  goalCents,
}: {
  label: string;
  cents: number;
  goalCents: number;
}) {
  const p = goalProgress(cents, goalCents);
  return (
    <div className="in-part">
      <span className="sw-tile__label">{label}</span>
      <div
        className="in-bar in-bar--small"
        role="meter"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.min(100, p.percent)}
        aria-label={`${label}: ${p.label}`}
      >
        <span style={{ width: `${p.fill * 100}%` }} />
      </div>
      <span className="sw-tile__label">
        {formatCad(cents)} / {formatCad(goalCents)}
      </span>
    </div>
  );
}

function Platforms({ v }: { v: IncomeView }) {
  if (v.platforms.length === 0) return null;
  return (
    <section aria-labelledby="in-platforms">
      <h3 id="in-platforms" className="sw-h">
        Side work, last 3 months
      </h3>
      <ul className="sw-entries">
        {v.platforms.map((p) => (
          <li key={p.id}>
            <strong>{p.name}</strong>
            <span>{p.hours} h</span>
            <span>{formatCad(p.received_cad_cents)} received</span>
            <span className="sw-amount">
              {p.rate_cad_cents !== null ? `${formatCad(p.rate_cad_cents)} / h` : "—"}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function MainJobPays({ v }: { v: IncomeView }) {
  const [adding, setAdding] = useState(false);
  return (
    <section aria-labelledby="in-pay">
      <h3 id="in-pay" className="sw-h">
        Main-job pay
      </h3>
      {adding ? (
        <AddPay onDone={() => setAdding(false)} />
      ) : (
        <button type="button" onClick={() => setAdding(true)}>
          Add pay
        </button>
      )}
      {v.main_job_pay.length === 0 ? (
        <p className="sw-note">
          No main-job pay yet. Add it on payday, or import a statement from the Statements app.
        </p>
      ) : (
        <ul className="sw-entries sw-entries--stacked">
          {v.main_job_pay.map((row) => (
            <PayRow key={row.id} row={row} />
          ))}
        </ul>
      )}
    </section>
  );
}

const dollars = (cents: number | null) => (cents === null ? "" : (cents / 100).toFixed(2));
const blankIsNull = (text: string) => text.trim() || null;

type PayValues = {
  day: string;
  net: string;
  gross: string;
  rrsp: string;
  match: string;
  notes: string;
};

function valuesOf(row: MainJobPay | null): PayValues {
  return {
    day: row ? row.day : todayIso(),
    net: row ? dollars(row.net_cents) : "",
    gross: dollars(row?.gross_cents ?? null),
    rrsp: dollars(row?.rrsp_cents ?? null),
    match: dollars(row?.match_cents ?? null),
    notes: row?.notes ?? "",
  };
}

/** The pay form: payday and net (when they can still change), then the stub details. */
function PayForm({
  initial,
  dayAndNet,
  submitLabel,
  pending,
  error,
  onSubmit,
  onCancel,
}: {
  initial: PayValues;
  dayAndNet: boolean;
  submitLabel: string;
  pending: boolean;
  error: unknown;
  onSubmit: (v: PayValues) => void;
  onCancel: () => void;
}) {
  const [v, setV] = useState(initial);
  const field = (key: keyof PayValues) => ({
    value: v[key],
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setV({ ...v, [key]: e.target.value }),
  });
  return (
    <form
      className="sw-pay"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(v);
      }}
    >
      {dayAndNet && (
        <>
          <label>
            Payday
            <input type="date" required {...field("day")} />
          </label>
          <label>
            Net (deposit)
            <input inputMode="decimal" required {...field("net")} />
          </label>
        </>
      )}
      <label>
        Gross
        <input inputMode="decimal" {...field("gross")} />
      </label>
      <label>
        Your RRSP
        <input inputMode="decimal" {...field("rrsp")} />
      </label>
      <label>
        Employer contributions (match + flex)
        <input inputMode="decimal" {...field("match")} />
      </label>
      <label className="sw-notes">
        Notes (optional)
        <input maxLength={500} placeholder="Never day-job details" {...field("notes")} />
      </label>
      <button type="submit" disabled={pending}>
        {submitLabel}
      </button>
      <button type="button" className="sw-link" onClick={onCancel}>
        Cancel
      </button>
      {error ? <span className="sw-error">{errorText(error)}</span> : null}
    </form>
  );
}

function AddPay({ onDone }: { onDone: () => void }) {
  const client = useQueryClient();
  const add = useMutation({
    mutationFn: (v: PayValues) =>
      addMainJob({
        paid_on: v.day,
        net: v.net.trim(),
        gross: blankIsNull(v.gross),
        rrsp: blankIsNull(v.rrsp),
        match: blankIsNull(v.match),
        notes: blankIsNull(v.notes),
      }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: KEY });
      onDone();
    },
  });
  return (
    <PayForm
      initial={valuesOf(null)}
      dayAndNet
      submitLabel="Add pay"
      pending={add.isPending}
      error={add.error}
      onSubmit={(v) => add.mutate(v)}
      onCancel={onDone}
    />
  );
}

function PayRow({ row }: { row: MainJobPay }) {
  const client = useQueryClient();
  const [editing, setEditing] = useState(false);
  const save = useMutation({
    mutationFn: (v: PayValues) =>
      editMainJob(row.id, {
        ...(row.confirmed ? {} : { paid_on: v.day, net: v.net.trim() }),
        gross: blankIsNull(v.gross),
        rrsp: blankIsNull(v.rrsp),
        match: blankIsNull(v.match),
        notes: blankIsNull(v.notes),
      }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: KEY });
      setEditing(false);
    },
  });
  const remove = useMutation({
    mutationFn: () => archiveMainJob(row.id),
    onSuccess: () => client.invalidateQueries({ queryKey: KEY }),
  });
  return (
    <li>
      <span>{formatDay(row.day)}</span>
      <span>
        Net {formatCad(row.net_cents)}
        {row.gross_cents !== null
          ? ` · gross ${formatCad(row.gross_cents)}`
          : " · gross not entered"}
      </span>
      <span className={row.confirmed ? "sw-dim" : "sw-dim in-unconfirmed"}>
        {payStatus(row.confirmed, row.checked_by_hand)}
      </span>
      {row.rrsp_cents ? <span className="sw-dim">RRSP {formatCad(row.rrsp_cents)}</span> : null}
      {row.match_cents ? (
        <span className="sw-dim">+ employer {formatCad(row.match_cents)}</span>
      ) : null}
      {row.deductions_cents !== null && (
        <span className="sw-dim">tax and deductions {formatCad(row.deductions_cents)}</span>
      )}
      {row.notes && !editing && <span className="sw-dim">“{row.notes}”</span>}
      {editing ? (
        <PayForm
          initial={valuesOf(row)}
          dayAndNet={!row.confirmed}
          submitLabel="Save"
          pending={save.isPending}
          error={save.error}
          onSubmit={(v) => save.mutate(v)}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <>
          <button type="button" className="sw-link" onClick={() => setEditing(true)}>
            {row.gross_cents === null ? "Add stub details" : "Edit"}
          </button>
          {!row.confirmed && (
            <button
              type="button"
              className="sw-link"
              disabled={remove.isPending}
              onClick={() => {
                if (window.confirm(`Remove the pay typed in for ${formatDay(row.day)}?`)) {
                  remove.mutate();
                }
              }}
              aria-label={`Remove the pay typed in for ${formatDay(row.day)}`}
            >
              Remove
            </button>
          )}
          {remove.error ? <span className="sw-error">{errorText(remove.error)}</span> : null}
        </>
      )}
    </li>
  );
}
