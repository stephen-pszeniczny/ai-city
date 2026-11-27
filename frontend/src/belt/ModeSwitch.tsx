// The Sample | Personal switch on the belt (SPEC section 7).
//
// Personal → Sample switches at once. Sample → Personal waits while the
// backend shows the Mac's Touch ID prompt (Mac password as the backup).
// After any switch every cached answer is thrown away and fetched again,
// so nothing from the other database stays on screen.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { getMode, setMode, type Mode } from "../api";
import { canSwitchTo, switchStatus } from "./switchRules";

/** Names the switch, so others can tell when one is under way. */
export const MODE_SWITCH_KEY = ["set-mode"];

const ERROR_SHOWN_MS = 6000;
const LABELS: Record<Mode, string> = { sample: "Sample", personal: "Personal" };

export function ModeSwitch() {
  const queryClient = useQueryClient();
  const mode = useQuery({ queryKey: ["mode"], queryFn: getMode, retry: false });
  const [error, setError] = useState<string | null>(null);

  const change = useMutation({
    mutationKey: MODE_SWITCH_KEY,
    mutationFn: setMode,
    onMutate: () => setError(null),
    onSuccess: () => queryClient.resetQueries(),
    onError: (e: Error) => setError(e.message),
  });

  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(null), ERROR_SHOWN_MS);
    return () => clearTimeout(t);
  }, [error]);

  const state = {
    mode: mode.status === "success" ? mode.data : undefined,
    pendingTo: change.isPending ? change.variables : null,
  };
  const status = switchStatus(state);

  return (
    <div className="mode-switch">
      <div className="mode-switch__pill" role="group" aria-label="Data mode">
        {(["sample", "personal"] as const).map((m) => (
          <button
            key={m}
            type="button"
            className="mode-switch__option"
            aria-pressed={state.mode === m}
            disabled={!canSwitchTo(m, state)}
            onClick={() => change.mutate(m)}
          >
            {LABELS[m]}
          </button>
        ))}
      </div>
      <p className="mode-switch__note" role="status">
        {error ?? status ?? ""}
      </p>
    </div>
  );
}
