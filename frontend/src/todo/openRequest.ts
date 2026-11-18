// "Open this task when the to-do app appears": set by the ticker before the
// flights to Mission Control's screen, taken (once) by the to-do panel.
let pending: number | null = null;

export function requestOpenTask(id: number): void {
  pending = id;
}

export function takeOpenTaskRequest(): number | null {
  const id = pending;
  pending = null;
  return id;
}

/** Look without using it up (safe in a state initialiser, which React may run twice). */
export function peekOpenTaskRequest(): number | null {
  return pending;
}
