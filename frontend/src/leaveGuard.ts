// One rule for unsaved edits, used by every way out of a screen: the task's
// Back button, the belt's Back button, the Escape key and the browser's Back.
let dirty = false;

export function setDirty(value: boolean): void {
  dirty = value;
}

export function isDirty(): boolean {
  return dirty;
}

/** True if it's fine to leave: nothing unsaved, or the person agreed to discard it. */
export function confirmLeave(
  ask: (message: string) => boolean = (m) => window.confirm(m),
): boolean {
  if (!dirty) return true;
  return ask("Discard your unsaved changes?");
}
