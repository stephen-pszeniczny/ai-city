// Every Vault app sits behind this: in Personal mode it shows the Touch ID lock
// until the Vault is unlocked for this app session, and any "locked" answer
// from the engine (a restart, a mode switch) brings the lock back.
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";

import { getMode, hasVaultKey, onVaultLocked } from "../api";
import { VaultLockScreen } from "./VaultLockScreen";
import "./vault.css";

export function VaultGate({ children }: { children: ReactNode }) {
  const mode = useQuery({ queryKey: ["mode"], queryFn: getMode, retry: false });
  const [unlocked, setUnlocked] = useState(hasVaultKey());
  useEffect(() => onVaultLocked(() => setUnlocked(false)), []);

  if (mode.status === "pending") return <p className="sw-note">Opening the Vault…</p>;
  if (mode.status === "error") {
    return <p className="sw-note">{mode.error instanceof Error ? mode.error.message : "Error."}</p>;
  }
  if (mode.data === "personal" && !unlocked) {
    return <VaultLockScreen onUnlocked={() => setUnlocked(true)} />;
  }
  return <>{children}</>;
}

/** A readable message from anything thrown. */
export function errorText(err: unknown): string {
  return err instanceof Error ? err.message : "Something went wrong.";
}

/** Today as YYYY-MM-DD in local time (for date fields). */
export function todayIso(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
