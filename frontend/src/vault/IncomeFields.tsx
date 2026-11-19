// The "includes a bonus" box (with an optional amount) and a notes field, used
// wherever side-work income is entered or reviewed.

export type BonusNotes = { includesBonus: boolean; bonus: string; notes: string };

export const EMPTY_BONUS_NOTES: BonusNotes = { includesBonus: false, bonus: "", notes: "" };

/** What to send: the bonus amount only when the box is ticked; blank means none. */
export function bonusNotesBody(v: BonusNotes) {
  return {
    includes_bonus: v.includesBonus,
    bonus: v.includesBonus && v.bonus.trim() ? v.bonus.trim() : null,
    notes: v.notes.trim() || null,
  };
}

export function IncomeFields({
  value,
  onChange,
  bonus = true,
}: {
  value: BonusNotes;
  onChange: (v: BonusNotes) => void;
  /** Offer the bonus box (pay only; a bonus or other income has none). */
  bonus?: boolean;
}) {
  return (
    <>
      {bonus && (
        <label className="sw-check">
          <input
            type="checkbox"
            checked={value.includesBonus}
            onChange={(e) => onChange({ ...value, includesBonus: e.target.checked })}
          />
          Includes a bonus
        </label>
      )}
      {bonus && value.includesBonus && (
        <label>
          Bonus amount (optional)
          <input
            inputMode="decimal"
            value={value.bonus}
            onChange={(e) => onChange({ ...value, bonus: e.target.value })}
            placeholder="blank = everything above expected"
          />
        </label>
      )}
      <label className="sw-notes">
        Notes (optional)
        <input
          value={value.notes}
          maxLength={500}
          onChange={(e) => onChange({ ...value, notes: e.target.value })}
          placeholder="Never project, client or day-job details"
        />
      </label>
    </>
  );
}
