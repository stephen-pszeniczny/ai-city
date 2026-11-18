// The notification shuttle: a small white and royal-blue rocket that flies once
// across the belt, towing its banner on a glowing line.
//
// The rocket: lit porthole windows, a cockpit, a blue stripe, an antenna, blinking
// red and green lights on the fin tips, and behind it a flickering engine flame,
// a warm glow and a few sparks.
//
// The banner is page text (sharp at any size), moved each frame so it flies behind
// and a little above the rocket, joined to a hitch on the rocket's back by the tow
// line (drawn by the banner itself, see notifications.css). The flame, glow and
// sparks stay straight behind the nozzle, below the line, so nothing overlaps.
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
/** Where the tow line is fixed: on the rocket's back, just in front of the fins. */
const HITCH = new THREE.Vector3(0, 0.5, -0.35);
/** Banner position relative to the hitch on screen: this far behind, this far above. */
export const TOW_GAP_PX = 96;
export const TOW_LIFT_PX = 28;
/** The tow line runs from the banner's leading edge down to the hitch. */
const TOW_LENGTH_PX = Math.hypot(TOW_GAP_PX, TOW_LIFT_PX);
const TOW_ANGLE_DEG = (Math.atan2(TOW_LIFT_PX, TOW_GAP_PX) * 180) / Math.PI;
const SPARKS = 7;

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
    () => ({
      p: new THREE.Vector3(),
      ahead: new THREE.Vector3(),
      aheadOnScreen: new THREE.Vector3(),
      s: new THREE.Vector3(),
    }),
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
    g.rotateZ(Math.sin(k * Math.PI) * 0.18); // a gentle bank through the turn
    parts.animate(now);

    if (!el) return;
    g.localToWorld(tmp.s.copy(HITCH));
    tmp.s.project(camera);
    if (tmp.s.z >= 1) {
      el.style.opacity = "0";
      return;
    }
    const x = (tmp.s.x * 0.5 + 0.5) * size.width;
    const y = (-tmp.s.y * 0.5 + 0.5) * size.height;
    // Which way it's moving on screen decides which side the banner trails on.
    const goingRight = tmp.aheadOnScreen.copy(tmp.ahead).project(camera).x >= tmp.s.x;
    el.dataset.dir = goingRight ? "right" : "left";
    el.style.setProperty("--tow-length", `${TOW_LENGTH_PX}px`);
    el.style.setProperty("--tow-angle", `${goingRight ? TOW_ANGLE_DEG : -TOW_ANGLE_DEG}deg`);
    const bx = goingRight ? x - TOW_GAP_PX : x + TOW_GAP_PX;
    const pull = goingRight ? "-100%" : "0%"; // the banner's leading edge sits at bx
    el.style.transform = `translate(${bx}px, ${y - TOW_LIFT_PX}px) translate(${pull}, -50%)`;
    el.style.opacity = "1";
  });

  return (
    <group ref={group} scale={flight.scale}>
      <primitive object={parts.rocket} />
    </group>
  );
}

/** The rocket and its effects, built along +z (its nose) so lookAt points it where it's going. */
function rocketParts() {
  const owned: { dispose(): void }[] = [];
  const keep = <T extends { dispose(): void }>(x: T): T => {
    owned.push(x);
    return x;
  };
  const std = (o: THREE.MeshStandardMaterialParameters) => keep(new THREE.MeshStandardMaterial(o));
  const basic = (o: THREE.MeshBasicMaterialParameters) => keep(new THREE.MeshBasicMaterial(o));

  // Matte, with a touch of its own light, so it reads as white against the blue of space.
  const white = std({ color: 0xf4f6fa, roughness: 0.6, metalness: 0.05, emissive: 0x3a3e46 });
  const blue = std({ color: 0x3456e0, roughness: 0.4, metalness: 0.3, emissive: 0x0a1640 });
  const glass = std({ color: 0x0b1a40, roughness: 0.1, metalness: 0.7, emissive: 0x16306e });
  const metal = std({ color: 0x8892a6, roughness: 0.3, metalness: 0.9 });
  const porthole = basic({ color: new THREE.Color(1, 0.93, 0.75).multiplyScalar(1.6) });
  const rim = std({ color: 0x9aa3b2, roughness: 0.3, metalness: 0.9 });
  const red = basic({ color: new THREE.Color(1, 0.15, 0.1).multiplyScalar(3) });
  const green = basic({ color: new THREE.Color(0.1, 1, 0.35).multiplyScalar(3) });
  const strobe = basic({ color: new THREE.Color(3, 3, 3) });
  const additive = (c: THREE.Color, opacity: number) =>
    basic({
      color: c,
      transparent: true,
      opacity,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
  const flameOuter = additive(new THREE.Color(1, 0.45, 0.12).multiplyScalar(1.6), 0.75);
  const flameCore = additive(new THREE.Color(1, 0.9, 0.6).multiplyScalar(2), 0.9);

  const body = keep(new THREE.CylinderGeometry(0.42, 0.48, 2.2, 24));
  const nose = keep(new THREE.ConeGeometry(0.42, 0.9, 24));
  const nozzle = keep(new THREE.CylinderGeometry(0.3, 0.42, 0.35, 18));
  const cockpit = keep(new THREE.SphereGeometry(0.2, 16, 10));
  const fin = keep(new THREE.BoxGeometry(0.06, 0.55, 0.6));
  const stripe = keep(new THREE.CylinderGeometry(0.445, 0.445, 0.14, 24));
  const port = keep(new THREE.CylinderGeometry(0.085, 0.085, 0.04, 14));
  const portRim = keep(new THREE.TorusGeometry(0.095, 0.022, 6, 16));
  const mast = keep(new THREE.CylinderGeometry(0.015, 0.015, 0.4, 6));
  const bead = keep(new THREE.SphereGeometry(0.05, 8, 6));
  const flame = keep(new THREE.ConeGeometry(0.3, 1.3, 18, 1, true));
  const core = keep(new THREE.ConeGeometry(0.15, 0.8, 14, 1, true));

  const rocket = new THREE.Group();
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, f: (m: THREE.Mesh) => void) => {
    const m = new THREE.Mesh(geo, mat);
    f(m);
    rocket.add(m);
    return m;
  };
  /** The body's radius at z (it tapers from 0.48 at the back to 0.42 at the front). */
  const radiusAt = (z: number) => 0.45 - 0.03 * (z / 1.1);

  // Cylinders stand along y; turning them by +90° about x lays them along z.
  add(body, white, (m) => (m.rotation.x = Math.PI / 2));
  add(nose, blue, (m) => {
    m.rotation.x = Math.PI / 2;
    m.position.z = 1.55;
  });
  add(nozzle, metal, (m) => {
    m.rotation.x = Math.PI / 2;
    m.position.z = -1.27;
  });
  add(stripe, blue, (m) => {
    m.rotation.x = Math.PI / 2;
    m.position.z = 0.85;
  });
  add(cockpit, glass, (m) => {
    m.position.set(0, 0.34, 0.6);
    m.scale.set(1, 0.65, 1.4);
  });
  // Three lit portholes down each side, each in a metal ring.
  for (const side of [-1, 1]) {
    for (const z of [0.35, -0.05, -0.45]) {
      const r = radiusAt(z) + 0.005;
      add(port, porthole, (m) => {
        m.rotation.z = Math.PI / 2;
        m.position.set(side * r, 0.05, z);
      });
      add(portRim, rim, (m) => {
        m.rotation.y = Math.PI / 2;
        m.position.set(side * (r + 0.01), 0.05, z);
      });
    }
  }
  // Antenna with a red bead on top.
  add(mast, metal, (m) => m.position.set(0, 0.62, 0.15));
  add(bead, red, (m) => m.position.set(0, 0.83, 0.15));

  // Three fins: one below, two above (left and right), with lights on their tips.
  const tips: THREE.Vector3[] = [];
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + Math.PI;
    add(fin, blue, (m) => {
      m.position.set(Math.sin(a) * 0.62, Math.cos(a) * 0.62, -0.75);
      m.rotation.z = -a;
    });
    tips.push(new THREE.Vector3(Math.sin(a) * 0.9, Math.cos(a) * 0.9, -0.75));
  }
  const [lowTip, minusXTip, plusXTip] = tips as [THREE.Vector3, THREE.Vector3, THREE.Vector3];
  // Facing +z with +y up, the rocket's left is +x: red on the left, green on the right, as on aircraft.
  const portLight = add(bead, red, (m) => m.position.copy(plusXTip));
  const starboardLight = add(bead, green, (m) => m.position.copy(minusXTip));
  const strobeLight = add(bead, strobe, (m) => m.position.copy(lowTip));

  // Engine: an open cone of flame pointing backwards, a brighter core inside it.
  const flameMesh = add(flame, flameOuter, (m) => {
    m.rotation.x = -Math.PI / 2; // the cone's tip points back (-z)
    m.position.z = -1.45 - 0.65;
  });
  const coreMesh = add(core, flameCore, (m) => {
    m.rotation.x = -Math.PI / 2;
    m.position.z = -1.45 - 0.4;
  });

  // A warm glow round the nozzle, and a few sparks drifting back from it.
  const sprite = (c: THREE.Color) =>
    keep(
      new THREE.SpriteMaterial({
        map: softGlow(),
        color: c,
        blending: THREE.AdditiveBlending,
        transparent: true,
        depthWrite: false,
      }),
    );
  const glowMat = sprite(new THREE.Color(1, 0.5, 0.16).multiplyScalar(1.9));
  const glow = new THREE.Sprite(glowMat);
  glow.position.set(0, -0.15, -2.0);
  glow.scale.set(3.4, 1.4, 1);
  rocket.add(glow);
  const sparkMat = sprite(new THREE.Color(1, 0.75, 0.4).multiplyScalar(2));
  const sparks = Array.from({ length: SPARKS }, (_, i) => {
    const s = new THREE.Sprite(sparkMat.clone());
    owned.push(s.material);
    s.userData = { phase: i / SPARKS, drift: (((i * 37) % 11) / 11 - 0.5) * 0.5 };
    rocket.add(s);
    return s;
  });

  return {
    rocket,
    /** Flicker, blink and drift: called every frame with the time in seconds. */
    animate(t: number) {
      const strength = LOOK.notifications.glowStrength;
      const flick = 0.85 + 0.15 * Math.sin(t * 31) * Math.sin(t * 17);
      flameMesh.scale.set(1, 0.85 + 0.25 * flick, 1);
      coreMesh.scale.set(1, 0.8 + 0.3 * flick, 1);
      flameOuter.opacity = 0.75 * strength * flick;
      flameCore.opacity = 0.9 * strength;
      glowMat.opacity = strength * (0.8 + 0.2 * flick);
      // Navigation lights: steady-ish blink; the strobe gives a quick double flash.
      const blink = (t % 1.2) / 1.2;
      portLight.visible = starboardLight.visible = blink < 0.6;
      const s = (t % 1.6) / 1.6;
      strobeLight.visible = s < 0.05 || (s > 0.12 && s < 0.17);
      for (const spark of sparks) {
        const { phase, drift } = spark.userData as { phase: number; drift: number };
        const life = (t * 1.4 + phase) % 1; // 0 born at the nozzle … 1 gone
        spark.position.set(drift * life, -0.1 + drift * 0.4 * life, -1.7 - life * 2.6);
        spark.scale.setScalar(0.28 * (1 - life) + 0.05);
        (spark.material as THREE.SpriteMaterial).opacity = strength * (1 - life) * 0.9;
      }
    },
    dispose() {
      owned.forEach((d) => d.dispose());
    },
  };
}
