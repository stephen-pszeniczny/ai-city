// The robot: one original, friendly character built from simple shapes,
// recoloured with its building's tint. Not based on any brand, film or game.
//
// It sits on a low stool facing +z (its desk), typing. The building view is
// third person from behind, so the back is detailed (vents, status light,
// tint stripe) and the stool has no tall backrest to hide it.
// Units: the desk top is at y = 0.75.
import { RoundedBox } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";

const KEYBOARD_Y = 0.78;

type Vec3 = [number, number, number];

/** A rounded rod from `a` to `b` (arms, legs). */
function Limb({ a, b, r, material }: { a: Vec3; b: Vec3; r: number; material: THREE.Material }) {
  const { position, quaternion, length } = useMemo(() => {
    const va = new THREE.Vector3(...a);
    const vb = new THREE.Vector3(...b);
    const dir = vb.clone().sub(va);
    return {
      position: va.clone().add(vb).multiplyScalar(0.5),
      quaternion: new THREE.Quaternion().setFromUnitVectors(
        new THREE.Vector3(0, 1, 0),
        dir.clone().normalize(),
      ),
      length: dir.length(),
    };
  }, [a, b]);
  return (
    <mesh position={position} quaternion={quaternion} material={material} castShadow>
      <capsuleGeometry args={[r, Math.max(0.001, length - 2 * r), 6, 12]} />
    </mesh>
  );
}

export function Robot({ tint, seated = true }: { tint: string; seated?: boolean }) {
  const reducedMotion = useMemo(() => matchMedia("(prefers-reduced-motion: reduce)").matches, []);
  const head = useRef<THREE.Group>(null);
  const eyes = useRef<THREE.Group>(null);
  const leftHand = useRef<THREE.Group>(null);
  const rightHand = useRef<THREE.Group>(null);
  const led = useRef<THREE.MeshBasicMaterial>(null);

  const mats = useMemo(() => {
    const t = new THREE.Color(tint);
    return {
      shell: new THREE.MeshStandardMaterial({
        color: new THREE.Color(0xf2f4f8).lerp(t, 0.18),
        roughness: 0.35,
        metalness: 0.15,
      }),
      tint: new THREE.MeshStandardMaterial({ color: t, roughness: 0.4, metalness: 0.25 }),
      joint: new THREE.MeshStandardMaterial({ color: 0x3a4152, roughness: 0.5, metalness: 0.6 }),
      face: new THREE.MeshStandardMaterial({ color: 0x0b0f1a, roughness: 0.15, metalness: 0.4 }),
      eye: new THREE.MeshBasicMaterial({ color: new THREE.Color(0x8ff6ff).multiplyScalar(1.6) }),
      glow: new THREE.MeshBasicMaterial({ color: t.clone().multiplyScalar(1.8) }),
      vent: new THREE.MeshStandardMaterial({ color: 0x1a1f2b, roughness: 0.7, metalness: 0.3 }),
      stool: new THREE.MeshStandardMaterial({ color: 0x2b313c, roughness: 0.5, metalness: 0.7 }),
    };
  }, [tint]);
  // Made outside JSX, so React won't free them by itself.
  useEffect(() => () => Object.values(mats).forEach((m) => m.dispose()), [mats]);

  useFrame((state) => {
    const speed = reducedMotion ? 0.3 : 1;
    const t = state.clock.elapsedTime * speed;
    // Head: a slow, curious tilt and the occasional glance down at the keys.
    if (head.current) {
      head.current.rotation.z = Math.sin(t * 0.6) * 0.06;
      head.current.rotation.x = 0.12 + Math.max(0, Math.sin(t * 0.23)) * 0.12;
    }
    // Blink for about 0.12 s every 4 seconds.
    if (eyes.current) eyes.current.scale.y = t % 4 < 0.12 ? 0.1 : 1;
    // Typing in bursts: 2.5 s of keys, then a short pause.
    const typing = t % 3.5 < 2.5;
    const tap = typing ? Math.sin(t * 16) * 0.02 : 0;
    if (leftHand.current) leftHand.current.position.y = KEYBOARD_Y + Math.max(0, tap);
    if (rightHand.current) rightHand.current.position.y = KEYBOARD_Y + Math.max(0, -tap);
    // Status light on the back: a slow pulse.
    if (led.current) led.current.color.setScalar(0.6 + 0.6 * (0.5 + 0.5 * Math.sin(t * 2.2)));
  });

  const hipY = seated ? 0.56 : 0.9;

  return (
    <group>
      {seated && (
        // Low stool: seat, post and a five-spoke base. No backrest (keeps the back in view).
        <group>
          <mesh position={[0, 0.46, -0.02]} material={mats.stool} castShadow>
            <cylinderGeometry args={[0.27, 0.25, 0.07, 28]} />
          </mesh>
          <mesh position={[0, 0.25, -0.02]} material={mats.stool}>
            <cylinderGeometry args={[0.035, 0.035, 0.38, 10]} />
          </mesh>
          {[0, 1, 2, 3, 4].map((i) => {
            const a = (i / 5) * Math.PI * 2;
            return (
              <mesh
                key={i}
                position={[Math.cos(a) * 0.15, 0.04, -0.02 + Math.sin(a) * 0.15]}
                rotation={[0, -a, Math.PI / 2]}
                material={mats.stool}
              >
                <cylinderGeometry args={[0.02, 0.02, 0.3, 6]} />
              </mesh>
            );
          })}
        </group>
      )}

      {/* Legs: thighs forward, shins down under the desk. */}
      {[-1, 1].map((s) => (
        <group key={s}>
          <Limb
            a={[s * 0.12, hipY, 0]}
            b={[s * 0.13, hipY - 0.02, 0.36]}
            r={0.075}
            material={mats.shell}
          />
          <Limb
            a={[s * 0.13, hipY - 0.02, 0.36]}
            b={[s * 0.13, 0.08, 0.4]}
            r={0.065}
            material={mats.shell}
          />
          <mesh position={[s * 0.13, 0.04, 0.46]} material={mats.tint} castShadow>
            <boxGeometry args={[0.14, 0.08, 0.22]} />
          </mesh>
          <mesh position={[s * 0.13, hipY - 0.02, 0.36]} material={mats.joint}>
            <sphereGeometry args={[0.08, 12, 10]} />
          </mesh>
        </group>
      ))}

      {/* Torso, leaning slightly toward the desk. */}
      <group position={[0, hipY + 0.32, 0]} rotation={[0.12, 0, 0]}>
        <mesh material={mats.shell} castShadow>
          <capsuleGeometry args={[0.24, 0.3, 8, 20]} />
        </mesh>
        {/* Chest plate. */}
        <mesh position={[0, 0.04, 0.2]} material={mats.tint}>
          <boxGeometry args={[0.28, 0.2, 0.06]} />
        </mesh>
        {/* The back: vent slats, tint stripe and a pulsing status light. */}
        <mesh position={[0, 0.02, -0.215]} material={mats.vent}>
          <boxGeometry args={[0.3, 0.34, 0.04]} />
        </mesh>
        {[-0.1, -0.04, 0.02, 0.08].map((y) => (
          <mesh key={y} position={[0, y, -0.24]} material={mats.joint}>
            <boxGeometry args={[0.24, 0.022, 0.02]} />
          </mesh>
        ))}
        <mesh position={[0, 0.19, -0.205]} material={mats.tint}>
          <boxGeometry args={[0.06, 0.1, 0.05]} />
        </mesh>
        <mesh position={[0.11, 0.16, -0.24]}>
          <sphereGeometry args={[0.022, 10, 8]} />
          <meshBasicMaterial ref={led} color={0x30d158} />
        </mesh>
        {/* Shoulders. */}
        {[-1, 1].map((s) => (
          <mesh key={s} position={[s * 0.29, 0.18, 0]} material={mats.joint}>
            <sphereGeometry args={[0.085, 14, 12]} />
          </mesh>
        ))}
      </group>

      {/* Arms reaching to the keyboard; the hands tap. */}
      {[-1, 1].map((s) => {
        const shoulder: Vec3 = [s * 0.3, hipY + 0.5, 0.02];
        const elbow: Vec3 = [s * 0.34, hipY + 0.26, 0.24];
        const hand: Vec3 = [s * 0.17, KEYBOARD_Y, 0.48];
        return (
          <group key={s}>
            <Limb a={shoulder} b={elbow} r={0.06} material={mats.shell} />
            <Limb a={elbow} b={hand} r={0.055} material={mats.tint} />
            <group ref={s < 0 ? leftHand : rightHand} position={hand}>
              <mesh material={mats.joint} scale={[1.2, 0.6, 1.2]}>
                <sphereGeometry args={[0.06, 12, 10]} />
              </mesh>
            </group>
          </group>
        );
      })}

      {/* Neck and head. */}
      <mesh position={[0, hipY + 0.68, 0.03]} material={mats.joint}>
        <cylinderGeometry args={[0.06, 0.07, 0.1, 12]} />
      </mesh>
      <group ref={head} position={[0, hipY + 0.74, 0.04]}>
        <RoundedBox
          args={[0.46, 0.34, 0.38]}
          radius={0.08}
          smoothness={4}
          position={[0, 0.17, 0]}
          material={mats.shell}
          castShadow
        />
        {/* Screen face with two eyes. */}
        <mesh position={[0, 0.16, 0.19]} material={mats.face}>
          <boxGeometry args={[0.38, 0.24, 0.02]} />
        </mesh>
        <group ref={eyes} position={[0, 0.17, 0.205]}>
          {[-1, 1].map((s) => (
            <mesh key={s} position={[s * 0.08, 0, 0]} material={mats.eye}>
              <capsuleGeometry args={[0.025, 0.04, 4, 8]} />
            </mesh>
          ))}
        </group>
        {/* Ear discs in the tint. */}
        {[-1, 1].map((s) => (
          <mesh
            key={s}
            position={[s * 0.245, 0.17, 0]}
            rotation={[0, 0, Math.PI / 2]}
            material={mats.tint}
          >
            <cylinderGeometry args={[0.08, 0.08, 0.04, 20]} />
          </mesh>
        ))}
        {/* Antenna with a glowing tip. */}
        <mesh position={[0.08, 0.43, -0.04]} rotation={[0, 0, -0.2]} material={mats.joint}>
          <cylinderGeometry args={[0.012, 0.012, 0.18, 6]} />
        </mesh>
        <mesh position={[0.098, 0.53, -0.04]} material={mats.glow}>
          <sphereGeometry args={[0.035, 12, 10]} />
        </mesh>
      </group>
    </group>
  );
}
