# Day and night mode: design

Approved 2026-11-18. Size: a small feature (short design).

## Intent

The belt follows the real time of day where the owner lives: day mode in daylight, night mode
after dark, switching at local sunrise and sunset, with a manual override. Night means the station
is in Earth's shadow: sun hidden, station lights on, brighter stars, and a moon in the sky.

## Goals
- Sunrise and sunset worked out on the Mac from the `[location]` in the private settings file.
  No internet feed.
- Every view (belt, control-room windows, asteroid views) changes together, because they all share
  one space scene (`frontend/src/belt/space/`).
- A manual override: Auto, Day, Night.
- A moon that appears only at night.

## Non-goals and anti-goals
- The interface panels (glass labels, panels, desktop screen) don't change: the black base with
  royal blue stays in both modes.
- No location, city or coordinates in tracked code, tests, screenshots or docs. Tests use the
  example location from `settings.example.toml` and made-up places.
- No visual layout tests (spec section 10). The look is judged live.

## Approaches

1. **Backend works out the sun times; the page asks for them (chosen).** A new
   `GET /api/daylight` returns today's sunrise and sunset, whether it's night now, and the time
   of the next change. The location never leaves the backend, the maths is tested with pytest
   next to the other settings code, and the page re-asks at each change.
2. Send the location to the page and work it out in the browser. Rejected: puts the coordinates
   into the page for no gain, and splits time handling across two places.
3. Use the Mac's clock only (fixed 7 AM / 7 PM). Rejected: the spec asks for real sunrise and
   sunset.

## Design

- **Sun maths (backend):** the standard NOAA sunrise/sunset formula in a small pure module, using
  the settings' latitude, longitude and time zone (so daylight saving is handled). Tested against
  published times for a few dates and places, including a daylight-saving changeover and a
  far-north date with very short days.
- **Day look:** the scene as it is today.
- **Night look:** the sun moves behind Earth, so Earth shows its dark side with city lights and a
  thin glowing atmosphere ring at its edge. Sunlight on the station fades; its windows and lights
  glow brighter; the stars brighten.
- **Moon (Steve, 2026-11-18):** fades in at night, out by day. Shown in tonight's real phase,
  worked out locally from the date (my call: costs one small formula and makes it feel real).
- **Changeover while open:** a slow fade of about 20 s, like the sun slipping behind Earth.
  Reduced motion switches at once.
- **Override:** a small glass button beside the Personal/Sample switch on the belt that cycles
  Auto → Day → Night. Remembered in this browser (a per-viewer convenience, so browser storage is
  fine and falls back to Auto if storage is unavailable). Day or Night stays until set back to
  Auto.
- **Look settings:** fade length, night star brightness, station light glow and moon brightness
  go in `frontend/src/belt/look.ts`.
- **Tests:** sunrise/sunset maths, moon phase, the "is it night now and when is the next change"
  rule, the route, and the override cycling.

## Left to the builder
Exact light strengths and colours at night, the moon's size and position in the sky, how the
atmosphere ring is drawn, and where exactly the override button sits.
