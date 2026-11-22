// Opportunity Office's log: projects found on platforms, open ones first, each with
// its pay (and the other currency), hours a week and one tap to move it on.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import {
  getPlatforms,
  getProjects,
  setProjectStatus,
  type ProjectStatus,
  type ProjectView,
} from "../api";
import { nextProjectStatuses, payText } from "./jobs";
import { JobsGate } from "./JobsGate";
import { PROJECT_STATUS } from "./labels";
import { ProjectForm } from "./ProjectForm";

export function LogPanel() {
  return (
    <JobsGate>
      <Log />
    </JobsGate>
  );
}

function Log() {
  const [adding, setAdding] = useState(false);
  const projects = useQuery({ queryKey: ["jobs-projects"], queryFn: getProjects });
  const platforms = useQuery({ queryKey: ["jobs-platforms"], queryFn: getPlatforms });
  if (projects.isPending || platforms.isPending) return <p className="sw-note">Loading…</p>;
  if (projects.isError || platforms.isError)
    return (
      <p className="form-error" role="alert">
        {(projects.error ?? platforms.error)?.message}
      </p>
    );
  const open = projects.data.projects.filter((p) => !["rejected", "ended"].includes(p.status));
  const finished = projects.data.projects.filter((p) => ["rejected", "ended"].includes(p.status));

  return (
    <div className="jobs">
      <div className="jobs__summary">
        <span className="jobs__chip">{open.length} open</span>
        <span className="jobs__chip">
          {open.filter((p) => p.status === "active").length} active
        </span>
        <span className="jobs__chip">Floor ${projects.data.floor_usd} USD/hr</span>
        <span className="jobs__spacer" />
        {!adding && (
          <button type="button" className="btn" onClick={() => setAdding(true)}>
            + Log a project
          </button>
        )}
      </div>
      {adding && (
        <ProjectForm
          platforms={platforms.data.platforms}
          onSaved={() => setAdding(false)}
          onCancel={() => setAdding(false)}
        />
      )}
      <ProjectList label="Open" projects={open} />
      {finished.length > 0 && <ProjectList label="Finished" projects={finished} />}
      {projects.data.projects.length === 0 && !adding && (
        <p className="sw-note">Nothing logged yet.</p>
      )}
    </div>
  );
}

function ProjectList({ label, projects }: { label: string; projects: ProjectView[] }) {
  if (projects.length === 0) return null;
  return (
    <section aria-label={label}>
      <h3 className="jobs__h">{label}</h3>
      <ul className="jobs__cards">
        {projects.map((p) => (
          <ProjectRow key={p.id} project={p} />
        ))}
      </ul>
    </section>
  );
}

function ProjectRow({ project }: { project: ProjectView }) {
  const client = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const move = useMutation({
    mutationFn: (status: ProjectStatus) => setProjectStatus(project.id, status),
    onSuccess: () => {
      setError(null);
      void client.invalidateQueries({ queryKey: ["jobs-projects"] });
      void client.invalidateQueries({ queryKey: ["sidework"] });
    },
    onError: (err: Error) => setError(err.message),
  });
  return (
    <li className={`jobs-card jobs-card--${project.status}`}>
      <div className="jobs-card__head">
        <strong className="jobs-card__name">{project.title}</strong>
        <span className="jobs__chip">{PROJECT_STATUS[project.status]}</span>
      </div>
      <div className="jobs-card__chips">
        <span className="jobs__chip">{project.platform_name}</span>
        <span className="jobs__chip">{payText(project)}</span>
        {project.hours_per_week !== null && (
          <span className="jobs__chip">{project.hours_per_week} hrs/wk</span>
        )}
        {project.flags.includes("below_floor") && (
          <span className="jobs__chip jobs__chip--warn">Below floor</span>
        )}
      </div>
      {nextProjectStatuses(project.status).length > 0 && (
        <div className="jobs-card__actions">
          {nextProjectStatuses(project.status).map((s) => (
            <button
              key={s}
              type="button"
              className={`jobs-move${s === "rejected" ? " jobs-move--quiet" : ""}`}
              onClick={() => move.mutate(s as ProjectStatus)}
              disabled={move.isPending}
            >
              {PROJECT_STATUS[s as ProjectStatus]}
            </button>
          ))}
        </div>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </li>
  );
}
