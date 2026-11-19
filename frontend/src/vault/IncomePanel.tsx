// The Vault's Income app: this month against the goal (gross, with net beside
// it), recent months stacked by source, side work by platform, the tax
// set-aside, and main-job pay with its stub details.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { editMainJob, getIncome, type IncomeView } from "../api";
import { StackedMonths } from "./charts";
import { goalProgress } from "./income";
import { formatCad, formatDay } from "./sideWork";
import { errorText, VaultGate } from "./VaultGate";

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
      <MainJobPay v={v} />
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
      </div>
      <div className="sw-tile">
        <span className="sw-tile__label">Net (after the tax set-aside)</span>
        <strong>{formatCad(m.net_cents)}</strong>
        {m.employer_match_cents > 0 && (
          <span className="sw-tile__label">
            + {formatCad(m.employer_match_cents)} employer RRSP (not in the goal)
          </span>
        )}
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

function MainJobPay({ v }: { v: IncomeView }) {
  if (v.main_job_pay.length === 0) {
    return (
      <p className="sw-note">No main-job pay yet. Import a statement from the Statements app.</p>
    );
  }
  return (
    <section aria-labelledby="in-pay">
      <h3 id="in-pay" className="sw-h">
        Main-job pay
      </h3>
      <ul className="sw-entries sw-entries--stacked">
        {v.main_job_pay.map((row) => (
          <PayRow key={row.deposit_id} row={row} />
        ))}
      </ul>
    </section>
  );
}

const dollars = (cents: number | null) => (cents === null ? "" : (cents / 100).toFixed(2));

function PayRow({ row }: { row: IncomeView["main_job_pay"][number] }) {
  const client = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [gross, setGross] = useState(dollars(row.gross_cents));
  const [rrsp, setRrsp] = useState(dollars(row.rrsp_cents));
  const [match, setMatch] = useState(dollars(row.match_cents));
  const [notes, setNotes] = useState(row.notes ?? "");
  const save = useMutation({
    mutationFn: () =>
      editMainJob(row.deposit_id, {
        gross: gross.trim() || null,
        rrsp: rrsp.trim() || null,
        match: match.trim() || null,
        notes: notes.trim() || null,
      }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: KEY });
      setEditing(false);
    },
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
      {row.rrsp_cents ? <span className="sw-dim">RRSP {formatCad(row.rrsp_cents)}</span> : null}
      {row.match_cents ? (
        <span className="sw-dim">+ match {formatCad(row.match_cents)}</span>
      ) : null}
      {row.deductions_cents !== null && (
        <span className="sw-dim">tax and deductions {formatCad(row.deductions_cents)}</span>
      )}
      {row.notes && !editing && <span className="sw-dim">“{row.notes}”</span>}
      {editing ? (
        <form
          className="sw-pay"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <label>
            Gross
            <input inputMode="decimal" value={gross} onChange={(e) => setGross(e.target.value)} />
          </label>
          <label>
            Your RRSP
            <input inputMode="decimal" value={rrsp} onChange={(e) => setRrsp(e.target.value)} />
          </label>
          <label>
            Employer match
            <input inputMode="decimal" value={match} onChange={(e) => setMatch(e.target.value)} />
          </label>
          <label className="sw-notes">
            Notes (optional)
            <input
              value={notes}
              maxLength={500}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Never day-job details"
            />
          </label>
          <button type="submit" disabled={save.isPending}>
            Save
          </button>
          <button type="button" className="sw-link" onClick={() => setEditing(false)}>
            Cancel
          </button>
          {save.error && <span className="sw-error">{errorText(save.error)}</span>}
        </form>
      ) : (
        <button type="button" className="sw-link" onClick={() => setEditing(true)}>
          {row.gross_cents === null ? "Add stub details" : "Edit"}
        </button>
      )}
    </li>
  );
}
