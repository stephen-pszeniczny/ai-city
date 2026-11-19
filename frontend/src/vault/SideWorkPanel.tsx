// The Vault's Side work app: log work, see when pay should land, record what
// arrived, and keep an eye on the tax set-aside.
//
// In Personal mode it starts locked: Touch ID once per app session (the key
// lives in memory only, see api.ts). Any "locked" answer brings the lock back.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type FormEvent } from "react";

import {
  addEntry,
  editPayment,
  archiveEntry,
  getSideWork,
  recordPayment,
  refreshRates,
  setManualRate,
  type Currency,
  type SideWorkGroup,
  type SideWorkPayment,
  type SideWorkView,
} from "../api";
import {
  formatCad,
  formatDay,
  formatDifference,
  formatMoney,
  formatWindow,
  hoursProblem,
  statusLabel,
} from "./sideWork";
import { EMPTY_BONUS_NOTES, IncomeFields, bonusNotesBody, type BonusNotes } from "./IncomeFields";
import { errorText, todayIso, VaultGate } from "./VaultGate";
import "./vault.css";

const KEY = ["sidework"];

export function SideWorkPanel() {
  return (
    <VaultGate>
      <SideWork />
    </VaultGate>
  );
}

function SideWork() {
  const client = useQueryClient();
  const [ratesOk, setRatesOk] = useState(true);

  // Fetch any missing exchange rates first, then show the screen.
  useEffect(() => {
    refreshRates()
      .then((r) => setRatesOk(r.ok))
      .catch(() => setRatesOk(false))
      .finally(() => client.invalidateQueries({ queryKey: KEY }));
  }, [client]);

  const view = useQuery({ queryKey: KEY, queryFn: getSideWork, retry: false });

  if (view.status === "pending") return <p className="sw-note">Counting…</p>;
  if (view.status === "error") return <p className="sw-note">{errorText(view.error)}</p>;
  const v = view.data;

  return (
    <div className="sw">
      <Summary v={v} ratesOk={ratesOk} />
      <LogForm v={v} />
      <section aria-labelledby="sw-pay-title">
        <h3 id="sw-pay-title" className="sw-h">
          Pay
        </h3>
        {v.groups.length === 0 ? (
          <p className="sw-note">Nothing logged yet.</p>
        ) : (
          <ul className="sw-groups">
            {v.groups.map((g) => (
              <Group key={groupKey(g)} g={g} />
            ))}
          </ul>
        )}
      </section>
      <Bonuses v={v} />
    </div>
  );
}

function groupKey(g: SideWorkGroup): string {
  return `${g.company ?? "-"}|${g.period?.[0] ?? g.entries[0]?.id}|${g.payment?.id ?? "unpaid"}`;
}

// --- Summary ------------------------------------------------------------------------------

function Summary({ v, ratesOk }: { v: SideWorkView; ratesOk: boolean }) {
  const s = v.summary;
  return (
    <section className="sw-summary" aria-label="Side work summary">
      <div className="sw-tile">
        <span className="sw-tile__label">Received this month</span>
        <strong>{formatCad(s.month_received_cad_cents)}</strong>
      </div>
      <div className="sw-tile">
        <span className="sw-tile__label">Still expected</span>
        <strong>{formatCad(s.still_expected_cad_cents)}</strong>
      </div>
      <div className="sw-tile">
        <span className="sw-tile__label">
          Tax set-aside ({s.set_aside_percent}% of this year)
          {s.set_aside_is_placeholder && <span className="sw-chip">placeholder</span>}
        </span>
        <strong>{formatCad(s.set_aside_cad_cents)}</strong>
      </div>
      {(s.rates_pending || !ratesOk) && <ManualRate />}
    </section>
  );
}

function ManualRate() {
  const client = useQueryClient();
  const [day, setDay] = useState(todayIso());
  const [rate, setRate] = useState("");
  const save = useMutation({
    mutationFn: () => setManualRate(day, rate.trim()),
    onSuccess: () => {
      setRate("");
      return client.invalidateQueries({ queryKey: KEY });
    },
  });
  return (
    <form
      className="sw-rate"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <p>
        Some exchange rates are pending (the Bank of Canada couldn't be reached, or today's rate
        isn't out yet). They fill in on their own next time, or type one:
      </p>
      <label>
        Day <input type="date" value={day} onChange={(e) => setDay(e.target.value)} required />
      </label>
      <label>
        USD→CAD{" "}
        <input
          inputMode="decimal"
          value={rate}
          onChange={(e) => setRate(e.target.value)}
          placeholder="1.37"
          required
        />
      </label>
      <button type="submit" disabled={save.isPending}>
        Save rate
      </button>
      {save.error && <span className="sw-error">{errorText(save.error)}</span>}
    </form>
  );
}

// --- Logging work ---------------------------------------------------------------------------

const OTHER = "__other__";

function LogForm({ v }: { v: SideWorkView }) {
  const client = useQueryClient();
  const [day, setDay] = useState(todayIso());
  const [company, setCompany] = useState(v.schedules[0]?.id ?? OTHER);
  const [otherName, setOtherName] = useState("");
  const [hours, setHours] = useState("");
  const [rate, setRate] = useState("");
  const [currency, setCurrency] = useState<Currency>("USD");
  const [role, setRole] = useState("");
  const hoursError = hoursProblem(hours);

  const add = useMutation({
    mutationFn: () =>
      addEntry({
        worked_on: day,
        company: company === OTHER ? otherName.trim() || null : company,
        role: role.trim() || null,
        hours: hours.trim() || null,
        rate: rate.trim() || null,
        currency,
      }),
    onSuccess: () => {
      setHours("");
      return client.invalidateQueries({ queryKey: KEY });
    },
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!hoursError) add.mutate();
  }

  return (
    <form className="sw-log" onSubmit={submit} aria-labelledby="sw-log-title">
      <h3 id="sw-log-title" className="sw-h">
        Log work
      </h3>
      <p className="sw-hint">Only the date is needed. Never add project or task details.</p>
      <div className="sw-fields">
        <label>
          Date
          <input type="date" value={day} onChange={(e) => setDay(e.target.value)} required />
        </label>
        <label>
          Company
          <select value={company} onChange={(e) => setCompany(e.target.value)}>
            {v.schedules.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
            <option value={OTHER}>Other or blank</option>
          </select>
        </label>
        {company === OTHER && (
          <label>
            Name (optional)
            <input
              value={otherName}
              maxLength={80}
              onChange={(e) => setOtherName(e.target.value)}
            />
          </label>
        )}
        <label>
          Hours
          <input
            inputMode="decimal"
            value={hours}
            onChange={(e) => setHours(e.target.value)}
            placeholder="1.5"
            aria-invalid={hoursError !== null}
          />
        </label>
        <label>
          Rate / hour
          <input
            inputMode="decimal"
            value={rate}
            onChange={(e) => setRate(e.target.value)}
            placeholder="40"
          />
        </label>
        <label>
          Currency
          <select value={currency} onChange={(e) => setCurrency(e.target.value as Currency)}>
            <option value="USD">USD</option>
            <option value="CAD">CAD</option>
          </select>
        </label>
        <label>
          Role (optional)
          <input value={role} maxLength={80} onChange={(e) => setRole(e.target.value)} />
        </label>
      </div>
      <button type="submit" disabled={add.isPending || hoursError !== null}>
        Add
      </button>
      {hoursError && <span className="sw-error">{hoursError}</span>}
      {add.error && <span className="sw-error">{errorText(add.error)}</span>}
    </form>
  );
}

// --- Pay groups ------------------------------------------------------------------------------

function Group({ g }: { g: SideWorkGroup }) {
  const client = useQueryClient();
  const [paying, setPaying] = useState(false);
  const archive = useMutation({
    mutationFn: archiveEntry,
    onSuccess: () => client.invalidateQueries({ queryKey: KEY }),
  });
  const title = g.company_name ?? "No company";
  const when = g.period ? `${formatDay(g.period[0])} – ${formatDay(g.period[1])}` : null;

  return (
    <li className={`sw-group sw-group--${g.status}`}>
      <header className="sw-group__head">
        <strong>{title}</strong>
        {when && <span>{when}</span>}
        <span className={`sw-pill sw-pill--${g.status}`}>{statusLabel(g.status)}</span>
        {g.window && g.status !== "paid" && (
          <span className="sw-dim">{formatWindow(g.window)}</span>
        )}
      </header>
      <ul className="sw-entries">
        {g.entries.map((e) => (
          <li key={e.id}>
            <span>{formatDay(e.worked_on)}</span>
            <span>
              {e.hours ? `${e.hours} h` : "hours ?"}
              {e.rate_cents !== null && ` × ${formatMoney(e.rate_cents, e.currency)}`}
            </span>
            {e.role && <span className="sw-dim">{e.role}</span>}
            <span className="sw-amount">
              {e.expected_cents !== null ? formatMoney(e.expected_cents, e.currency) : "—"}
            </span>
            {g.status !== "paid" && (
              <button
                type="button"
                className="sw-link"
                onClick={() => archive.mutate(e.id)}
                aria-label={`Archive the entry from ${formatDay(e.worked_on)}`}
              >
                Archive
              </button>
            )}
          </li>
        ))}
      </ul>
      <footer className="sw-group__foot">
        <span>
          Expected {formatCad(g.expected_cad_cents)}
          {g.expected_is_estimate && " (estimate)"}
          {g.expected_is_partial && " (some hours or rates missing)"}
        </span>
        {g.payment ? (
          <span>
            Received {formatMoney(g.payment.amount_cents, g.payment.currency)} on{" "}
            {formatDay(g.payment.received_on)} = {formatCad(g.payment.received_cad_cents)}
            {g.bonus_cad_cents ? ` · bonus ${formatCad(g.bonus_cad_cents)}` : ""}
            {g.difference_cad_cents !== null && (
              <strong className={g.difference_cad_cents < 0 ? "sw-short" : "sw-ok"}>
                {" "}
                · {formatDifference(g.difference_cad_cents)}
              </strong>
            )}
          </span>
        ) : (
          !paying && (
            <button type="button" onClick={() => setPaying(true)}>
              Record payment
            </button>
          )
        )}
      </footer>
      {g.payment && <PaymentNote payment={g.payment} />}
      {paying && !g.payment && (
        <PaymentForm
          kind="pay"
          company={g.company}
          entryIds={g.entries.map((e) => e.id)}
          currency={g.entries[0]?.currency ?? "USD"}
          onDone={() => setPaying(false)}
        />
      )}
    </li>
  );
}

function PaymentForm(props: {
  kind: "pay" | "bonus" | "extra";
  company: string | null;
  entryIds: number[];
  currency: Currency;
  onDone: () => void;
}) {
  const client = useQueryClient();
  const [day, setDay] = useState(todayIso());
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState<Currency>(props.currency);
  const [extra, setExtra] = useState<BonusNotes>(EMPTY_BONUS_NOTES);
  const save = useMutation({
    mutationFn: () =>
      recordPayment({
        kind: props.kind,
        company: props.company,
        received_on: day,
        amount: amount.trim(),
        currency,
        entry_ids: props.entryIds,
        ...bonusNotesBody(extra),
      }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: KEY });
      props.onDone();
    },
  });
  return (
    <form
      className="sw-pay"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <label>
        Arrived on
        <input type="date" value={day} onChange={(e) => setDay(e.target.value)} required />
      </label>
      <label>
        Amount
        <input
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="0.00"
          required
        />
      </label>
      <label>
        Currency
        <select value={currency} onChange={(e) => setCurrency(e.target.value as Currency)}>
          <option value="USD">USD</option>
          <option value="CAD">CAD</option>
        </select>
      </label>
      <IncomeFields value={extra} onChange={setExtra} bonus={props.kind === "pay"} />
      <button type="submit" disabled={save.isPending}>
        Save
      </button>
      <button type="button" className="sw-link" onClick={props.onDone}>
        Cancel
      </button>
      {save.error && <span className="sw-error">{errorText(save.error)}</span>}
    </form>
  );
}

/** Change a recorded payment's bonus box and notes (never its amount). */
function EditPaymentForm({ payment, onDone }: { payment: SideWorkPayment; onDone: () => void }) {
  const client = useQueryClient();
  const [value, setValue] = useState<BonusNotes>({
    includesBonus: payment.includes_bonus,
    bonus: payment.bonus_cents !== null ? (payment.bonus_cents / 100).toFixed(2) : "",
    notes: payment.notes ?? "",
  });
  const save = useMutation({
    mutationFn: () => editPayment(payment.id, bonusNotesBody(value)),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: KEY });
      onDone();
    },
  });
  return (
    <form
      className="sw-pay"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <IncomeFields value={value} onChange={setValue} bonus={payment.kind === "pay"} />
      <button type="submit" disabled={save.isPending}>
        Save
      </button>
      <button type="button" className="sw-link" onClick={onDone}>
        Cancel
      </button>
      {save.error && <span className="sw-error">{errorText(save.error)}</span>}
    </form>
  );
}

function PaymentNote({ payment }: { payment: SideWorkPayment }) {
  const [editing, setEditing] = useState(false);
  if (editing) return <EditPaymentForm payment={payment} onDone={() => setEditing(false)} />;
  return (
    <p className="sw-note-line">
      {payment.notes && <span className="sw-dim">“{payment.notes}” </span>}
      <button type="button" className="sw-link" onClick={() => setEditing(true)}>
        {payment.notes || payment.includes_bonus ? "Edit bonus or notes" : "Add bonus or notes"}
      </button>
    </p>
  );
}

// --- Bonuses -----------------------------------------------------------------------------

function Bonuses({ v }: { v: SideWorkView }) {
  const [adding, setAdding] = useState(false);
  const [company, setCompany] = useState(v.schedules[0]?.id ?? "");
  return (
    <section aria-labelledby="sw-bonus-title">
      <h3 id="sw-bonus-title" className="sw-h">
        Bonuses and other income
      </h3>
      {v.bonuses.length + v.extras.length > 0 && (
        <ul className="sw-entries sw-entries--stacked">
          {[...v.bonuses, ...v.extras].map((b) => (
            <li key={b.id}>
              <span>{formatDay(b.received_on)}</span>
              <span>
                {v.schedules.find((s) => s.id === b.company)?.name ?? b.company ?? ""}
                {b.kind === "extra" && <span className="sw-dim"> · other income</span>}
              </span>
              <span className="sw-amount">
                {formatMoney(b.amount_cents, b.currency)} = {formatCad(b.received_cad_cents)}
              </span>
              <PaymentNote payment={b} />
            </li>
          ))}
        </ul>
      )}
      {adding ? (
        <>
          {v.schedules.length > 0 && (
            <label className="sw-inline">
              From
              <select value={company} onChange={(e) => setCompany(e.target.value)}>
                {v.schedules.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <PaymentForm
            kind="bonus"
            company={company || null}
            entryIds={[]}
            currency="USD"
            onDone={() => setAdding(false)}
          />
        </>
      ) : (
        <button type="button" onClick={() => setAdding(true)}>
          Record bonus
        </button>
      )}
    </section>
  );
}
