// The Vault's door: on the first visit of each app session the robot opens it
// for you; after that it stays open until the app is reloaded. Kept in memory
// only (a reload closes it again).
let open = false;
/** When the opening starts (performance.now() milliseconds), or null. */
let openingAt: number | null = null;

export const vaultDoor = {
  isOpen(): boolean {
    return open;
  },
  /** True the first time it's called this session (the opening plays), then false. */
  claimFirstOpening(): boolean {
    if (open) return false;
    open = true;
    return true;
  },
  /** Set when the opening will play (the camera reaching the door, or now). */
  scheduleOpening(atMs: number): void {
    openingAt = atMs;
  },
  openingStart(): number | null {
    return openingAt;
  },
  resetForTests(): void {
    open = false;
    openingAt = null;
  },
};
