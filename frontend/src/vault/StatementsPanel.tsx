// The Vault's Statements app: upload a chequing statement CSV, review what the
// app proposes, confirm once. Nothing is stored until "Confirm import"; the file
// itself is never kept, and spending rows are only counted.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type ChangeEvent } from "react";

import {
  confirmStatement,
  getMode,
  getSampleStatement,
  listStatements,
  previewStatement,
  type ConfirmBody,
  type StatementPreview,
} from "../api";
import { EMPTY_BONUS_NOTES, IncomeFields, bonusNotesBody, type BonusNotes } from "./IncomeFields";
import { formatCad, formatDay, formatMoney, formatWindow } from "./sideWork";
import { errorText, VaultGate } from "./VaultGate";

export function StatementsPanel() {
  return (
    <VaultGate>
      <Statements />
    </VaultGate>
  );
}

function Statements() {
  const client = useQueryClient();
  const mode = useQuery({ queryKey: ["mode"], queryFn: getMode, retry: false });
  const history = useQuery({ queryKey: ["statements"], queryFn: listStatements, retry: false });
  const [preview, setPreview] = useState<StatementPreview | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const read = useMutation({
    mutationFn: (csv: Blob | string) => previewStatement(csv),
    onSuccess: (p) => {
      setDone(null);
      setPreview(p);
    },
  });

  function pick(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // the same file can be chosen again
    if (file) read.mutate(file);
  }

  async function trySample() {
    read.mutate(await getSampleStatement());
  }

  if (preview) {
    return (
      <Review
        preview={preview}
        onCancel={() => setPreview(null)}
        onDone={async (summary) => {
          setPreview(null);
          setDone(summary);
          await client.invalidateQueries();
        }}
      />
    );
  }

  return (
    <div className="sw">
      <section aria-labelledby="st-upload">
        <h3 id="st-upload" className="sw-h">
          Import a statement
        </h3>
        <p className="sw-hint">
          Download your chequing statement as CSV, then choose it here. Only income from your main
          job and side work is kept; spending is never stored, and the file isn't kept.
        </p>
        <div className="st-actions">
          <label className="st-file">
            Choose statement (CSV)
            <input type="file" accept=".csv,text/csv" onChange={pick} />
          </label>
          {mode.data === "sample" && (
            <button type="button" onClick={trySample} disabled={read.isPending}>
              Try a sample statement
            </button>
          )}
        </div>
        {read.isPending && <p className="sw-note">Reading…</p>}
        {read.error && (
          <p className="sw-error" role="alert">
            {errorText(read.error)}
          </p>
        )}
        {done && (
          <p className="st-done" role="status">
            {done}
          </p>
        )}
      </section>
      <section aria-labelledby="st-history">
        <h3 id="st-history" className="sw-h">
          Past imports
        </h3>
        {history.data && history.data.length > 0 ? (
          <ul className="sw-entries">
            {history.data.map((i) => (
              <li key={i.id}>
                <span>
                  {formatDay(i.first_day)} – {formatDay(i.last_day)}
                </span>
                <span>{i.kept} kept</span>
                <span className="sw-dim">
                  {i.duplicates} already imported · {i.skipped} skipped · {i.spending} spending
                  ignored
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="sw-note">No statements imported yet.</p>
        )}
      </section>
    </div>
  );
}

// --- Review --------------------------------------------------------------------------------

type PlatformChoice = { action: string; extra: BonusNotes }; // action: week:<start> | bonus | link | skip
type MainChoice = { gross: string; rrsp: string; match: string; notes: string };
type OtherChoice = { add: boolean; company: string; notes: string };

function Review({
  preview,
  onCancel,
  onDone,
}: {
  preview: StatementPreview;
  onCancel: () => void;
  onDone: (summary: string) => void;
}) {
  const [platform, setPlatform] = useState<Record<string, PlatformChoice>>(() =>
    Object.fromEntries(
      preview.platform.map((r) => {
        const p = r.proposal;
        const action =
          p.kind === "week"
            ? `week:${p.week_start}`
            : p.kind === "link"
              ? `link:${p.payment_id}`
              : p.kind === "unmatched"
                ? "skip"
                : p.kind;
        return [r.ref, { action, extra: EMPTY_BONUS_NOTES }];
      }),
    ),
  );
  const [main, setMain] = useState<Record<string, MainChoice>>(() =>
    Object.fromEntries(
      preview.main_job.map((r) => [r.ref, { gross: "", rrsp: "", match: "", notes: "" }]),
    ),
  );
  const [other, setOther] = useState<Record<string, OtherChoice>>(() =>
    Object.fromEntries(
      preview.other_income.map((r) => [r.ref, { add: false, company: "", notes: "" }]),
    ),
  );

  const nothingNew =
    preview.main_job.length + preview.platform.length + preview.other_income.length === 0;

  const save = useMutation({
    mutationFn: () => {
      const body: ConfirmBody = {
        token: preview.token,
        main_job: preview.main_job.map((r) => {
          const c = main[r.ref]!;
          return {
            ref: r.ref,
            gross: c.gross.trim() || null,
            rrsp: c.rrsp.trim() || null,
            match: c.match.trim() || null,
            notes: c.notes.trim() || null,
          };
        }),
        platform: preview.platform.map((r) => {
          const c = platform[r.ref]!;
          const [action, value] = c.action.split(":") as [string, string | undefined];
          return {
            ref: r.ref,
            action: action as "week" | "bonus" | "link" | "skip",
            week_start: action === "week" ? (value ?? null) : null,
            payment_id: action === "link" ? Number(value) : null,
            ...(action === "week"
              ? bonusNotesBody(c.extra)
              : { notes: c.extra.notes.trim() || null }),
          };
        }),
        other_income: preview.other_income.map((r) => {
          const c = other[r.ref]!;
          return {
            ref: r.ref,
            action: c.add ? ("add" as const) : ("skip" as const),
            company: c.company.trim() || null,
            notes: c.notes.trim() || null,
          };
        }),
      };
      return confirmStatement(body);
    },
    onSuccess: (r) =>
      onDone(`Imported: ${r.kept} kept, ${r.duplicates} already imported, ${r.skipped} skipped.`),
  });

  return (
    <div className="sw">
      <h3 className="sw-h">
        Review {formatDay(preview.first_day)} – {formatDay(preview.last_day)}
      </h3>
      <p className="sw-hint">
        {preview.already_imported} already imported · {preview.spending} spending rows ignored
        {preview.other_currency > 0 && ` · ${preview.other_currency} non-CAD rows skipped`}
      </p>
      {nothingNew && <p className="sw-note">Everything in this statement was already imported.</p>}

      {preview.main_job.length > 0 && (
        <section aria-labelledby="rv-main">
          <h3 id="rv-main" className="sw-h">
            Main-job pay
          </h3>
          <p className="sw-hint">Gross, RRSP and match are optional; add them now or later.</p>
          <ul className="sw-groups">
            {preview.main_job.map((r) => {
              const c = main[r.ref]!;
              const set = (patch: Partial<MainChoice>) =>
                setMain({ ...main, [r.ref]: { ...c, ...patch } });
              return (
                <li key={r.ref} className="sw-group">
                  <header className="sw-group__head">
                    <strong>{formatDay(r.day)}</strong>
                    <span>Net {formatCad(r.amount_cents)}</span>
                  </header>
                  <div className="sw-pay">
                    <label>
                      Gross
                      <input
                        inputMode="decimal"
                        value={c.gross}
                        onChange={(e) => set({ gross: e.target.value })}
                      />
                    </label>
                    <label>
                      Your RRSP
                      <input
                        inputMode="decimal"
                        value={c.rrsp}
                        onChange={(e) => set({ rrsp: e.target.value })}
                      />
                    </label>
                    <label>
                      Employer contributions (match + flex)
                      <input
                        inputMode="decimal"
                        value={c.match}
                        onChange={(e) => set({ match: e.target.value })}
                      />
                    </label>
                    <label className="sw-notes">
                      Notes (optional)
                      <input
                        value={c.notes}
                        maxLength={500}
                        onChange={(e) => set({ notes: e.target.value })}
                        placeholder="Never day-job details"
                      />
                    </label>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {preview.platform.length > 0 && (
        <section aria-labelledby="rv-side">
          <h3 id="rv-side" className="sw-h">
            Side-work deposits
          </h3>
          <ul className="sw-groups">
            {preview.platform.map((r) => {
              const c = platform[r.ref]!;
              const weeks = preview.weeks.filter((w) => w.schedule_id === r.schedule_id);
              const set = (patch: Partial<PlatformChoice>) =>
                setPlatform({ ...platform, [r.ref]: { ...c, ...patch } });
              return (
                <li key={r.ref} className="sw-group">
                  <header className="sw-group__head">
                    <strong>{formatDay(r.day)}</strong>
                    <span>{formatCad(r.amount_cents)}</span>
                    {r.proposal.kind === "unmatched" && (
                      <span className="sw-pill sw-pill--overdue">No match: choose</span>
                    )}
                    {r.proposal.check_amount && <span className="sw-chip">check the amount</span>}
                  </header>
                  <div className="sw-pay">
                    <label>
                      This is
                      <select value={c.action} onChange={(e) => set({ action: e.target.value })}>
                        {weeks.map((w) => (
                          <option key={w.start} value={`week:${w.start}`}>
                            Pay for the week of {formatDay(w.start)} ({formatWindow(w.window)})
                          </option>
                        ))}
                        <option value="bonus">A bonus</option>
                        {preview.hand_payments
                          .filter((h) => h.schedule_id === r.schedule_id)
                          .map((h) => (
                            <option key={h.id} value={`link:${h.id}`}>
                              The payment I typed in ({formatDay(h.received_on)},{" "}
                              {formatMoney(h.amount_cents, h.currency)})
                            </option>
                          ))}
                        <option value="skip">Skip (don't store)</option>
                      </select>
                    </label>
                    {c.action !== "skip" && (
                      <IncomeFields
                        value={c.extra}
                        onChange={(extra) => set({ extra })}
                        bonus={c.action.startsWith("week:")}
                      />
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {preview.other_income.length > 0 && (
        <section aria-labelledby="rv-other">
          <h3 id="rv-other" className="sw-h">
            Other money in
          </h3>
          <p className="sw-hint">
            Refunds, transfers and the like. Skipped rows are never stored; add one only if it's
            side income.
          </p>
          <ul className="sw-groups">
            {preview.other_income.map((r) => {
              const c = other[r.ref]!;
              const set = (patch: Partial<OtherChoice>) =>
                setOther({ ...other, [r.ref]: { ...c, ...patch } });
              return (
                <li key={r.ref} className="sw-group">
                  <header className="sw-group__head">
                    <strong>{formatDay(r.day)}</strong>
                    <span>{formatCad(r.amount_cents)}</span>
                  </header>
                  <div className="sw-pay">
                    <label className="sw-check">
                      <input
                        type="checkbox"
                        checked={c.add}
                        onChange={(e) => set({ add: e.target.checked })}
                      />
                      Add as side income
                    </label>
                    {c.add && (
                      <>
                        <label>
                          Company
                          <input
                            value={c.company}
                            maxLength={80}
                            onChange={(e) => set({ company: e.target.value })}
                          />
                        </label>
                        <label className="sw-notes">
                          Notes (optional)
                          <input
                            value={c.notes}
                            maxLength={500}
                            onChange={(e) => set({ notes: e.target.value })}
                            placeholder="Never project or client details"
                          />
                        </label>
                      </>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <div className="st-actions">
        {!nothingNew && (
          <button type="button" onClick={() => save.mutate()} disabled={save.isPending}>
            Confirm import
          </button>
        )}
        <button type="button" className="sw-link" onClick={onCancel}>
          {nothingNew ? "Back" : "Cancel"}
        </button>
        {save.error && (
          <span className="sw-error" role="alert">
            {errorText(save.error)}
          </span>
        )}
      </div>
    </div>
  );
}
