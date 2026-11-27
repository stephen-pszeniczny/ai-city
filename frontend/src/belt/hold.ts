// When a 3D piece should do its per-frame animation. While the computer screen is open
// the scene holds still (robots, Earth, sky, gadgets) except the asteroid orbit, and
// anything out of the camera's view stops too. Pure, so it's tested on its own.

export function shouldAnimate(o: { hold: boolean; inView: boolean; keepMoving: boolean }): boolean {
  if (o.keepMoving) return true;
  return !o.hold && o.inView;
}
