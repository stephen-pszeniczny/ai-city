// The robot: one original character, a rounded capsule tinted all over in its
// building's colour, with a wide glowing visor and a short antenna whose tip
// blinks. Not based on any brand, film or game.
//
// It sits on a swivel chair facing +z (its desk). What it does comes from its
// RobotBrain (random actions, never the same twice in a row): typing, mouse
// and tab switching, reading, sipping water, looking around, playing with its
// desk gadget, stretching, spinning on the chair and waving.
// Units: the desk top is at y = 0.75; the keyboard is about 0.6 in front.
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";

import { LOOK, motionScale } from "../belt/look";
import { RobotBrain } from "./robotBrain";

export type RobotDetail = "near" | "far";
type ArmParts = { upper: THREE.Mesh | null; lower: THREE.Mesh | null; hand: THREE.Mesh | null };

/** One brain per robot, seeded from a name so each robot works out of step with the others. */
export function useRobotBrain(seedText: string): RobotBrain {
  return useMemo(() => {
    let h = 2166136261;
    for (const ch of seedText) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
    return new RobotBrain(h >>> 0, {
      funShare: LOOK.robot.funActions,
      busyness: LOOK.robot.busyness,
    });
  }, [seedText]);
}

/** Robot-local layout, shared with the desk so hands land on the keys. */
export const ROBOT = {
  seatY: 0.5,
  /** Centre of the keyboard, robot-local. */
  keys: new THREE.Vector3(0, 0.78, 0.6),
  /** The mouse, to the right of the keyboard. */
  mouse: new THREE.Vector3(0.42, 0.77, 0.6),
  /** Where the robot's water glass stands on the desk. */
  glass: new THREE.Vector3(0.62, 0.75, 0.48),
  /** The desk gadget (front left of the desk). */
  gadget: new THREE.Vector3(-0.6, 0.85, 0.66),
} as const;

const BODY_R = 0.26;
const BODY_LOW = 0.76; // centre of the bottom of the capsule
const HEAD_Y = 1.06; // centre of the top of the capsule (the head)
const SHOULDER = new THREE.Vector3(0.3, 0.97, 0.04);
const UPPER = 0.27; // upper-arm length
const LOWER = 0.27; // forearm length

const ease = (x: number) => x * x * (3 - 2 * x);
/** 0 → 1 between a and b, eased; holds 1 after. */
const ramp = (p: number, a: number, b: number) =>
  ease(THREE.MathUtils.clamp((p - a) / (b - a), 0, 1));
/** Up over [a, a + w], hold, down over [b - w, b]: a smooth "in, hold, out" envelope. */
const window01 = (p: number, a: number, b: number, w = 0.18) =>
  Math.min(ramp(p, a, a + w), 1 - ramp(p, b - w, b));

/** Cheap two-bone arm: elbow bends outward and down so the arm keeps its length. */
function placeArm(
  shoulder: THREE.Vector3,
  hand: THREE.Vector3,
  side: number,
  upper: THREE.Object3D,
  lower: THREE.Object3D,
  handObj: THREE.Object3D,
  tmp: { elbow: THREE.Vector3; dir: THREE.Vector3; bend: THREE.Vector3 },
) {
  const { elbow, dir, bend } = tmp;
  dir.subVectors(hand, shoulder);
  const reach = Math.min(dir.length(), UPPER + LOWER - 0.001);
  dir.setLength(reach);
  hand.copy(shoulder).add(dir);
  const sag = Math.sqrt(Math.max(0, UPPER * UPPER - (reach / 2) * (reach / 2)));
  bend.set(side * 0.6, -0.8, 0).normalize();
  bend.addScaledVector(dir, -bend.dot(dir) / dir.lengthSq()).normalize(); // perpendicular to the arm
  elbow.copy(shoulder).addScaledVector(dir, 0.5).addScaledVector(bend, sag);
  orient(upper, shoulder, elbow);
  orient(lower, elbow, hand);
  handObj.position.copy(hand);
}

const UP = new THREE.Vector3(0, 1, 0);
const tmpV = new THREE.Vector3();
/** Point a unit-length (along y) capsule from a to b. */
function orient(o: THREE.Object3D, a: THREE.Vector3, b: THREE.Vector3) {
  tmpV.subVectors(b, a);
  const len = tmpV.length();
  o.position.copy(a).addScaledVector(tmpV, 0.5);
  o.quaternion.setFromUnitVectors(UP, tmpV.normalize());
  o.scale.set(1, len, 1);
}

export function Robot({
  tint,
  brain,
  detail = "near",
}: {
  tint: string;
  brain: RobotBrain;
  detail?: RobotDetail;
}) {
  const reducedMotion = useMemo(() => matchMedia("(prefers-reduced-motion: reduce)").matches, []);
  const swivel = useRef<THREE.Group>(null);
  const body = useRef<THREE.Group>(null);
  const head = useRef<THREE.Group>(null);
  const arms = useRef<[ArmParts, ArmParts]>([
    { upper: null, lower: null, hand: null },
    { upper: null, lower: null, hand: null },
  ]);
  const glass = useRef<THREE.Group>(null);
  const tmp = useMemo(
    () => ({
      elbow: new THREE.Vector3(),
      dir: new THREE.Vector3(),
      bend: new THREE.Vector3(),
      hands: [new THREE.Vector3(), new THREE.Vector3()] as [THREE.Vector3, THREE.Vector3],
      shoulders: [SHOULDER.clone().setX(-SHOULDER.x), SHOULDER.clone()] as [
        THREE.Vector3,
        THREE.Vector3,
      ],
      glassAt: new THREE.Vector3(),
      mouth: new THREE.Vector3(0.12, HEAD_Y - 0.02, 0.3),
    }),
    [],
  );

  const mats = useMemo(() => {
    const t = new THREE.Color(tint);
    const hsl = { h: 0, s: 0, l: 0 };
    t.getHSL(hsl);
    const glow = LOOK.robot.glowStrength;
    return {
      shell: new THREE.MeshPhysicalMaterial({
        color: t.clone(),
        roughness: 0.32,
        metalness: 0.1,
        clearcoat: 0.6,
        clearcoatRoughness: 0.25,
      }),
      dark: new THREE.MeshStandardMaterial({
        color: new THREE.Color().setHSL(hsl.h, hsl.s * 0.7, hsl.l * 0.32),
        roughness: 0.45,
        metalness: 0.5,
      }),
      visor: new THREE.MeshStandardMaterial({
        color: 0x05070c,
        roughness: 0.08,
        metalness: 0.6,
        emissive: t.clone(),
        emissiveIntensity: 1.6 * glow,
        side: THREE.DoubleSide,
      }),
      scan: new THREE.MeshBasicMaterial({
        color: new THREE.Color(tint).lerp(new THREE.Color(0xffffff), 0.55).multiplyScalar(1 + glow),
        toneMapped: false,
      }),
      tip: new THREE.MeshBasicMaterial({ color: t.clone(), toneMapped: false }),
      chair: new THREE.MeshStandardMaterial({ color: 0x252a34, roughness: 0.5, metalness: 0.7 }),
      cushion: new THREE.MeshStandardMaterial({
        color: new THREE.Color().setHSL(hsl.h, hsl.s * 0.5, 0.16),
        roughness: 0.85,
      }),
      glass: new THREE.MeshPhysicalMaterial({
        color: 0xdfefff,
        roughness: 0.05,
        transmission: 0.9,
        thickness: 0.02,
        transparent: true,
        opacity: 0.55,
      }),
      water: new THREE.MeshStandardMaterial({
        color: 0x8fd3ff,
        transparent: true,
        opacity: 0.5,
        roughness: 0.1,
      }),
    };
  }, [tint]);
  useEffect(() => () => Object.values(mats).forEach((m) => m.dispose()), [mats]);

  const geo = useMemo(
    () => ({
      limbUnit: new THREE.CylinderGeometry(0.048, 0.048, 1, 10),
    }),
    [],
  );
  useEffect(() => () => Object.values(geo).forEach((g) => g.dispose()), [geo]);

  const near = detail === "near";

  useFrame((state) => {
    const speed = motionScale(reducedMotion);
    const t = state.clock.elapsedTime;
    const s = brain.update(t * speed);
    const p = s.progress;
    const tt = t * speed;

    // Swivel: spinning, turning to wave at the camera (behind, to the right),
    // and turning a little toward the gadget.
    let yaw = 0;
    if (s.action === "spin") yaw = ease(p) * Math.PI * 2;
    else if (s.action === "wave") yaw = window01(p, 0, 1, 0.22) * 2.3;
    else if (s.action === "gadget") yaw = window01(p, 0, 1, 0.25) * 0.55;
    if (swivel.current) swivel.current.rotation.y = yaw;

    // Body: gentle bob always; leans back to stretch, forward to read.
    const bob = Math.sin(tt * 1.7) * 0.012 * LOOK.robot.bob;
    let lean = 0.06;
    if (s.action === "stretch") lean = -0.22 * window01(p, 0, 1, 0.3);
    if (s.action === "read") lean = 0.14 * window01(p, 0, 1, 0.25);
    if (body.current) {
      body.current.position.y = bob;
      body.current.rotation.x = lean;
    }

    // Head: nods while reading, glances while typing, looks around, tilts while waving.
    if (head.current) {
      let pitch = 0.1;
      let yawH = 0;
      let roll = Math.sin(tt * 0.5) * 0.03;
      if (s.action === "type") pitch = 0.18 + Math.max(0, Math.sin(tt * 0.9)) * 0.08;
      if (s.action === "read") pitch = 0.05 + Math.sin(tt * 3.2) * 0.04;
      if (s.action === "lookAround") yawH = Math.sin(p * Math.PI * 2) * 0.7;
      if (s.action === "wave") roll = Math.sin(tt * 4) * 0.12;
      if (s.action === "gadget") yawH = 0.5 * window01(p, 0, 1);
      if (s.action === "switchTab") yawH = 0.12;
      head.current.rotation.set(pitch, yawH, roll);
    }

    // Visor: blink (dims) briefly every few seconds; antenna tip blinks.
    const blink = (tt + brain.seedOffset) % 4.3 < 0.12;
    mats.visor.emissiveIntensity = (blink ? 0.25 : 1.6) * LOOK.robot.glowStrength;
    const tipOn = (tt + brain.seedOffset) % 1.4 < 0.18;
    mats.tip.color.set(tint).multiplyScalar(tipOn ? 2.4 : 0.35);

    if (!near) return;

    // Hands. Default: resting near the keyboard.
    const [L, R] = tmp.hands;
    const k = ROBOT.keys;
    L.set(k.x - 0.17, k.y + 0.02, k.z - 0.05);
    R.set(k.x + 0.17, k.y + 0.02, k.z - 0.05);
    let glassLift = 0;
    switch (s.action) {
      case "type": {
        // Alternating taps in bursts.
        const tap = Math.sin(tt * 18);
        L.y += Math.max(0, tap) * 0.03;
        R.y += Math.max(0, -tap) * 0.03;
        L.x += Math.sin(tt * 2.3) * 0.04;
        R.x += Math.sin(tt * 2.9 + 1) * 0.04;
        break;
      }
      case "switchTab": {
        // Right hand to the mouse, two clicks; left hand presses a shortcut.
        const m = ramp(p, 0, 0.3) - ramp(p, 0.8, 1);
        R.lerp(ROBOT.mouse, m);
        R.y += (p > 0.4 && p < 0.47) || (p > 0.55 && p < 0.62) ? -0.015 : 0;
        L.y += window01(p, 0.3, 0.6) * 0.02;
        break;
      }
      case "read":
        L.set(-0.28, 0.82, 0.42);
        R.set(0.18, 0.86, 0.5);
        break;
      case "sip": {
        // Reach for the glass, lift it to the visor, put it back.
        const reach = window01(p, 0, 1, 0.2);
        glassLift = window01(p, 0.2, 0.8, 0.2);
        tmp.glassAt.copy(ROBOT.glass).setY(ROBOT.glass.y + 0.08);
        tmp.glassAt.lerp(tmp.mouth, glassLift);
        R.lerp(tmp.glassAt, reach);
        break;
      }
      case "stretch": {
        const up = window01(p, 0, 1, 0.3);
        L.lerp(tmp.shoulders[0].clone().add(new THREE.Vector3(-0.12, 0.5, -0.05)), up);
        R.lerp(tmp.shoulders[1].clone().add(new THREE.Vector3(0.12, 0.5, -0.05)), up);
        break;
      }
      case "wave": {
        // Left hand up, waving side to side.
        const up = window01(p, 0.1, 0.95, 0.2);
        const wag = Math.sin(tt * 9) * 0.12;
        L.lerp(new THREE.Vector3(-0.42 + wag, 1.42, 0.2), up);
        break;
      }
      case "gadget": {
        // Left hand reaches over to the gadget and taps it.
        const reach = window01(p, 0.1, 0.9, 0.2);
        const g = ROBOT.gadget.clone();
        g.y += Math.max(0, Math.sin(tt * 7)) * 0.03 * reach;
        L.lerp(g, reach);
        break;
      }
      case "lookAround":
        break;
    }
    ([0, 1] as const).forEach((i) => {
      const arm = arms.current[i];
      if (!arm.upper || !arm.lower || !arm.hand) return;
      placeArm(
        tmp.shoulders[i],
        tmp.hands[i],
        i === 0 ? -1 : 1,
        arm.upper,
        arm.lower,
        arm.hand,
        tmp,
      );
    });
    // The glass rides in the right hand while sipping, otherwise stands on the desk.
    if (glass.current) {
      if (glassLift > 0.001)
        glass.current.position.copy(tmp.hands[1]).add(new THREE.Vector3(0, -0.04, 0.03));
      else glass.current.position.copy(ROBOT.glass);
    }
  });

  return (
    <group>
      <group ref={swivel}>
        {/* Swivel chair: five-spoke base, post, cushioned seat and a low back. */}
        <mesh position={[0, 0.06, 0]} material={mats.chair}>
          <cylinderGeometry args={[0.04, 0.04, 0.12, 8]} />
        </mesh>
        {near &&
          [0, 1, 2, 3, 4].map((i) => {
            const a = (i / 5) * Math.PI * 2;
            return (
              <group key={i} rotation={[0, a, 0]}>
                <mesh
                  position={[0.13, 0.04, 0]}
                  rotation={[0, 0, Math.PI / 2]}
                  material={mats.chair}
                >
                  <cylinderGeometry args={[0.018, 0.022, 0.26, 6]} />
                </mesh>
                <mesh position={[0.26, 0.025, 0]} material={mats.dark}>
                  <sphereGeometry args={[0.026, 8, 6]} />
                </mesh>
              </group>
            );
          })}
        <mesh position={[0, 0.27, 0]} material={mats.chair}>
          <cylinderGeometry args={[0.03, 0.03, 0.36, 8]} />
        </mesh>
        <mesh position={[0, ROBOT.seatY - 0.03, 0]} material={mats.cushion} castShadow>
          <cylinderGeometry args={[0.3, 0.28, 0.07, 28]} />
        </mesh>
        {near && (
          <group position={[0, 0, -0.27]}>
            <mesh position={[0, 0.66, 0]} material={mats.cushion} castShadow>
              <boxGeometry args={[0.46, 0.22, 0.05]} />
            </mesh>
            {[-1, 1].map((s) => (
              <mesh key={s} position={[s * 0.19, 0.55, 0.02]} material={mats.chair}>
                <boxGeometry args={[0.03, 0.14, 0.03]} />
              </mesh>
            ))}
          </group>
        )}

        <group ref={body}>
          {/* The capsule: rounded bottom, straight sides; the head is its top. */}
          <mesh position={[0, BODY_LOW, 0]} material={mats.shell} castShadow>
            <sphereGeometry args={[BODY_R, 32, 16, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2]} />
          </mesh>
          <mesh position={[0, (BODY_LOW + HEAD_Y) / 2, 0]} material={mats.shell} castShadow>
            <cylinderGeometry args={[BODY_R, BODY_R, HEAD_Y - BODY_LOW, 32, 1, true]} />
          </mesh>
          {/* Belt line and a back panel with vents and a status light. */}
          <mesh position={[0, 0.86, 0]} material={mats.dark}>
            <torusGeometry args={[BODY_R + 0.002, 0.012, 6, 40]} />
          </mesh>
          {near && (
            <group position={[0, 0.92, -BODY_R]}>
              <mesh material={mats.dark} position={[0, 0, 0.01]}>
                <boxGeometry args={[0.2, 0.18, 0.03]} />
              </mesh>
              {[-0.05, 0, 0.05].map((y) => (
                <mesh key={y} position={[0, y, -0.008]} material={mats.chair}>
                  <boxGeometry args={[0.15, 0.014, 0.012]} />
                </mesh>
              ))}
              <mesh position={[0.07, 0.07, -0.01]} material={mats.tip}>
                <sphereGeometry args={[0.014, 8, 6]} />
              </mesh>
            </group>
          )}
          {/* Stubby legs under the desk. */}
          {near &&
            [-1, 1].map((s) => (
              <group key={s}>
                <mesh
                  position={[s * 0.12, ROBOT.seatY + 0.02, 0.2]}
                  rotation={[Math.PI / 2, 0, 0]}
                  material={mats.shell}
                  castShadow
                >
                  <capsuleGeometry args={[0.07, 0.2, 4, 10]} />
                </mesh>
                <mesh position={[s * 0.12, 0.3, 0.36]} material={mats.shell}>
                  <capsuleGeometry args={[0.06, 0.26, 4, 10]} />
                </mesh>
                <mesh position={[s * 0.12, 0.06, 0.4]} material={mats.dark}>
                  <boxGeometry args={[0.13, 0.08, 0.2]} />
                </mesh>
              </group>
            ))}
          {/* Shoulder joints. */}
          {near &&
            [-1, 1].map((s) => (
              <mesh
                key={s}
                position={[s * SHOULDER.x, SHOULDER.y, SHOULDER.z]}
                material={mats.dark}
              >
                <sphereGeometry args={[0.065, 14, 10]} />
              </mesh>
            ))}

          {/* Head: the top of the capsule, with the wide visor and antenna. */}
          <group ref={head} position={[0, HEAD_Y, 0]}>
            <mesh material={mats.shell} castShadow>
              <sphereGeometry args={[BODY_R - 0.004, 32, 24]} />
            </mesh>
            {/* The visor wraps most of the way round, so its glow shows from behind too. */}
            <mesh position={[0, 0.02, 0]} material={mats.visor}>
              <cylinderGeometry
                args={[BODY_R + 0.008, BODY_R + 0.008, 0.13, 40, 1, true, -1.75, 3.5]}
              />
            </mesh>
            {near && (
              <mesh position={[0, 0.02, 0]} material={mats.scan}>
                <cylinderGeometry
                  args={[BODY_R + 0.011, BODY_R + 0.011, 0.012, 40, 1, true, -1.1, 2.2]}
                />
              </mesh>
            )}
            {/* Antenna: a short stalk and the blinking tip. */}
            <mesh
              position={[0.06, BODY_R + 0.06, -0.03]}
              rotation={[0, 0, -0.15]}
              material={mats.dark}
            >
              <cylinderGeometry args={[0.011, 0.014, 0.14, 6]} />
            </mesh>
            <mesh position={[0.072, BODY_R + 0.14, -0.03]} material={mats.tip}>
              <sphereGeometry args={[0.03, 12, 10]} />
            </mesh>
            {near && (
              <mesh position={[0.06, BODY_R - 0.005, -0.03]} material={mats.dark}>
                <cylinderGeometry args={[0.04, 0.05, 0.03, 12]} />
              </mesh>
            )}
          </group>
        </group>

        {/* Arms: two segments and a mitten hand each, placed every frame. */}
        {near &&
          ([0, 1] as const).map((i) => (
            <group key={i}>
              <mesh
                ref={(m) => void (arms.current[i].upper = m)}
                geometry={geo.limbUnit}
                material={mats.shell}
                castShadow
              />
              <mesh
                ref={(m) => void (arms.current[i].lower = m)}
                geometry={geo.limbUnit}
                material={mats.shell}
                castShadow
              />
              <mesh
                ref={(m) => void (arms.current[i].hand = m)}
                material={mats.dark}
                scale={[1.1, 0.8, 1.25]}
              >
                <sphereGeometry args={[0.058, 12, 10]} />
              </mesh>
            </group>
          ))}
      </group>

      {/* The robot's water glass (outside the swivel so it stays on the desk). */}
      {near && (
        <group ref={glass} position={ROBOT.glass}>
          <mesh position={[0, 0.06, 0]} material={mats.glass}>
            <cylinderGeometry args={[0.04, 0.034, 0.12, 16, 1, true]} />
          </mesh>
          <mesh position={[0, 0.04, 0]} material={mats.water}>
            <cylinderGeometry args={[0.036, 0.033, 0.07, 16]} />
          </mesh>
        </group>
      )}
    </group>
  );
}
