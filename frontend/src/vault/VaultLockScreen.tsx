// The Vault's lock: one Touch ID prompt (the Mac's own, password as backup)
// per app session before any Personal finance data is shown.
import { useState } from "react";

import { unlockVault } from "../api";

export function VaultLockScreen({ onUnlocked }: { onUnlocked: () => void }) {
  const [waiting, setWaiting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function unlock() {
    setWaiting(true);
    setError(null);
    try {
      await unlockVault();
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
      <h2>The Vault is locked</h2>
      <p>Touch ID once and it stays open until the app reloads.</p>
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
