// A robot monitor's live counts, from the same counts-only queries the belt labels use
// (shared query keys, so nothing is fetched twice). Errors leave the screen neutral.
import { useQuery } from "@tanstack/react-query";

import { getJobsBadge, getVaultBadge, listTasks, type BuildingId } from "../api";
import { localDateString } from "../todo/dates";
import { liveStat, type LiveStat } from "./liveStat";

export function useLiveStat(id: BuildingId): LiveStat | null {
  const tasks = useQuery({
    queryKey: ["tasks", "open"],
    queryFn: () => listTasks("open"),
    enabled: id === "planner",
  });
  const vault = useQuery({
    queryKey: ["vault-badge"],
    queryFn: getVaultBadge,
    enabled: id === "finance",
    refetchInterval: 60_000,
    retry: false,
  });
  const jobs = useQuery({
    queryKey: ["jobs-badge"],
    queryFn: getJobsBadge,
    enabled: id === "jobs",
    refetchInterval: 60_000,
    retry: false,
  });
  const today = localDateString(new Date());
  const open = tasks.data?.filter((t) => t.status === "open");
  return liveStat(id, {
    dueToday: open?.filter((t) => t.goal_date === today).length,
    overdue: open?.filter((t) => t.goal_date !== null && t.goal_date < today).length,
    vaultBadge: vault.isSuccess ? vault.data.text : undefined,
    jobsBadge: jobs.isSuccess ? jobs.data.text : undefined,
  });
}
