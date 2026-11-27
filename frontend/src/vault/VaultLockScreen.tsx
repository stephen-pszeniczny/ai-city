// A building's lock: one Touch ID prompt (the Mac's own, password as backup) per app
// session before any Personal data is shown. The Vault's by default; Opportunity
// Office passes its own place name and unlock call.
import { useState } from "react";

import { unlockVault } from "../api";

export function VaultLockScreen({
  onUnlocked,
  place = "The Vault",
  unlock: unlockCall = unlockVault,
}: {
  onUnlocked: () => void;
  place?: string;
  unlock?: () => Promise<void>;
}) {
  const [waiting, setWaiting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function unlock() {
    setWaiting(true);
    setError(null);
    try {
      await unlockCall();
      onUnlocked();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Touch ID didn't confirm.");
    } finally {
      setWaiting(false);
    }
  }

  return (
    <div className="sw-lock">
      <span className="sw-lock__icon" aria-hidden="true">
        🔒
      </span>
      <h2>{place} is locked</h2>
      <p className="sw-chip sw-chip--plain">Opens until the app reloads</p>
      <button type="button" onClick={unlock} disabled={waiting} autoFocus>
        {waiting ? "Waiting for Touch ID…" : "Unlock with Touch ID"}
      </button>
      {error && (
        <p className="sw-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
