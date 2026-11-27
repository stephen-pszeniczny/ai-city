// Where an asteroid's rock surface is, so growth pieces can sit on it, be built
// into it or reach past it. Worked out once from the rock's own shape.
import * as THREE from "three";

export type Ground = {
  /** The rock's top under this spot, as a height in deck coordinates (negative = below the deck). */
  top(x: number, z: number): number;
  /** How far the rock reaches from the centre, toward `azimuth` (radians), at height y. */
  radius(azimuth: number, y: number): number;
  /** The widest the rock gets at height y. */
  maxRadius(y: number): number;
};

const AZ_BINS = 72;
const Y_STEP = 0.25;
const TOP_STEP = 0.4;
const FLOOR = -4;

const azBin = (a: number) =>
  ((Math.floor((a / (Math.PI * 2)) * AZ_BINS) % AZ_BINS) + AZ_BINS) % AZ_BINS;

/** `rock` is the rock's geometry (rock units), `scale` its mesh scale, `deckY` the deck's top. */
export function rockGround(rock: THREE.BufferGeometry, scale: number, deckY: number): Ground {
  const p = rock.attributes.position as THREE.BufferAttribute;
  const side = new Map<string, number>();
  const tops = new Map<string, number>();
  const widest = new Map<number, number>();
  const raise = <K>(map: Map<K, number>, key: K, value: number) => {
    if (value > (map.get(key) ?? -Infinity)) map.set(key, value);
  };
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i) * scale;
    const y = p.getY(i) * scale - deckY;
    const z = p.getZ(i) * scale;
    const r = Math.hypot(x, z);
    const row = Math.round(y / Y_STEP);
    raise(side, `${azBin(Math.atan2(z, x))}:${row}`, r);
    raise(widest, row, r);
    raise(tops, `${Math.round(x / TOP_STEP)}:${Math.round(z / TOP_STEP)}`, y);
  }
  return {
    top(x, z) {
      const [i, k] = [Math.round(x / TOP_STEP), Math.round(z / TOP_STEP)];
      let best = -Infinity;
      for (let di = -1; di <= 1; di++) {
        for (let dk = -1; dk <= 1; dk++) {
          best = Math.max(best, tops.get(`${i + di}:${k + dk}`) ?? -Infinity);
        }
      }
      return Number.isFinite(best) ? best : FLOOR;
    },
    radius(azimuth, y) {
      const row = Math.round(y / Y_STEP);
      const own = side.get(`${azBin(azimuth)}:${row}`);
      if (own !== undefined) return own; // hugs the surface; neighbours only fill gaps
      let best = 0;
      for (let da = -1; da <= 1; da++) {
        for (let dr = -1; dr <= 1; dr++) {
          best = Math.max(best, side.get(`${azBin(azimuth) + da}:${row + dr}`) ?? 0);
        }
      }
      return best;
    },
    maxRadius(y) {
      const row = Math.round(y / Y_STEP);
      return Math.max(...[-1, 0, 1].map((d) => widest.get(row + d) ?? 0));
    },
  };
}
