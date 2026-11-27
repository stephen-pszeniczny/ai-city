// Whether a panel may switch the computer to another app: it must be on this
// computer and ready (not "arrives in a later phase").
export function appExists(apps: readonly { id: string; ready: boolean }[], id: string): boolean {
  return apps.some((a) => a.id === id && a.ready);
}
