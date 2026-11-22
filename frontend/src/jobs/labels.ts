// Short display names for Opportunity Office statuses.
import type { PlatformStatus, ProjectStatus } from "../api";

export const PLATFORM_STATUS: Record<PlatformStatus, string> = {
  not_applied: "Not applied",
  applied: "Applied",
  assessment: "Assessment",
  onboarding: "Onboarding",
  active: "Active",
  paused: "Paused",
  rejected: "Rejected",
};

export const PROJECT_STATUS: Record<ProjectStatus, string> = {
  found: "Found",
  applied: "Applied",
  assessment: "Assessment",
  accepted: "Accepted",
  rejected: "Rejected",
  active: "Active",
  ended: "Ended",
};

/** Today as YYYY-MM-DD in the Mac's local time. */
export function localToday(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}
