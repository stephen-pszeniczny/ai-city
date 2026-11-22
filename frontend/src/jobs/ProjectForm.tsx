// Log a project found on a platform: the platform, a generic title written by the
// owner (never copied from the platform), hourly pay with its currency, hours a week.
// Used by the Log app and by the check round's "Found something".
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";

import { addProject, type PlatformCard, type ProjectView } from "../api";

export function ProjectForm({
  platforms,
  platformId,
  onSaved,
  onCancel,
}: {
  platforms: PlatformCard[];
  platformId?: string;
  onSaved: (project: ProjectView) => void;
  onCancel: () => void;
}) {
  const client = useQueryClient();
  const [platform, setPlatform] = useState(platformId ?? platforms[0]?.id ?? "");
  const [title, setTitle] = useState("");
  const [pay, setPay] = useState("");
  const [currency, setCurrency] = useState<"USD" | "CAD">("USD");
  const [hours, setHours] = useState("");
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: addProject,
    onSuccess: (project) => {
      void client.invalidateQueries({ queryKey: ["jobs-projects"] });
      onSaved(project);
    },
    onError: (err: Error) => setError(err.message),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    const payCents = pay.trim() ? Math.round(Number(pay) * 100) : null;
    const hoursNumber = hours.trim() ? Number(hours) : null;
    if (payCents !== null && (!Number.isFinite(payCents) || payCents < 0)) {
      setError("Pay must be a number, like 45 or 45.50.");
      return;
    }
    if (hoursNumber !== null && !Number.isInteger(hoursNumber)) {
      setError("Hours a week must be a whole number.");
      return;
    }
    save.mutate({
      platform_id: platform,
      title: title.trim(),
      pay_cents: payCents,
      currency: payCents === null ? null : currency,
      hours_per_week: hoursNumber,
    });
  }

  return (
    <form className="jobs-form" onSubmit={submit} aria-label="Log a project">
      <select
        className="field"
        aria-label="Platform"
        value={platform}
        onChange={(e) => setPlatform(e.target.value)}
        disabled={platformId !== undefined}
      >
        {platforms.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      <input
        className="field jobs-form__title"
        aria-label="Title (your own words)"
        placeholder="Title (your own words)"
        maxLength={80}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        autoFocus
      />
      <input
        className="field jobs-form__num"
        aria-label="Pay per hour"
        placeholder="$/hr"
        inputMode="decimal"
        value={pay}
        onChange={(e) => setPay(e.target.value)}
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
        className="field jobs-form__num"
        aria-label="Hours a week"
        placeholder="hrs/wk"
        inputMode="numeric"
        value={hours}
        onChange={(e) => setHours(e.target.value)}
      />
      <button type="submit" className="btn" disabled={save.isPending || !title.trim()}>
        Save
      </button>
      <button type="button" className="btn btn--quiet" onClick={onCancel}>
        Cancel
      </button>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
