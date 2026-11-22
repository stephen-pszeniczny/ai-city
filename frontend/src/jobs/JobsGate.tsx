// Every Opportunity Office screen sits behind this: in Personal mode it shows the
// Touch ID lock until Opportunity Office is unlocked for this app session, and any
// "locked" answer from the engine (a restart, a mode switch) brings the lock back.
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";

import { getMode, hasJobsKey, onJobsLocked, unlockJobs } from "../api";
import { VaultLockScreen } from "../vault/VaultLockScreen";
import "../vault/vault.css";
import "./jobs.css";

export function JobsGate({ children }: { children: ReactNode }) {
  const mode = useQuery({ queryKey: ["mode"], queryFn: getMode, retry: false });
  const [unlocked, setUnlocked] = useState(hasJobsKey());
  useEffect(() => onJobsLocked(() => setUnlocked(false)), []);

  if (mode.status === "pending") return <p className="sw-note">Opening…</p>;
  if (mode.status === "error") {
    return <p className="sw-note">{mode.error instanceof Error ? mode.error.message : "Error."}</p>;
  }
  if (mode.data === "personal" && !unlocked) {
    return (
      <VaultLockScreen
        place="Opportunity Office"
        unlock={unlockJobs}
        onUnlocked={() => setUnlocked(true)}
      />
    );
  }
  return <>{children}</>;
}
