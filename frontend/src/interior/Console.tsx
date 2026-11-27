// A rocket-style control panel: a sloped desk with a keyboard where the robot
// types, a keypad, rows of lit buttons (a few blinking), toggle switches and
// three levers. Units match the robot: the work surface is at y = 0.75.
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";

import { shouldAnimate } from "../belt/hold";
import { useHold } from "../belt/HoldContext";

const BUTTON_COLOURS = [0xff453a, 0xffb340, 0x30d158, 0x4169e1, 0x8aa4ff, 0x64d2ff];

export function Console({ tint }: { tint: string }) {
  const reducedMotion = useMemo(() => matchMedia("(prefers-reduced-motion: reduce)").matches, []);

  const mats = useMemo(() => {
    const t = new THREE.Color(tint);
    return {
      body: new THREE.MeshStandardMaterial({ color: 0x2a303d, roughness: 0.55, metalness: 0.6 }),
      top: new THREE.MeshStandardMaterial({ color: 0x1b2029, roughness: 0.6, metalness: 0.4 }),
      trim: new THREE.MeshStandardMaterial({ color: t, roughness: 0.4, metalness: 0.5 }),
      key: new THREE.MeshStandardMaterial({ color: 0x3d4558, roughness: 0.6, metalness: 0.3 }),
      steel: new THREE.MeshStandardMaterial({ color: 0xc9ced8, roughness: 0.3, metalness: 0.9 }),
      knob: new THREE.MeshStandardMaterial({ color: 0xff453a, roughness: 0.4, metalness: 0.2 }),
      buttons: BUTTON_COLOURS.map(
        (c) => new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(1.4) }),
      ),
      // One material per blinking button (every third of the 16), made once.
      blink: Array.from(
        { length: 16 },
        (_, i) => new THREE.MeshBasicMaterial({ color: BUTTON_COLOURS[i % 6] }),
      ),
    };
  }, [tint]);
  useEffect(
    () => () => {
      const { buttons, blink, ...rest } = mats;
      [...buttons, ...blink, ...Object.values(rest)].forEach((m) => m.dispose());
    },
    [mats],
  );

  const needles = useRef<THREE.Group>(null);
  const chase = useRef<THREE.Group>(null);
  const hold = useHold();
  useFrame((state) => {
    if (!shouldAnimate({ hold, inView: true, keepMoving: false })) return;
    const t = state.clock.elapsedTime * (reducedMotion ? 0.3 : 1);
    needles.current?.children.forEach(
      (n, i) => (n.rotation.z = -0.9 + Math.sin(t * (0.7 + i * 0.4) + i) * 0.8),
    );
    chase.current?.children.forEach((l, i) => {
      const m = (l as THREE.Mesh).material as THREE.MeshBasicMaterial;
      m.color.setScalar(
        Math.floor(t * 8) % 24 === i || Math.floor(t * 8 + 12) % 24 === i ? 1.6 : 0.15,
      );
    });
    mats.blink.forEach((m, i) => {
      if (i % 3 !== 0) return;
      const on = Math.sin(t * (1.3 + i * 0.4) + i) > 0.2;
      m.color.set(BUTTON_COLOURS[i % 6]!).multiplyScalar(on ? 1.4 : 0.25);
    });
  });

  // Sloped top: tilted toward the robot.
  const SLOPE = -0.32;

  return (
    <group>
      {/* Pedestal set back, with an overhanging work surface: knee space for the robot. */}
      <mesh position={[0, 0.37, 0.9]} material={mats.body} castShadow receiveShadow>
        <boxGeometry args={[1.9, 0.74, 0.4]} />
      </mesh>
      <mesh position={[0, 0.755, 0.525]} material={mats.top}>
        <boxGeometry args={[1.9, 0.03, 0.39]} />
      </mesh>
      <mesh position={[0, 0.76, 0.33]} material={mats.trim}>
        <boxGeometry args={[1.92, 0.035, 0.02]} />
      </mesh>

      {/* Keyboard under the robot's hands. */}
      <group position={[0, 0.775, 0.45]}>
        {Array.from({ length: 3 }, (_, r) =>
          Array.from({ length: 12 }, (_, c) => (
            <mesh
              key={`${r}-${c}`}
              position={[-0.33 + c * 0.06, 0, -0.04 + r * 0.045]}
              material={mats.key}
            >
              <boxGeometry args={[0.05, 0.015, 0.038]} />
            </mesh>
          )),
        )}
      </group>

      {/* Chasing light strip along the front lip. */}
      <group ref={chase} position={[0, 0.74, 0.33]}>
        {Array.from({ length: 24 }, (_, i) => (
          <mesh key={i} position={[-0.86 + i * 0.075, 0, -0.012]}>
            <boxGeometry args={[0.04, 0.008, 0.004]} />
            <meshBasicMaterial color={0x64d2ff} toneMapped={false} />
          </mesh>
        ))}
      </group>

      {/* A raised hood behind the slope: two gauges with moving needles and a guarded switch. */}
      <group position={[0, 0.86, 0.98]} rotation={[-0.25, 0, 0]}>
        <mesh material={mats.body}>
          <boxGeometry args={[1.9, 0.16, 0.06]} />
        </mesh>
        <group ref={needles}>
          {[-0.78, -0.56, 0.56, 0.78].map((x) => (
            <group key={x} position={[x, 0, -0.035]}>
              <mesh position={[0, 0.035, 0]} rotation={[0, 0, 0]} material={mats.steel}>
                <boxGeometry args={[0.006, 0.07, 0.004]} />
              </mesh>
            </group>
          ))}
        </group>
        {[-0.78, -0.56, 0.56, 0.78].map((x) => (
          <mesh
            key={x}
            position={[x, 0, -0.032]}
            rotation={[Math.PI / 2, 0, 0]}
            material={mats.top}
          >
            <cylinderGeometry args={[0.085, 0.085, 0.01, 28]} />
          </mesh>
        ))}
        <group position={[0.35, -0.02, -0.04]}>
          <mesh material={mats.knob}>
            <boxGeometry args={[0.06, 0.08, 0.04]} />
          </mesh>
          <mesh position={[0, 0.04, -0.03]} rotation={[0.9, 0, 0]} material={mats.trim}>
            <boxGeometry args={[0.07, 0.005, 0.09]} />
          </mesh>
        </group>
      </group>

      {/* The sloped instrument panel behind the keyboard. */}
      <group position={[0, 0.86, 0.72]} rotation={[SLOPE, 0, 0]}>
        <mesh material={mats.top} receiveShadow>
          <boxGeometry args={[1.9, 0.03, 0.42]} />
        </mesh>

        {/* Keypad on the left. */}
        <group position={[-0.68, 0.02, 0]}>
          {Array.from({ length: 12 }, (_, i) => (
            <mesh
              key={i}
              position={[-0.06 + (i % 3) * 0.06, 0, -0.09 + Math.floor(i / 3) * 0.06]}
              material={mats.key}
            >
              <boxGeometry args={[0.048, 0.02, 0.048]} />
            </mesh>
          ))}
        </group>

        {/* Rows of lit buttons in the middle; every third one blinks. */}
        <group position={[0, 0.02, 0]}>
          {Array.from({ length: 2 }, (_, r) =>
            Array.from({ length: 8 }, (_, c) => {
              const i = r * 8 + c;
              const blinking = i % 3 === 0;
              return (
                <mesh
                  key={i}
                  position={[-0.28 + c * 0.08, 0, -0.06 + r * 0.1]}
                  material={blinking ? mats.blink[i] : mats.buttons[i % 6]}
                >
                  <cylinderGeometry args={[0.022, 0.022, 0.02, 14]} />
                </mesh>
              );
            }),
          )}
        </group>

        {/* Toggle switches. */}
        <group position={[0.42, 0.02, -0.08]}>
          {Array.from({ length: 5 }, (_, i) => (
            <mesh
              key={i}
              position={[i * 0.05, 0.03, 0]}
              rotation={[i % 2 ? 0.5 : -0.5, 0, 0]}
              material={mats.steel}
            >
              <cylinderGeometry args={[0.007, 0.007, 0.06, 6]} />
            </mesh>
          ))}
        </group>

        {/* Three levers on the right. */}
        <group position={[0.62, 0.02, 0.07]}>
          {[-0.5, 0.35, -0.15].map((tilt, i) => (
            <group key={i} position={[i * 0.08 - 0.08, 0, 0]} rotation={[tilt, 0, 0]}>
              <mesh position={[0, 0.07, 0]} material={mats.steel}>
                <cylinderGeometry args={[0.009, 0.009, 0.14, 8]} />
              </mesh>
              <mesh position={[0, 0.15, 0]} material={mats.knob}>
                <sphereGeometry args={[0.022, 12, 10]} />
              </mesh>
            </group>
          ))}
          <mesh position={[0, 0, 0]} material={mats.body}>
            <boxGeometry args={[0.28, 0.02, 0.08]} />
          </mesh>
        </group>
      </group>
    </group>
  );
}
