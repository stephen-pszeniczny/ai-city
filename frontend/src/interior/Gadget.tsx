// One signature gadget per desk, so each building stands apart:
//   Opportunity Office  radar scope with a sweeping line and pinging dots
//   Flight School       toy rocket that launches, loops round the asteroid and lands
//   Post Office         little mail drone dropping envelopes into an inbox tray
//   Crew Quarters       glowing photo frame and a flower that opens and closes
//   Shipyard            tiny robot arm building a model ship
//   Training Bay        mini dumbbell rack
//   Data Core           glowing data crystals orbiting a stack of books
//   Mission Control     desk globe and a mission clock
//   The Vault           stack of gold coins and a mini safe
// Robot-space coordinates (robot at the origin facing +z, desk top at 0.75).
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";

import { shouldAnimate } from "../belt/hold";
import { useHold } from "../belt/HoldContext";

import type { BuildingId } from "../api";
import { LOOK } from "../belt/look";
import type { Detail } from "../belt/lod";
import { ROBOT } from "./Robot";

const TOP = 0.75;
const ease = (x: number) => x * x * (3 - 2 * x);
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

type Props = {
  id: BuildingId;
  tint: string;
  detail: Detail;
  reducedMotion: boolean;
  /** Robot-space centre of the asteroid's deck and the loop radius (Flight School's rocket). */
  orbit?: { centre: THREE.Vector3; radius: number };
};

function useMats(tint: string) {
  const mats = useMemo(() => {
    const t = new THREE.Color(tint);
    const std = (o: THREE.MeshStandardMaterialParameters) => new THREE.MeshStandardMaterial(o);
    return {
      tint: std({ color: t, roughness: 0.4, metalness: 0.3 }),
      glow: new THREE.MeshBasicMaterial({
        color: t.clone().multiplyScalar(1.8),
        toneMapped: false,
      }),
      white: std({ color: 0xf2f4f8, roughness: 0.35, metalness: 0.1 }),
      dark: std({ color: 0x1e222b, roughness: 0.45, metalness: 0.6 }),
      metal: std({ color: 0xa7afbd, roughness: 0.25, metalness: 0.95 }),
      gold: std({ color: 0xd9a63e, roughness: 0.25, metalness: 1 }),
      red: std({ color: 0xff4d4d, roughness: 0.4 }),
      green: new THREE.MeshBasicMaterial({
        color: new THREE.Color(0x50ff9a).multiplyScalar(1.5),
        toneMapped: false,
      }),
      flame: new THREE.MeshBasicMaterial({
        color: new THREE.Color(0xffa040).multiplyScalar(2.2),
        transparent: true,
        opacity: 0.9,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      }),
      paper: std({ color: 0xf7f1e3, roughness: 0.9 }),
      book: [0x8a3b3b, 0x2f5d8a, 0x3e7a4f, 0x7a5a2f].map((c) => std({ color: c, roughness: 0.8 })),
      ocean: std({ color: 0x2a5fb8, roughness: 0.5 }),
      land: std({ color: 0x4f9b5a, roughness: 0.8 }),
      petal: std({
        color: t.clone().lerp(new THREE.Color(0xffffff), 0.3),
        roughness: 0.6,
        side: THREE.DoubleSide,
      }),
      stem: std({ color: 0x3f9b4a, roughness: 0.7 }),
      screen: new THREE.MeshBasicMaterial({ color: new THREE.Color(0x0a2a1a), toneMapped: false }),
      frameGlow: new THREE.MeshBasicMaterial({ color: t.clone(), toneMapped: false }),
    };
  }, [tint]);
  useEffect(
    () => () =>
      Object.values(mats).forEach((m) =>
        Array.isArray(m) ? m.forEach((x) => x.dispose()) : m.dispose(),
      ),
    [mats],
  );
  return mats;
}

export function Gadget(props: Props) {
  if (!LOOK.gadgets.enabled) return null;
  const g = ROBOT.gadget;
  return (
    <group position={[g.x, TOP, g.z]}>
      <GadgetBody {...props} />
    </group>
  );
}

function GadgetBody({ id, tint, detail, reducedMotion, orbit }: Props) {
  const mats = useMats(tint);
  const a = useRef<THREE.Group>(null);
  const b = useRef<THREE.Group>(null);
  const c = useRef<THREE.Group>(null);
  const near = detail === "near";
  const speed = LOOK.gadgets.speed * (reducedMotion ? 0.3 : 1);
  const tmp = useMemo(
    () => ({ p: new THREE.Vector3(), q: new THREE.Vector3(), up: new THREE.Vector3(0, 1, 0) }),
    [],
  );

  const hold = useHold();
  useFrame((state) => {
    if (!shouldAnimate({ hold, inView: true, keepMoving: false })) return;
    const t = state.clock.elapsedTime * speed;
    switch (id) {
      case "jobs":
        if (a.current) a.current.rotation.y = -t * 2.2; // sweep
        if (b.current)
          b.current.children.forEach((d, i) => (d.visible = Math.sin(t * 2.2 + i * 2.1) > 0.6));
        break;
      case "career":
        flyRocket(t, reducedMotion, orbit, a.current, b.current, tmp);
        break;
      case "mail": {
        // The drone hovers out, comes back to the tray and drops an envelope.
        const cycle = (t % 12) / 12;
        const away = Math.sin(cycle * Math.PI * 2);
        if (a.current) {
          a.current.position.set(
            away * 0.25,
            0.32 + Math.sin(t * 3) * 0.02 + Math.max(0, away) * 0.1,
            -Math.abs(away) * 0.1,
          );
          a.current.rotation.z = Math.cos(cycle * Math.PI * 2) * 0.2;
          a.current.children.forEach((r) => {
            if (r.name === "rotor") r.rotation.y = t * 40;
          });
        }
        if (b.current) {
          const drop =
            cycle > 0.45 && cycle < 0.6 ? ease((cycle - 0.45) / 0.15) : cycle >= 0.6 ? 1 : 0;
          b.current.position.y = 0.26 - drop * 0.21;
          b.current.visible = cycle > 0.3;
        }
        break;
      }
      case "relationships":
        if (a.current) {
          const mat = (a.current.children[0] as THREE.Mesh | undefined)?.material as
            THREE.MeshBasicMaterial | undefined;
          mat?.color.setHSL((t * 0.03) % 1, 0.6, 0.55);
        }
        if (b.current) {
          const open = 0.4 + 0.6 * (0.5 + 0.5 * Math.sin(t * 0.5));
          b.current.children.forEach((p) => (p.rotation.x = -0.3 - open * 0.9));
        }
        break;
      case "projects":
        if (a.current) a.current.rotation.y = Math.sin(t * 0.8) * 0.9;
        if (b.current) b.current.rotation.z = -0.6 + Math.sin(t * 1.6) * 0.35;
        if (c.current) c.current.rotation.z = 0.9 + Math.sin(t * 1.6 + 1) * 0.4;
        break;
      case "library":
        if (a.current) {
          a.current.rotation.y = t * 0.8;
          a.current.children.forEach((k, i) => {
            k.position.y = 0.05 * Math.sin(t * 2 + i * 2);
            k.rotation.y = t * 2;
          });
        }
        break;
      case "planner":
        if (a.current) a.current.rotation.y = t * 0.4;
        if (b.current)
          b.current.children.forEach((s, i) => (s.visible = Math.floor(t * 2 + i) % 3 !== 0));
        break;
      case "finance":
        if (a.current) a.current.rotation.z = Math.sin(t * 0.7) * 2;
        break;
      case "gym":
        break;
    }
  });

  switch (id) {
    case "jobs":
      return (
        <group>
          <mesh position={[0, 0.04, 0]} material={mats.dark} castShadow>
            <cylinderGeometry args={[0.1, 0.11, 0.08, 24]} />
          </mesh>
          <group position={[0, 0.12, 0]} rotation={[-0.9, 0, 0]}>
            <mesh material={mats.dark}>
              <cylinderGeometry args={[0.11, 0.11, 0.03, 32]} />
            </mesh>
            <mesh position={[0, 0.016, 0]} material={mats.screen}>
              <cylinderGeometry args={[0.095, 0.095, 0.002, 32]} />
            </mesh>
            <group ref={a} position={[0, 0.019, 0]}>
              <mesh position={[0.045, 0, 0]} material={mats.green}>
                <boxGeometry args={[0.09, 0.002, 0.006]} />
              </mesh>
            </group>
            <group ref={b} position={[0, 0.02, 0]}>
              {[
                [0.04, 0.03],
                [-0.05, 0.02],
                [0.01, -0.06],
              ].map(([x = 0, z = 0], i) => (
                <mesh key={i} position={[x, 0, z]} material={mats.green}>
                  <sphereGeometry args={[0.008, 6, 4]} />
                </mesh>
              ))}
            </group>
          </group>
        </group>
      );
    case "career":
      return (
        <group>
          {/* Launch pad. */}
          <mesh position={[0, 0.015, 0]} material={mats.dark} castShadow>
            <cylinderGeometry args={[0.09, 0.1, 0.03, 20]} />
          </mesh>
          {near && (
            <mesh position={[0.07, 0.12, 0]} material={mats.metal}>
              <boxGeometry args={[0.012, 0.2, 0.012]} />
            </mesh>
          )}
          <group ref={a} position={[0, 0.03, 0]}>
            <Rocket mats={mats} />
            <group ref={b} position={[0, -0.01, 0]}>
              <mesh position={[0, -0.05, 0]} rotation={[Math.PI, 0, 0]} material={mats.flame}>
                <coneGeometry args={[0.022, 0.1, 10, 1, true]} />
              </mesh>
            </group>
          </group>
        </group>
      );
    case "mail":
      return (
        <group>
          {/* Inbox tray. */}
          <mesh position={[0, 0.02, 0]} material={mats.metal} castShadow>
            <boxGeometry args={[0.22, 0.04, 0.16]} />
          </mesh>
          <mesh position={[0, 0.042, 0]} material={mats.paper}>
            <boxGeometry args={[0.18, 0.006, 0.12]} />
          </mesh>
          <group ref={b} position={[0, 0.26, 0]}>
            <mesh material={mats.paper}>
              <boxGeometry args={[0.1, 0.006, 0.07]} />
            </mesh>
            <mesh position={[0, 0.004, 0]} rotation={[0, Math.PI / 4, 0]} material={mats.tint}>
              <boxGeometry args={[0.03, 0.002, 0.03]} />
            </mesh>
          </group>
          <group ref={a} position={[0, 0.32, 0]}>
            <mesh material={mats.white} castShadow>
              <boxGeometry args={[0.07, 0.03, 0.07]} />
            </mesh>
            <mesh position={[0, -0.005, 0.036]} material={mats.glow}>
              <boxGeometry args={[0.03, 0.008, 0.002]} />
            </mesh>
            {[
              [1, 1],
              [1, -1],
              [-1, 1],
              [-1, -1],
            ].map(([x = 0, z = 0], i) => (
              <group key={i} position={[x * 0.055, 0.015, z * 0.055]}>
                <mesh material={mats.dark}>
                  <cylinderGeometry args={[0.006, 0.006, 0.02, 6]} />
                </mesh>
                <mesh name="rotor" position={[0, 0.012, 0]} material={mats.dark}>
                  <boxGeometry args={[0.06, 0.002, 0.008]} />
                </mesh>
              </group>
            ))}
          </group>
        </group>
      );
    case "relationships":
      return (
        <group>
          {/* Photo frame, angled toward the robot. */}
          <group position={[-0.03, 0, 0.03]} rotation={[0, 0.5, 0]}>
            <mesh
              position={[0, 0.08, 0]}
              rotation={[-0.15, Math.PI, 0]}
              material={mats.white}
              castShadow
            >
              <boxGeometry args={[0.14, 0.16, 0.012]} />
            </mesh>
            <group ref={a} position={[0, 0.08, -0.008]} rotation={[-0.15, Math.PI, 0]}>
              <mesh material={mats.frameGlow}>
                <planeGeometry args={[0.11, 0.13]} />
              </mesh>
            </group>
          </group>
          {/* Flower in a tiny vase. */}
          <group position={[0.12, 0, -0.02]}>
            <mesh position={[0, 0.04, 0]} material={mats.tint}>
              <cylinderGeometry args={[0.025, 0.02, 0.08, 14]} />
            </mesh>
            <mesh position={[0, 0.13, 0]} material={mats.stem}>
              <cylinderGeometry args={[0.004, 0.004, 0.1, 5]} />
            </mesh>
            <group ref={b} position={[0, 0.18, 0]}>
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <group key={i} rotation={[0, (i / 6) * Math.PI * 2, 0]}>
                  <mesh position={[0, 0, 0]} rotation={[-0.8, 0, 0]} material={mats.petal}>
                    <planeGeometry args={[0.025, 0.05]} />
                  </mesh>
                </group>
              ))}
              <mesh material={mats.gold}>
                <sphereGeometry args={[0.012, 8, 6]} />
              </mesh>
            </group>
          </group>
        </group>
      );
    case "projects":
      return (
        <group>
          {/* Model ship hull on a stand. */}
          <mesh position={[0.06, 0.04, 0.02]} material={mats.dark}>
            <boxGeometry args={[0.16, 0.02, 0.06]} />
          </mesh>
          <mesh position={[0.06, 0.07, 0.02]} rotation={[0, 0, Math.PI / 2]} material={mats.white}>
            <capsuleGeometry args={[0.022, 0.1, 4, 10]} />
          </mesh>
          <mesh position={[0.06, 0.09, 0.02]} material={mats.tint}>
            <boxGeometry args={[0.05, 0.02, 0.07]} />
          </mesh>
          {/* Robot arm: base, two links, a little welder tip. */}
          <group position={[-0.08, 0, 0]}>
            <mesh position={[0, 0.02, 0]} material={mats.dark}>
              <cylinderGeometry args={[0.04, 0.045, 0.04, 16]} />
            </mesh>
            <group ref={a} position={[0, 0.04, 0]}>
              <group ref={b}>
                <mesh position={[0, 0.06, 0]} material={mats.tint}>
                  <boxGeometry args={[0.022, 0.12, 0.022]} />
                </mesh>
                <group ref={c} position={[0, 0.12, 0]}>
                  <mesh position={[0, 0.05, 0]} material={mats.tint}>
                    <boxGeometry args={[0.018, 0.1, 0.018]} />
                  </mesh>
                  <mesh position={[0, 0.105, 0]} material={mats.glow}>
                    <sphereGeometry args={[0.01, 8, 6]} />
                  </mesh>
                </group>
              </group>
            </group>
          </group>
        </group>
      );
    case "gym":
      return (
        <group>
          <mesh position={[0, 0.06, 0]} material={mats.dark}>
            <boxGeometry args={[0.2, 0.012, 0.06]} />
          </mesh>
          {[-1, 1].map((s) => (
            <mesh key={s} position={[s * 0.09, 0.03, 0]} material={mats.dark}>
              <boxGeometry args={[0.012, 0.06, 0.05]} />
            </mesh>
          ))}
          {[-0.05, 0, 0.05].map((x, i) => (
            <group key={x} position={[x, 0.08 + i * 0.002, 0]} rotation={[Math.PI / 2, 0, 0]}>
              <mesh material={mats.metal}>
                <cylinderGeometry args={[0.005, 0.005, 0.07, 6]} />
              </mesh>
              {[-1, 1].map((s) => (
                <mesh
                  key={s}
                  position={[0, s * 0.03, 0]}
                  material={i === 1 ? mats.tint : mats.dark}
                >
                  <cylinderGeometry args={[0.014 + i * 0.002, 0.014 + i * 0.002, 0.016, 12]} />
                </mesh>
              ))}
            </group>
          ))}
        </group>
      );
    case "library":
      return (
        <group>
          {mats.book.map((m, i) => (
            <mesh
              key={i}
              position={[0, 0.012 + i * 0.024, 0]}
              rotation={[0, i * 0.25 - 0.3, 0]}
              material={m}
              castShadow
            >
              <boxGeometry args={[0.15 - i * 0.012, 0.022, 0.1]} />
            </mesh>
          ))}
          <group ref={a} position={[0, 0.2, 0]}>
            {[0, 1, 2].map((i) => (
              <mesh
                key={i}
                position={[
                  Math.cos((i / 3) * Math.PI * 2) * 0.08,
                  0,
                  Math.sin((i / 3) * Math.PI * 2) * 0.08,
                ]}
                material={mats.glow}
              >
                <octahedronGeometry args={[0.022, 0]} />
              </mesh>
            ))}
          </group>
        </group>
      );
    case "planner":
      return (
        <group>
          {/* Desk globe. */}
          <mesh position={[0, 0.01, 0]} material={mats.dark}>
            <cylinderGeometry args={[0.05, 0.06, 0.02, 16]} />
          </mesh>
          <mesh position={[0, 0.07, 0]} material={mats.metal}>
            <cylinderGeometry args={[0.006, 0.006, 0.1, 6]} />
          </mesh>
          <group ref={a} position={[0, 0.15, 0]} rotation={[0, 0, 0.4]}>
            <mesh material={mats.ocean}>
              <sphereGeometry args={[0.06, 20, 14]} />
            </mesh>
            {near && (
              <>
                <mesh position={[0.03, 0.02, 0.045]} scale={[1, 0.7, 0.4]} material={mats.land}>
                  <sphereGeometry args={[0.025, 8, 6]} />
                </mesh>
                <mesh position={[-0.04, -0.01, -0.03]} scale={[0.6, 1, 0.5]} material={mats.land}>
                  <sphereGeometry args={[0.03, 8, 6]} />
                </mesh>
              </>
            )}
          </group>
          {/* Mission clock: a little box of blinking segments. */}
          <group position={[0.14, 0, 0.02]} rotation={[0, 0.5, 0]}>
            <mesh position={[0, 0.03, 0]} material={mats.dark}>
              <boxGeometry args={[0.12, 0.06, 0.04]} />
            </mesh>
            <group ref={b} position={[0, 0.03, -0.021]}>
              {[-0.04, -0.02, 0.01, 0.03].map((x) => (
                <mesh key={x} position={[x, 0, 0]} material={mats.glow}>
                  <boxGeometry args={[0.012, 0.025, 0.002]} />
                </mesh>
              ))}
            </group>
          </group>
        </group>
      );
    case "finance":
      return (
        <group>
          {[0, 1, 2].map((s) => (
            <group key={s} position={[-0.06 + s * 0.05, 0, (s % 2) * 0.03]}>
              {Array.from({ length: 3 + s * 2 }, (_, i) => (
                <mesh
                  key={i}
                  position={[(i % 2) * 0.003, 0.006 + i * 0.011, 0]}
                  material={mats.gold}
                >
                  <cylinderGeometry args={[0.02, 0.02, 0.01, 16]} />
                </mesh>
              ))}
            </group>
          ))}
          <group position={[0.12, 0, 0]}>
            <mesh position={[0, 0.06, 0]} material={mats.metal} castShadow>
              <boxGeometry args={[0.12, 0.12, 0.11]} />
            </mesh>
            <group ref={a} position={[0, 0.06, -0.057]} rotation={[0, 0, 0]}>
              <mesh rotation={[Math.PI / 2, 0, 0]} material={mats.dark}>
                <cylinderGeometry args={[0.025, 0.025, 0.01, 16]} />
              </mesh>
              <mesh position={[0, 0.018, -0.006]} material={mats.gold}>
                <boxGeometry args={[0.004, 0.012, 0.004]} />
              </mesh>
            </group>
          </group>
        </group>
      );
  }
}

function Rocket({ mats }: { mats: ReturnType<typeof useMats> }) {
  return (
    <group>
      <mesh position={[0, 0.08, 0]} material={mats.white} castShadow>
        <cylinderGeometry args={[0.022, 0.026, 0.12, 14]} />
      </mesh>
      <mesh position={[0, 0.17, 0]} material={mats.tint}>
        <coneGeometry args={[0.022, 0.06, 14]} />
      </mesh>
      <mesh position={[0, 0.1, 0.022]} material={mats.glow}>
        <sphereGeometry args={[0.008, 8, 6]} />
      </mesh>
      {[0, 1, 2].map((i) => (
        <group key={i} rotation={[0, (i / 3) * Math.PI * 2, 0]}>
          <mesh position={[0.03, 0.035, 0]} material={mats.tint}>
            <boxGeometry args={[0.025, 0.04, 0.004]} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

/** Rocket schedule (s): on the pad, launch, swing out, loop round the asteroid, come back, land. */
const ROCKET = {
  period: 34,
  launch: 3,
  out: 5,
  loop: 6.5,
  back: 16.5,
  descend: 18,
  land: 20.5,
} as const;

function flyRocket(
  t: number,
  reduced: boolean,
  orbit: Props["orbit"],
  rocket: THREE.Group | null,
  flame: THREE.Group | null,
  tmp: { p: THREE.Vector3; q: THREE.Vector3; up: THREE.Vector3 },
) {
  if (!rocket) return;
  const pad = new THREE.Vector3(0, 0.03, 0);
  if (reduced || !orbit) {
    rocket.position.copy(pad);
    rocket.quaternion.identity();
    if (flame) flame.visible = false;
    return;
  }
  // Positions are relative to the pad (the gadget's group).
  const g = ROBOT.gadget;
  const centre = orbit.centre.clone().sub(new THREE.Vector3(g.x, TOP, g.z));
  const height = 2.2;
  const padAngle = Math.atan2(-centre.z, -centre.x);
  const loopPoint = (u: number, out: THREE.Vector3) =>
    out.set(
      centre.x + Math.cos(padAngle + u * Math.PI * 2) * orbit.radius,
      centre.y + height + Math.sin(u * Math.PI * 4) * 0.3,
      centre.z + Math.sin(padAngle + u * Math.PI * 2) * orbit.radius,
    );
  const at = (time: number, out: THREE.Vector3) => {
    const s = time % ROCKET.period;
    const top = pad.clone().setY(pad.y + height * 0.8);
    if (s < ROCKET.launch) return out.copy(pad);
    if (s < ROCKET.out)
      return out.lerpVectors(
        pad,
        top,
        ease(clamp01((s - ROCKET.launch) / (ROCKET.out - ROCKET.launch))),
      );
    if (s < ROCKET.loop) {
      loopPoint(0, tmp.q);
      return out.lerpVectors(top, tmp.q, ease((s - ROCKET.out) / (ROCKET.loop - ROCKET.out)));
    }
    if (s < ROCKET.back) return loopPoint((s - ROCKET.loop) / (ROCKET.back - ROCKET.loop), out);
    if (s < ROCKET.descend) {
      loopPoint(1, tmp.q);
      return out.lerpVectors(tmp.q, top, ease((s - ROCKET.back) / (ROCKET.descend - ROCKET.back)));
    }
    if (s < ROCKET.land)
      return out.lerpVectors(top, pad, ease((s - ROCKET.descend) / (ROCKET.land - ROCKET.descend)));
    return out.copy(pad);
  };
  at(t, rocket.position);
  at(t + 0.05, tmp.p);
  const s = t % ROCKET.period;
  const flying = s > ROCKET.launch && s < ROCKET.land;
  if (flame) {
    flame.visible = flying;
    flame.scale.y = 0.8 + Math.random() * 0.5;
  }
  const dir = tmp.p.sub(rocket.position);
  if (flying && dir.lengthSq() > 1e-8) {
    // Nose along the direction of travel, except while landing (stays upright).
    const descending = s > ROCKET.descend;
    if (descending) rocket.quaternion.identity();
    else rocket.quaternion.setFromUnitVectors(tmp.up, dir.normalize());
  } else {
    rocket.quaternion.identity();
  }
}
