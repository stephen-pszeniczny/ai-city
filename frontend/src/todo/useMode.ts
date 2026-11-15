// Which database the backend is using, and whether to show the Sample reminder.
import { useQuery } from "@tanstack/react-query";

import { getMode } from "../api";

/**
 * True unless the backend has just confirmed Personal mode.
 *
 * Fails safe: while loading, when the engine is down, or when the last check
 * failed (even after an earlier success), the reminder shows.
 */
export function useSampleReminder(): boolean {
  const mode = useQuery({
    queryKey: ["mode"],
    queryFn: getMode,
    retry: false,
    refetchInterval: 30_000,
  });
  return !(mode.status === "success" && mode.data === "personal");
}
