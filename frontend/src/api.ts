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

/** Something needing attention: a task's reminder has come due, or last month's
 * statement is waiting to be imported ("statement", no task). */
export type NotificationItem = {
  id: number;
  kind: "reminder" | "statement";
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

// --- Mission Control: Daily plan ---------------------------------------------------

export type PlanKind = "work" | "commute" | "gym" | "event" | "side_work" | "build" | "other";
export type GymStatus = "planned" | "done" | "skipped";

/** One block of a saved week. Days are "2026-11-25"; times are local "09:00". */
export type PlanBlock = {
  id: number;
  day: string;
  start: string;
  end: string;
  title: string;
  kind: PlanKind;
  source: "settings" | "added";
  status: GymStatus; // removed blocks are never sent
  edited: boolean;
};

export type PlanWeek = {
  configured: boolean; // false: no [plan] section in the settings file
  week_start: string; // a Monday
  today: string;
  exists: boolean; // false: not saved (and not created)
  checked_in: boolean;
  days: { day: string; blocks: PlanBlock[] }[]; // seven days, or none when not saved
};

export type NewPlanBlock = {
  week_start: string;
  day: string;
  start: string;
  end: string;
  title: string;
  kind: PlanKind;
};

export type PlanBlockEdit = Partial<Pick<PlanBlock, "day" | "start" | "end" | "title" | "kind">>;

export const getPlanWeek = (start?: string) =>
  request<PlanWeek>("GET", start ? `/api/plan/week?start=${start}` : "/api/plan/week");
export const openPlanWeek = (start: string) =>
  request<PlanWeek>("POST", `/api/plan/week/${start}/open`);
export const rebuildPlanWeek = (start: string) =>
  request<PlanWeek>("POST", `/api/plan/week/${start}/rebuild`);
export const addPlanBlock = (block: NewPlanBlock) =>
  request<PlanBlock>("POST", "/api/plan/blocks", block);
export const editPlanBlock = (id: number, changes: PlanBlockEdit) =>
  request<PlanBlock>("PATCH", `/api/plan/blocks/${id}`, changes);
export const removePlanBlock = (id: number) =>
  request<PlanBlock>("POST", `/api/plan/blocks/${id}/remove`);
export const setGym = (id: number, status: GymStatus) =>
  request<PlanBlock>("POST", `/api/plan/blocks/${id}/gym`, { status });

// --- Plumbing ----------------------------------------------------------------

// --- The Vault's Side work (spec: docs/superpowers/specs/2026-11-18-vault-side-work-design.md)

export type GroupStatus = "waiting" | "overdue" | "paid" | "no_schedule";
export type Currency = "CAD" | "USD";

export type SideWorkEntry = {
  id: number;
  worked_on: string;
  company: string | null;
  role: string | null;
  hours: string | null;
  hundredths: number | null;
  rate_cents: number | null;
  currency: Currency;
  expected_cents: number | null;
};

export type SideWorkPayment = {
  id: number;
  kind: "pay" | "bonus" | "extra";
  company: string | null;
  received_on: string;
  amount_cents: number;
  currency: Currency;
  rate: string | null;
  rate_date: string | null;
  received_cad_cents: number | null;
  includes_bonus: boolean;
  bonus_cents: number | null;
  notes: string | null;
  deposit_id: number | null;
};

export type SideWorkGroup = {
  company: string | null;
  company_name: string | null;
  schedule_id: string | null;
  period: [string, string] | null;
  window: [string, string] | null;
  status: GroupStatus;
  entries: SideWorkEntry[];
  expected_cad_cents: number | null;
  expected_is_partial: boolean;
  expected_is_estimate: boolean;
  payment: SideWorkPayment | null;
  difference_cad_cents: number | null;
  bonus_cad_cents: number | null;
};

export type SideWorkView = {
  summary: {
    month_received_cad_cents: number;
    still_expected_cad_cents: number;
    year_received_cad_cents: number;
    set_aside_cad_cents: number;
    set_aside_percent: string;
    set_aside_is_placeholder: boolean;
    rates_pending: boolean;
  };
  schedules: { id: string; name: string }[];
  groups: SideWorkGroup[];
  bonuses: SideWorkPayment[];
  extras: SideWorkPayment[];
};

export type NewEntry = {
  worked_on: string;
  company?: string | null;
  role?: string | null;
  hours?: string | null;
  rate?: string | null;
  currency: Currency;
};

export type NewPayment = {
  kind: "pay" | "bonus" | "extra";
  company?: string | null;
  received_on: string;
  amount: string;
  currency: Currency;
  entry_ids: number[];
  includes_bonus?: boolean;
  bonus?: string | null;
  notes?: string | null;
};

export type PaymentEdit = { includes_bonus: boolean; bonus: string | null; notes: string | null };

// --- The Vault's income (part B) ---

export type SourceCents = { key: string; name: string; cents: number };

export type IncomeView = {
  month: {
    month: string;
    gross_cents: number;
    net_cents: number;
    gross_missing: boolean;
    goal_cents: number;
    employer_match_cents: number;
    by_source: SourceCents[];
    /** This month's main-job gross (net where gross isn't typed) and all side income. */
    main_job_gross_cents: number;
    side_gross_cents: number;
    /** What to call the main job in the month's rows ("Main job" in Sample mode). */
    main_job_label: string;
  };
  months: { month: string; by_source: SourceCents[]; total_cents: number }[];
  /** This calendar year so far, by the same gross and net rules as the month. */
  year: {
    year: number;
    gross_cents: number;
    net_cents: number;
    main_job_gross_cents: number;
    side_gross_cents: number;
  };
  platforms: {
    id: string;
    name: string;
    hours: string;
    received_cad_cents: number;
    rate_cad_cents: number | null;
  }[];
  set_aside: { cents: number; percent: string; is_placeholder: boolean };
  main_job_pay: MainJobPay[];
};

/** One main-job pay: typed in on payday, or from a statement deposit. */
export type MainJobPay = {
  id: number;
  /** The payday (the typed date, kept when a statement confirms it). */
  day: string;
  net_cents: number;
  gross_cents: number | null;
  rrsp_cents: number | null;
  match_cents: number | null;
  deductions_cents: number | null;
  notes: string | null;
  /** A statement deposit has confirmed it, or (older pay) it was checked by hand. */
  confirmed: boolean;
  checked_by_hand: boolean;
};

export type MainJobAdd = {
  paid_on: string;
  net: string;
  gross: string | null;
  rrsp: string | null;
  match: string | null;
  notes: string | null;
};

/** Stub details replace what's there; paid_on and net only change before confirmation. */
export type MainJobEdit = {
  paid_on?: string | null;
  net?: string | null;
  gross: string | null;
  rrsp: string | null;
  match: string | null;
  notes: string | null;
};

export type Proposal = {
  kind: "week" | "bonus" | "link" | "unmatched";
  week_start: string | null;
  payment_id: number | null;
  check_amount: boolean;
  payment?: { received_on: string; amount_cents: number; currency: Currency };
};

export type PreviewRow = { ref: string; day: string; amount_cents: number };

export type MainJobProposal = {
  kind: "link" | "new";
  pay_id: number | null;
  pay: { paid_on: string; net_cents: number } | null;
  /** Near the typed pay's date but more than 1% off: likely a typo, check it. */
  check_amount: boolean;
};

export type StatementPreview = {
  token: string;
  first_day: string;
  last_day: string;
  main_job: (PreviewRow & { proposal: MainJobProposal })[];
  /** Main-job pay typed in and not yet confirmed, to link a deposit to by hand. */
  typed_pay: { id: number; paid_on: string; net_cents: number }[];
  platform: (PreviewRow & { schedule_id: string; proposal: Proposal })[];
  other_income: PreviewRow[];
  weeks: { schedule_id: string; start: string; window: [string, string] }[];
  hand_payments: {
    id: number;
    schedule_id: string;
    received_on: string;
    amount_cents: number;
    currency: Currency;
  }[];
  already_imported: number;
  spending: number;
  other_currency: number;
};

export type ConfirmBody = {
  token: string;
  main_job: {
    ref: string;
    action?: "new" | "link" | "skip";
    pay_id?: number | null;
    gross?: string | null;
    rrsp?: string | null;
    match?: string | null;
    notes?: string | null;
  }[];
  platform: {
    ref: string;
    action: "week" | "bonus" | "link" | "skip";
    week_start?: string | null;
    payment_id?: number | null;
    includes_bonus?: boolean;
    bonus?: string | null;
    notes?: string | null;
  }[];
  other_income: {
    ref: string;
    action: "add" | "skip";
    company?: string | null;
    notes?: string | null;
  }[];
};

export type StatementImport = {
  id: number;
  first_day: string;
  last_day: string;
  kept: number;
  duplicates: number;
  skipped: number;
  spending: number;
  created_at: string;
};

// The Vault key from Touch ID lives only in this variable: never in storage,
// so a reload (or restart) asks for Touch ID again.
let vaultKey: string | null = null;

const lockListeners = new Set<() => void>();

/** Be told when the engine says the Vault is locked again (restart, mode switch). */
export function onVaultLocked(listener: () => void): () => void {
  lockListeners.add(listener);
  return () => lockListeners.delete(listener);
}

export const hasVaultKey = () => vaultKey !== null;
export const forgetVaultKey = () => {
  vaultKey = null;
};

export async function unlockVault(): Promise<void> {
  const { key } = await request<{ key: string | null }>("POST", "/api/vault/unlock");
  vaultKey = key;
}

async function vault<T>(method: string, path: string, body?: unknown): Promise<T> {
  return vaultAt<T>(method, `/api/vault/side-work${path}`, body);
}

async function vaultAt<T>(method: string, fullPath: string, body?: unknown): Promise<T> {
  try {
    return await request<T>(
      method,
      fullPath,
      body,
      vaultKey ? { "X-Vault-Key": vaultKey } : undefined,
    );
  } catch (err) {
    if (err instanceof ApiError && err.status === 403) {
      vaultKey = null; // locked again
      lockListeners.forEach((listener) => listener());
    }
    throw err;
  }
}

export const getSideWork = () => vault<SideWorkView>("GET", "");
export const refreshRates = () => vault<{ ok: boolean }>("POST", "/rates/refresh");
export const addEntry = (entry: NewEntry) => vault<SideWorkEntry>("POST", "/entries", entry);
export const archiveEntry = (id: number) => vault<unknown>("POST", `/entries/${id}/archive`);
export const recordPayment = (p: NewPayment) => vault<unknown>("POST", "/payments", p);
export const setManualRate = (day: string, rate: string) =>
  vault<unknown>("PUT", `/rates/${day}`, { rate });
export const editPayment = (id: number, edit: PaymentEdit) =>
  vault<unknown>("PATCH", `/payments/${id}`, edit);

export const getIncome = () => vaultAt<IncomeView>("GET", "/api/vault/income");
export const addMainJob = (pay: MainJobAdd) =>
  vaultAt<MainJobPay>("POST", "/api/vault/income/main-job", pay);
export const archiveMainJob = (payId: number) =>
  vaultAt<unknown>("POST", `/api/vault/income/main-job/${payId}/archive`);
export const editMainJob = (payId: number, edit: MainJobEdit) =>
  vaultAt<MainJobPay>("PATCH", `/api/vault/income/main-job/${payId}`, edit);
export const listStatements = () => vaultAt<StatementImport[]>("GET", "/api/vault/statements");
export const confirmStatement = (body: ConfirmBody) =>
  vaultAt<{ import_id: number; kept: number; duplicates: number; skipped: number }>(
    "POST",
    "/api/vault/statements/confirm",
    body,
  );

/** Send a statement CSV as it is (the raw file) and get the proposals back. */
export async function previewStatement(csv: Blob | string): Promise<StatementPreview> {
  let response: Response;
  try {
    response = await fetch("/api/vault/statements/preview", {
      method: "POST",
      headers: { "Content-Type": "text/csv", ...(vaultKey ? { "X-Vault-Key": vaultKey } : {}) },
      body: csv,
    });
  } catch {
    throw new ApiError(0, "The engine isn't reachable. Is the backend running?");
  }
  if (!response.ok) {
    const err = new ApiError(response.status, await errorMessage(response));
    if (response.status === 403) {
      vaultKey = null;
      lockListeners.forEach((listener) => listener());
    }
    throw err;
  }
  return (await response.json()) as StatementPreview;
}

/** Sample mode's made-up statement, for trying the import. */
export async function getSampleStatement(): Promise<string> {
  const response = await fetch("/api/vault/statements/sample.csv");
  if (!response.ok) throw new ApiError(response.status, await errorMessage(response));
  return response.text();
}

/** The Vault's belt badge: counts only, so no key is needed. */
export const getVaultBadge = () => request<{ text: string | null }>("GET", "/api/vault/badge");

// --- Shared plumbing ----------------------------------------------------------

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  extraHeaders?: Record<string, string>,
): Promise<T> {
  let response: Response;
  const headers: Record<string, string> = { ...extraHeaders };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  try {
    response = await fetch(path, {
      method,
      headers,
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
