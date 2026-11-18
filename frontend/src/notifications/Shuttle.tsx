// The notification shuttle: a small white and royal-blue rocket that flies once
// across the belt, with a soft engine glow under and behind it. Its banner is
// page text (sharp at any size), moved each frame to trail just behind the rocket
// on screen, the same way building labels follow their buildings.
//
// The path is worked out from the camera when the flight starts, so it always
// crosses the screen, and the rocket looks about a sixth of the station's length
// however far the belt is zoomed.
import { useFrame, useThree } from "@react-three/fiber";
import { useLayoutEffect, useMemo, useRef, type RefObject } from "react";
import * as THREE from "three";

import { LOOK } from "../belt/look";
import { softGlow } from "../belt/space";
import { pointOnPath, shuttlePath } from "./shuttlePath";

const STATION_LENGTH = 44; // scene units, solar panel tip to tip (what you see as its length)
const DEPTH_SHARE = 0.4; // matches shuttlePath: the rocket flies at 40 % of the camera's distance
const MODEL_LENGTH = 3.5; // the rocket as built below, nozzle to nose
/** It flies 0.4 of the way to what the camera looks at, so this keeps it a sixth of the station on screen. */
const SCALE = ((STATION_LENGTH / 6) * DEPTH_SHARE) / MODEL_LENGTH;
const BANNER_GAP_PX = 14;
const BANNER_LIFT_PX = 6; // the banner sits a touch above the rocket's line; the glow sits below

type Props = {
  banner: RefObject<HTMLDivElement | null>;
  onDone: () => void;
};

export function Shuttle({ banner, onDone }: Props) {
  const { camera, controls, size } = useThree() as unknown as {
    camera: THREE.PerspectiveCamera;
    controls: { target: THREE.Vector3 } | null;
    size: { width: number; height: number };
  };
  const group = useRef<THREE.Group>(null);
  const started = useRef<number | null>(null);
  const done = useRef(false);
  const tmp = useMemo(
    () => ({ p: new THREE.Vector3(), ahead: new THREE.Vector3(), s: new THREE.Vector3() }),
    [],
  );

  // Worked out once, when this flight starts.
  const flight = useMemo(() => {
    const target = controls ? controls.target.clone() : new THREE.Vector3();
    const path = shuttlePath(camera.position.clone(), target, camera.fov);
    return { path, scale: SCALE * LOOK.notifications.rocketSize };
  }, []);

  const parts = useMemo(() => rocketParts(), []);
  useLayoutEffect(() => () => parts.dispose(), [parts]);

  useFrame((state) => {
    const g = group.current;
    const el = banner.current;
    if (!g || done.current) return;
    const now = state.clock.elapsedTime;
    if (started.current === null) started.current = now;
    const k = (now - started.current) / LOOK.notifications.flightSeconds;
    if (k >= 1) {
      done.current = true;
      if (el) el.style.opacity = "0";
      onDone();
      return;
    }
    pointOnPath(flight.path, k, tmp.p);
    pointOnPath(flight.path, Math.min(1, k + 0.01), tmp.ahead);
    g.position.copy(tmp.p);
    g.lookAt(tmp.ahead);
    g.rotateZ(Math.sin(k * Math.PI) * 0.25); // a gentle bank through the turn
    parts.glow.material.opacity =
      1.0 * LOOK.notifications.glowStrength * (0.85 + 0.15 * Math.sin(now * 18));

    if (!el) return;
    // The banner hangs off the tail (behind the nozzle), so it never covers the rocket or its glow.
    g.localToWorld(tmp.s.set(0, 0, -3.6)); // just past the end of the glow
    tmp.s.project(camera);
    if (tmp.s.z >= 1) {
      el.style.opacity = "0";
      return;
    }
    const x = (tmp.s.x * 0.5 + 0.5) * size.width;
    const y = (-tmp.s.y * 0.5 + 0.5) * size.height;
    // Which way it's moving on screen decides which side the banner trails on.
    const aheadX = tmp.ahead.clone().project(camera).x;
    const goingRight = aheadX >= tmp.s.x;
    const offset = goingRight ? `calc(-100% - ${BANNER_GAP_PX}px)` : `${BANNER_GAP_PX}px`;
    el.style.transform = `translate(${x}px, ${y - BANNER_LIFT_PX}px) translate(${offset}, -50%)`;
    el.style.opacity = "1";
  });

  return (
    <group ref={group} scale={flight.scale}>
      <primitive object={parts.rocket} />
    </group>
  );
}

/** The rocket, built along +z (its nose) so lookAt points it where it's going. */
function rocketParts() {
  // Matte, with a touch of its own light, so it reads as white against the blue of space.
  const white = new THREE.MeshStandardMaterial({
    color: 0xf4f6fa,
    roughness: 0.6,
    metalness: 0.05,
    emissive: 0x3a3e46,
  });
  const blue = new THREE.MeshStandardMaterial({ color: 0x3456e0, roughness: 0.4, metalness: 0.3 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x0b1a40, roughness: 0.2, metalness: 0.6 });
  const metal = new THREE.MeshStandardMaterial({ color: 0x8892a6, roughness: 0.3, metalness: 0.9 });

  const body = new THREE.CylinderGeometry(0.42, 0.48, 2.2, 20);
  const nose = new THREE.ConeGeometry(0.42, 0.9, 20);
  const nozzle = new THREE.CylinderGeometry(0.3, 0.42, 0.35, 16);
  const window_ = new THREE.SphereGeometry(0.18, 12, 8);
  const fin = new THREE.BoxGeometry(0.06, 0.55, 0.6);

  const rocket = new THREE.Group();
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, f: (m: THREE.Mesh) => void) => {
    const m = new THREE.Mesh(geo, mat);
    f(m);
    rocket.add(m);
    return m;
  };
  // Cylinders stand along y; turn them to lie along z.
  add(body, white, (m) => (m.rotation.x = Math.PI / 2));
  add(nose, blue, (m) => {
    m.rotation.x = Math.PI / 2;
    m.position.z = 1.55;
  });
  add(nozzle, metal, (m) => {
    m.rotation.x = Math.PI / 2;
    m.position.z = -1.27;
  });
  add(window_, dark, (m) => {
    m.position.set(0, 0.33, 0.55);
    m.scale.set(1, 0.7, 1);
  });
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + Math.PI;
    add(fin, blue, (m) => {
      m.position.set(Math.sin(a) * 0.62, Math.cos(a) * 0.62, -0.75);
      m.rotation.z = -a;
    });
  }

  // The engine glow: behind the nozzle and a little below, clear of the banner.
  const glowMat = new THREE.SpriteMaterial({
    map: softGlow(),
    color: new THREE.Color(1, 0.5, 0.16).multiplyScalar(1.9), // warm, not washed out to white
    blending: THREE.AdditiveBlending,
    transparent: true,
    depthWrite: false,
  });
  const glow = new THREE.Sprite(glowMat);
  glow.position.set(0, -0.45, -2.0);
  glow.scale.set(3.4, 1.5, 1);
  rocket.add(glow);

  return {
    rocket,
    glow: glow as THREE.Sprite & { material: THREE.SpriteMaterial },
    dispose() {
      [white, blue, dark, metal, glowMat, body, nose, nozzle, window_, fin].forEach((d) =>
        d.dispose(),
      );
    },
  };
}
