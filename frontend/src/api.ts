// Talking to the backend. Every API call goes through here.
//
// Each call either returns the backend's answer, typed, or throws an ApiError
// carrying the HTTP status and a message fit to show on screen.

export type Health = { status: string };

export type Mode = "sample" | "personal";

/** The nine generic building IDs (same order as the backend). Names come from settings. */
export type BuildingId =
  | "planner"
  | "finance"
  | "jobs"
  | "career"
  | "mail"
  | "relationships"
  | "projects"
  | "gym"
  | "library";

export type Building = { id: BuildingId; name: string };

export type Category = "work" | "side_work" | "personal" | "city";
export type TaskStatus = "open" | "done" | "archived";
export type ListFilter = TaskStatus | "all";

/** A task as the backend sends it. Times are UTC ("2026-11-15T21:00:00Z"). */
export type Task = {
  id: number;
  title: string;
  notes: string;
  category: Category;
  goal_date: string | null; // "2026-12-01"
  reminder_at: string | null; // local time, "2026-11-30T09:00"
  status: TaskStatus;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  stale: boolean;
};

export type NewTask = {
  title: string;
  category: Category;
  notes?: string;
  goal_date?: string | null;
  reminder_at?: string | null;
};

/** Only the fields included are changed. null clears goal_date or reminder_at. */
export type TaskEdit = Partial<{
  title: string;
  category: Category;
  notes: string;
  goal_date: string | null;
  reminder_at: string | null;
}>;

export type HistoryKind = "created" | "edited" | "completed" | "reopened" | "archived";

export type HistoryEvent = {
  at: string;
  kind: HistoryKind;
  changes: Record<string, [unknown, unknown]>;
};

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

// --- Calls -------------------------------------------------------------------

export const getHealth = () => request<Health>("GET", "/api/health");

export const getMode = async (): Promise<Mode> =>
  (await request<{ mode: Mode }>("GET", "/api/mode")).mode;

/** Switch modes. Going to Personal waits for Touch ID; a refusal throws ApiError. */
export const setMode = async (mode: Mode): Promise<Mode> =>
  (await request<{ mode: Mode }>("PUT", "/api/mode", { mode })).mode;

export const getBuildings = () => request<Building[]>("GET", "/api/buildings");

/** Day or night where the settings say; times are ISO 8601 with their offset. */
export type Daylight = {
  is_night: boolean;
  sunrise: string | null;
  sunset: string | null;
  next_change: string;
  /** 0 new moon, 0.5 full. */
  moon_phase: number;
};

export const getDaylight = () => request<Daylight>("GET", "/api/daylight");

/** Something needing attention (for now: a task's reminder has come due). */
export type NotificationItem = {
  id: number;
  kind: "reminder";
  task_id: number | null;
  title: string;
  /** The reminder's local time, "2026-11-30T09:00". */
  due_at: string;
  /** The shuttle has already flown for it. */
  seen: boolean;
};
/** The list comes with the mode it belongs to; seen and dismiss send that mode back. */
export type NotificationList = { mode: Mode; items: NotificationItem[] };

/** looking: this window has focus (the backend skips Mac notifications while you're looking). */
export const getNotifications = (looking: boolean) =>
  request<NotificationList>("GET", `/api/notifications?looking=${looking ? 1 : 0}`);

export const markSeen = (id: number, mode: Mode) =>
  request<{ ok: boolean }>("POST", `/api/notifications/${id}/seen`, { mode });

export const dismissNotification = (id: number, mode: Mode) =>
  request<{ ok: boolean }>("POST", `/api/notifications/${id}/dismiss`, { mode });

export const listTasks = (filter: ListFilter = "open") =>
  request<Task[]>("GET", `/api/tasks?status=${filter}`);

export const getTask = (id: number) => request<Task>("GET", `/api/tasks/${id}`);

export const createTask = (task: NewTask) => request<Task>("POST", "/api/tasks", task);

export const editTask = (id: number, changes: TaskEdit) =>
  request<Task>("PATCH", `/api/tasks/${id}`, changes);

export const completeTask = (id: number) => request<Task>("POST", `/api/tasks/${id}/complete`);
export const reopenTask = (id: number) => request<Task>("POST", `/api/tasks/${id}/reopen`);
export const archiveTask = (id: number) => request<Task>("POST", `/api/tasks/${id}/archive`);

export const getHistory = (id: number) =>
  request<HistoryEvent[]>("GET", `/api/tasks/${id}/history`);

// --- Plumbing ----------------------------------------------------------------

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, "The engine isn't reachable. Is the backend running?");
  }
  if (!response.ok) {
    throw new ApiError(response.status, await errorMessage(response));
  }
  return (await response.json()) as T;
}

/** Turn the backend's error body into one readable sentence. */
async function errorMessage(response: Response): Promise<string> {
  try {
    const { detail } = (await response.json()) as { detail?: unknown };
    if (typeof detail === "string") return detail;
    // Input-check errors arrive as a list: [{ loc: ["body", "title"], msg: "..." }, ...]
    if (Array.isArray(detail) && detail.length > 0) {
      return detail
        .map((d: { loc?: unknown[]; msg?: string }) => {
          const field = d.loc?.filter((part) => part !== "body").join(".");
          const msg = (d.msg ?? "is not valid").replace(/^Value error, /, "");
          return field ? `${field}: ${msg}` : msg;
        })
        .join(" ");
    }
  } catch {
    // Body wasn't JSON; fall through.
  }
  return `The engine answered with an error (${response.status}).`;
}
