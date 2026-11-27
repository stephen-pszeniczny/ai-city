// The Sample-mode reminder at the top of the panel.
// Shown whenever the list may be using demo data (see useSampleReminder).
import { useSampleReminder } from "./useMode";

export function ModeBanner() {
  const show = useSampleReminder();
  if (!show) return null;
  return (
    <p className="mode-banner" role="note">
      <WarningIcon />
      <span>
        <strong>Sample mode</strong> · demo data
      </span>
    </p>
  );
}

export function WarningIcon() {
  return (
    <svg className="warn-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path d="M8 1.5 15 14H1L8 1.5Z" fill="currentColor" />
      <path d="M8 6v4" stroke="#000" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="8" cy="12" r="0.9" fill="#000" />
    </svg>
  );
}
