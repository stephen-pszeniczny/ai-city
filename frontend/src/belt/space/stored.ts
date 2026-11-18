// Keeping the slow-to-build parts of the scene between opens, so only the very
// first open builds them: the large asteroids' shapes and Earth's painted maps.
//
// Stored in this browser's IndexedDB (on this Mac only; made-up scenery, no
// personal data). Each entry's key carries a fingerprint of the code that built
// it, so changing how Earth or a rock is made ignores the old copies by itself.
//
// Before the scene starts, prepareStoredScene() loads what's there into memory;
// rockGeometry() and Earth then pick it up without waiting. Anything going wrong
// (private window, storage blocked or full) just means building as before.
import * as THREE from "three";

const DB_NAME = "asteroid-belt-scene";
const STORE = "items";

/** A short fingerprint of some code: changes whenever the code changes. */
export function fingerprint(...code: { toString(): string }[]): string {
  let h = 0x811c9dc5; // FNV-1a
  for (const part of code) {
    const s = part.toString();
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
  }
  return h.toString(16).padStart(8, "0");
}

// --- Rocks ------------------------------------------------------------------

export type GeometryArrays = {
  position: Float32Array;
  normal: Float32Array;
  color: Float32Array;
  index: Uint32Array | null;
};

export function geometryToArrays(geo: THREE.BufferGeometry): GeometryArrays {
  const f32 = (name: string) => new Float32Array(geo.getAttribute(name).array as ArrayLike<number>);
  return {
    position: f32("position"),
    normal: f32("normal"),
    color: f32("color"),
    index: geo.index ? new Uint32Array(geo.index.array as ArrayLike<number>) : null,
  };
}

export function arraysToGeometry(a: GeometryArrays): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(a.position, 3));
  geo.setAttribute("normal", new THREE.BufferAttribute(a.normal, 3));
  geo.setAttribute("color", new THREE.BufferAttribute(a.color, 3));
  if (a.index) geo.setIndex(new THREE.BufferAttribute(a.index, 1));
  geo.computeBoundingSphere();
  return geo;
}

let rockVersion = "";
let earthVersion = "";
/** Set once by rock.ts and earth.ts, from the code that builds them. */
export function setVersions(v: { rock?: string; earth?: string }): void {
  if (v.rock !== undefined) rockVersion = v.rock;
  if (v.earth !== undefined) earthVersion = v.earth;
}

const rockKey = (seed: number, tint: string, detail: number) =>
  `rock:${rockVersion}:${seed}:${tint}:${detail}`;
const rocks = new Map<string, GeometryArrays>();

/** A rock built earlier (this open or a previous one), or undefined. */
export function storedRock(
  seed: number,
  tint: string,
  detail: number,
): THREE.BufferGeometry | undefined {
  const a = rocks.get(rockKey(seed, tint, detail));
  return a ? arraysToGeometry(a) : undefined;
}

/** Keep a freshly built rock, here and for the next open. */
export function rememberRock(seed: number, tint: string, detail: number, a: GeometryArrays): void {
  const key = rockKey(seed, tint, detail);
  rocks.set(key, a);
  void put(key, a);
}

// --- Earth --------------------------------------------------------------------

let earthMaps: ImageBitmap[] | null = null;

/** Earth's four maps from a previous open (day, night, spec, clouds), or null. */
export function storedEarthMaps(): ImageBitmap[] | null {
  return earthMaps;
}

/** Keep Earth's freshly painted maps for the next open (encoded off the main thread). */
export function rememberEarthMaps(canvases: HTMLCanvasElement[]): void {
  canvases.forEach((c, k) => {
    try {
      c.toBlob((blob) => {
        if (blob) void put(`earth:${earthVersion}:${k}`, blob);
      }, "image/png");
    } catch {
      // Not kept this time; built again next open.
    }
  });
}

// --- Loading before the scene starts ---------------------------------------

/** Load whatever was kept, and drop entries from older versions. Never rejects. */
export async function prepareStoredScene(): Promise<void> {
  try {
    const db = await open();
    const all = await new Promise<{ key: string; value: unknown }[]>((resolve, reject) => {
      const out: { key: string; value: unknown }[] = [];
      const req = db.transaction(STORE, "readonly").objectStore(STORE).openCursor();
      req.onsuccess = () => {
        const c = req.result;
        if (!c) return resolve(out);
        out.push({ key: String(c.key), value: c.value });
        c.continue();
      };
      req.onerror = () => reject(req.error);
    });
    const blobs: (Blob | undefined)[] = [];
    const stale: string[] = [];
    for (const { key, value } of all) {
      const [kind, version, ...rest] = key.split(":");
      if (kind === "rock" && version === rockVersion) rocks.set(key, value as GeometryArrays);
      else if (kind === "earth" && version === earthVersion) blobs[Number(rest[0])] = value as Blob;
      else stale.push(key);
    }
    if (blobs.length === 4 && blobs.every(Boolean)) {
      // Decoded by the browser in the background; flipped to match canvas textures.
      earthMaps = await Promise.all(
        blobs.map((b) => createImageBitmap(b!, { imageOrientation: "flipY" })),
      );
    }
    if (stale.length) {
      const store = db.transaction(STORE, "readwrite").objectStore(STORE);
      stale.forEach((k) => store.delete(k));
    }
  } catch {
    // Storage unavailable: everything is simply built as before.
  }
}

let dbPromise: Promise<IDBDatabase> | null = null;
function open(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function put(key: string, value: unknown): Promise<void> {
  try {
    if (typeof indexedDB === "undefined") return;
    const db = await open();
    db.transaction(STORE, "readwrite").objectStore(STORE).put(value, key);
  } catch {
    // Not kept this time; built again next open.
  }
}
