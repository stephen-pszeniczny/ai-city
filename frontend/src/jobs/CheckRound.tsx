// The Opportunity Office check round, inside the Sunday check-in: only the platforms
// due for a check, each with Open (its login page), Nothing new (stamps the date) and
// Found something (log the project; saving it also counts as the check). Hidden when
// Opportunity Office isn't set up.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { ApiError, checkPlatform, getPlatforms, type PlatformCard } from "../api";
import { JobsGate } from "./JobsGate";
import { PLATFORM_STATUS } from "./labels";
import { ProjectForm } from "./ProjectForm";

export function CheckRound() {
  return (
    <section aria-labelledby="ci-jobs">
      <h3 id="ci-jobs" className="checkin__h">
        Platforms to check
      </h3>
      <JobsGate>
        <Round />
      </JobsGate>
    </section>
  );
}

function Round() {
  const client = useQueryClient();
  const [finding, setFinding] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const list = useQuery({ queryKey: ["jobs-platforms"], queryFn: getPlatforms, retry: false });
  const check = useMutation({
    mutationFn: ({ id, outcome }: { id: string; outcome: "nothing" | "found" }) =>
      checkPlatform(id, outcome),
    onSuccess: () => {
      setError(null);
      setFinding(null);
      void client.invalidateQueries({ queryKey: ["jobs-platforms"] });
      void client.invalidateQueries({ queryKey: ["jobs-badge"] });
    },
    onError: (err: Error) => setError(err.message),
  });

  if (list.isPending) return <p className="plan__note">Loading…</p>;
  if (list.isError) {
    if (list.error instanceof ApiError && list.error.status === 400) {
      return <p className="plan__note">Not set up</p>;
    }
    return (
      <p className="form-error" role="alert">
        {list.error.message}
      </p>
    );
  }
  const due = list.data.due;
  if (due.length === 0) return <p className="plan__note">No platforms due</p>;

  return (
    <ul className="jobs__cards" aria-label="Platforms to check">
      {due.map((card: PlatformCard) => (
        <li key={card.id} className="jobs-card">
          <div className="jobs-card__head">
            <strong className="jobs-card__name">{card.name}</strong>
            <span className="jobs__chip">{PLATFORM_STATUS[card.status]}</span>
          </div>
          {finding === card.id ? (
            <ProjectForm
              platforms={list.data.platforms}
              platformId={card.id}
              onSaved={() => check.mutate({ id: card.id, outcome: "found" })}
              onCancel={() => setFinding(null)}
            />
          ) : (
            <div className="jobs-card__actions">
              <a className="btn" href={card.url} target="_blank" rel="noreferrer">
                Open
              </a>
              <button
                type="button"
                className="btn btn--quiet"
                disabled={check.isPending}
                onClick={() => check.mutate({ id: card.id, outcome: "nothing" })}
              >
                Nothing new
              </button>
              <button type="button" className="btn btn--quiet" onClick={() => setFinding(card.id)}>
                Found something
              </button>
            </div>
          )}
        </li>
      ))}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </ul>
  );
}
