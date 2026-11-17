// Whether the camera is mid-flight, and the request to skip to its end
// (a click or Escape during a flight finishes it instead of doing anything else).
let flying = false;
let skip = false;

export const flightState = {
  flying: () => flying,
  start(): void {
    flying = true;
    skip = false;
  },
  end(): void {
    flying = false;
    skip = false;
  },
  skip(): void {
    if (flying) skip = true;
  },
  skipRequested: () => skip,
};

/** What Escape does: finish a flight first; otherwise step out a level (not while typing). */
export function escapeAction(s: {
  flying: boolean;
  inTextField: boolean;
  atBelt: boolean;
}): "skip" | "back" | "none" {
  if (s.flying) return "skip";
  if (s.inTextField || s.atBelt) return "none";
  return "back";
}
