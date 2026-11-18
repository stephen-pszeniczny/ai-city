// The Sky button on the belt: cycles Auto → Day → Night (SPEC section 7's manual
// override for day and night mode). Auto follows sunrise and sunset.
import { CHOICE_LABELS, type SkyChoice } from "./dayNight";

export function SkyToggle({ choice, onCycle }: { choice: SkyChoice; onCycle: () => void }) {
  const label = CHOICE_LABELS[choice];
  return (
    <button
      type="button"
      className="sky-toggle"
      aria-label={`Day and night: ${label}. Press to change.`}
      onClick={onCycle}
    >
      Sky: {label}
    </button>
  );
}
