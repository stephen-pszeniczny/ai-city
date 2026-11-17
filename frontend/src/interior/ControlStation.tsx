// Mission Control's and the Vault's control rooms, at the ends of the
// station's hallways. The robot sits at a rocket-style console with a large
// screen; in front of it the window takes up most of the wall, looking out at
// the real belt. The hallway door is in the side wall nearest the hub. The
// Vault's room has deposit boxes and gold trim, and on the first visit of the
// session its robot opens the vault door, waves, then glides back to work.
// Room coordinates: origin on the floor under the robot, window toward +z.
import { useFrame, type ThreeEvent } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";

import type { BuildingId } from "../api";
import { vaultDoor } from "../belt/vaultDoor";
import { Console } from "./Console";
import { Gadget } from "./Gadget";
import { Monitor, SCREEN, type ScreenLine } from "./Monitor";
import { Robot, useRobotBrain, type RobotAway } from "./Robot";
import { ROOM_SIZE, VAULT_OPENING } from "./stationLayout";
import { WallPanel } from "./WallPanels";

type Module = "planner" | "finance";

/** Room origin relative to its module's centre (floor below the module axis). */
export const ROOM_OFFSET = new THREE.Vector3(0, -1.0, 0);
/** Which side wall has the hallway door (+x for Mission Control, -x for the Vault). */
export const doorSide = (m: Module) => (m === "planner" ? 1 : -1);

const CONSOLE_Z = 0.11;
const MONITOR_AT = new THREE.Vector3(0, 1.36, 1.1);
const SCREEN_VIEW_DISTANCE = 1.24;

/** Camera points for a room (room coordinates). */
export function roomView(m: Module) {
  const side = doorSide(m);
  const turn = new THREE.Euler(0.2, -0.25 * side, 0, "YXZ");
  const normal = new THREE.Vector3(0, 0, -1).applyEuler(turn);
  return {
    turn,
    /** Third person: behind, above and to one side of the robot, so most of the screen shows. */
    camera: new THREE.Vector3(1.2 * side, 2.3, -2.2),
    screen: MONITOR_AT.clone(),
    screenCamera: MONITOR_AT.clone().addScaledVector(normal, SCREEN_VIEW_DISTANCE),
  };
}

const { width: W, back: BACK, front: FRONT, height: H } = ROOM_SIZE;
const DOOR = { half: 1.1, top: 2.15 } as const;
const SILL = 0.32;

export function ControlStation({
  id,
  title,
  tint,
  built,
  lines,
  atScreen,
  onOpenScreen,
}: {
  id: Module;
  title: string;
  tint: string;
  built: boolean;
  lines: readonly ScreenLine[];
  /** Zoomed into the screen: the desktop overlay takes the monitor's place, so it and the robot hide. */
  atScreen: boolean;
  onOpenScreen: () => void;
}) {
  const brain = useRobotBrain(title + tint + id);
  const side = doorSide(id);
  const view = useMemo(() => roomView(id), [id]);
  const vault = id === "finance";
  const reducedMotion = useMemo(() => matchMedia("(prefers-reduced-motion: reduce)").matches, []);

  const mats = useMemo(() => {
    const t = new THREE.Color(tint);
    return {
      wall: new THREE.MeshStandardMaterial({
        color: vault ? 0x2a2620 : 0x232936,
        roughness: 0.7,
        metalness: 0.4,
      }),
      panel: new THREE.MeshStandardMaterial({
        color: vault ? 0x3a3326 : 0x2d3444,
        roughness: 0.6,
        metalness: 0.5,
      }),
      floor: new THREE.MeshStandardMaterial({ color: 0x181c25, roughness: 0.8, metalness: 0.3 }),
      frame: new THREE.MeshStandardMaterial({ color: 0x3a4152, roughness: 0.4, metalness: 0.8 }),
      strip: new THREE.MeshBasicMaterial({
        color: t.clone().multiplyScalar(1.3),
        toneMapped: false,
      }),
      light: new THREE.MeshBasicMaterial({
        color: new THREE.Color(0xfff1dc).multiplyScalar(1.3),
        toneMapped: false,
      }),
      glass: new THREE.MeshBasicMaterial({
        color: 0x9fb6ff,
        transparent: true,
        opacity: 0.05,
        depthWrite: false,
      }),
      gold: new THREE.MeshStandardMaterial({ color: 0xd19a35, roughness: 0.3, metalness: 1 }),
      box: new THREE.MeshStandardMaterial({ color: 0x7d8594, roughness: 0.35, metalness: 0.9 }),
    };
  }, [tint, vault]);
  useEffect(() => () => Object.values(mats).forEach((m) => m.dispose()), [mats]);

  // Deposit boxes on the vault's back wall: one instanced grid with gold handles.
  const boxes = useRef<THREE.InstancedMesh>(null);
  const handles = useRef<THREE.InstancedMesh>(null);
  const BOX_COLS = 9;
  const BOX_ROWS = 5;
  useLayoutEffect(() => {
    if (!boxes.current || !handles.current) return;
    const o = new THREE.Object3D();
    let i = 0;
    for (let r = 0; r < BOX_ROWS; r++) {
      for (let c = 0; c < BOX_COLS; c++) {
        o.position.set((c - (BOX_COLS - 1) / 2) * 0.42, 0.55 + r * 0.36, BACK + 0.08);
        o.updateMatrix();
        boxes.current.setMatrixAt(i, o.matrix);
        o.position.z += 0.06;
        o.updateMatrix();
        handles.current.setMatrixAt(i, o.matrix);
        i++;
      }
    }
    boxes.current.instanceMatrix.needsUpdate = true;
    handles.current.instanceMatrix.needsUpdate = true;
  }, [vault]);

  // The Vault's greeting: hover by the door while it opens, wave, glide back to the chair.
  const away = useMemo<RobotAway>(
    () => ({ active: false, position: new THREE.Vector3(), yaw: 0 }),
    [],
  );
  const greet = useMemo(() => new THREE.Vector3(1.3 * side, 0, -0.9), [side]);
  const waved = useRef(false);
  useFrame(() => {
    if (!vault) return;
    const start = vaultDoor.openingStart();
    const s = start === null ? Infinity : (performance.now() - start) / 1000;
    if (!vaultDoor.isOpen() || s >= VAULT_OPENING.seated) {
      away.active = false;
      return;
    }
    away.active = true;
    const facing = side * (Math.PI / 2) + (side > 0 ? 0.5 : -0.5);
    if (s < VAULT_OPENING.wave) {
      away.position.copy(greet);
      away.yaw = facing;
      if (s >= VAULT_OPENING.swing - 0.2 && !waved.current) {
        waved.current = true;
        brain.force("wave");
      }
    } else {
      const k = (s - VAULT_OPENING.wave) / (VAULT_OPENING.seated - VAULT_OPENING.wave);
      const e = k * k * (3 - 2 * k);
      away.position.copy(greet).multiplyScalar(1 - e);
      away.yaw = facing * (1 - e);
    }
  });

  const click = (e: ThreeEvent<MouseEvent>) => {
    if (e.delta > 5) return;
    e.stopPropagation();
    onOpenScreen();
  };
  const clickRobot = (e: ThreeEvent<MouseEvent>) => {
    if (e.delta > 5) return;
    e.stopPropagation();
    brain.react();
  };

  const depth = FRONT - BACK;
  const midZ = (BACK + FRONT) / 2;
  const doorX = side * (W / 2);
  const farX = -doorX;
  return (
    <group position={ROOM_OFFSET}>
      {/* Floor, ceiling with a light panel, tint strips. */}
      <mesh position={[0, -0.05, midZ]} material={mats.floor} receiveShadow>
        <boxGeometry args={[W, 0.1, depth]} />
      </mesh>
      {vault && (
        <mesh position={[0, 0.004, 0]} rotation={[-Math.PI / 2, 0, 0]} material={mats.gold}>
          <ringGeometry args={[1.25, 1.32, 64]} />
        </mesh>
      )}
      <mesh position={[0, H + 0.05, midZ]} material={mats.wall}>
        <boxGeometry args={[W, 0.1, depth]} />
      </mesh>
      <mesh position={[0, H - 0.005, -0.6]} material={mats.light}>
        <boxGeometry args={[1.6, 0.01, 0.9]} />
      </mesh>

      {/* Far side wall: solid, with moving panels and a tint strip. */}
      <group position={[farX, 0, midZ]}>
        <mesh position={[0, H / 2, 0]} material={mats.wall}>
          <boxGeometry args={[0.1, H, depth]} />
        </mesh>
        {[-1.3, 0, 1.3].map((z, i) => (
          <WallPanel
            key={z}
            kind={i % 2 ? "wave" : "bars"}
            width={0.8}
            height={1.1}
            position={[side * 0.07, 1.45, z]}
            rotation={[0, (side * Math.PI) / 2, 0]}
          />
        ))}
        <mesh position={[side * 0.07, H - 0.25, 0]} material={mats.strip}>
          <boxGeometry args={[0.02, 0.03, depth - 0.4]} />
        </mesh>
      </group>

      {/* Door side wall: an opening onto the hallway (the vault door fills it in the Vault). */}
      <group position={[doorX, 0, 0]}>
        {[
          [BACK, -DOOR.half],
          [DOOR.half, FRONT],
        ].map(([z0, z1]) => (
          <mesh key={z0} position={[0, H / 2, ((z0 ?? 0) + (z1 ?? 0)) / 2]} material={mats.wall}>
            <boxGeometry args={[0.1, H, (z1 ?? 0) - (z0 ?? 0)]} />
          </mesh>
        ))}
        <mesh position={[0, (DOOR.top + H) / 2, 0]} material={mats.wall}>
          <boxGeometry args={[0.1, H - DOOR.top, DOOR.half * 2]} />
        </mesh>
        {!vault &&
          [-1, 1].map((s) => (
            <mesh key={s} position={[0, DOOR.top / 2, s * DOOR.half]} material={mats.frame}>
              <boxGeometry args={[0.16, DOOR.top, 0.1]} />
            </mesh>
          ))}
        <WallPanel
          kind="bars"
          width={0.5}
          height={0.8}
          position={[-side * 0.07, 1.4, -1.7]}
          rotation={[0, (-side * Math.PI) / 2, 0]}
        />
      </group>

      {/* Back wall: deposit boxes in the Vault, panels in Mission Control. */}
      <mesh position={[0, H / 2, BACK]} material={mats.wall}>
        <boxGeometry args={[W, H, 0.1]} />
      </mesh>
      {vault ? (
        <>
          <instancedMesh
            ref={boxes}
            args={[undefined, undefined, BOX_COLS * BOX_ROWS]}
            material={mats.box}
          >
            <boxGeometry args={[0.38, 0.32, 0.06]} />
          </instancedMesh>
          <instancedMesh
            ref={handles}
            args={[undefined, undefined, BOX_COLS * BOX_ROWS]}
            material={mats.gold}
          >
            <boxGeometry args={[0.1, 0.02, 0.03]} />
          </instancedMesh>
        </>
      ) : (
        [-1.4, 1.4].map((x, i) => (
          <WallPanel
            key={x}
            kind={i ? "wave" : "bars"}
            width={0.9}
            height={1.2}
            position={[x, 1.4, BACK + 0.07]}
          />
        ))
      )}

      {/* Window wall: most of the wall is glass, with slim mullions. */}
      <group position={[0, 0, FRONT]}>
        <mesh position={[0, SILL / 2, 0]} material={mats.wall}>
          <boxGeometry args={[W, SILL, 0.12]} />
        </mesh>
        <mesh position={[0, H - 0.06, 0]} material={mats.wall}>
          <boxGeometry args={[W, 0.12, 0.12]} />
        </mesh>
        {[-1, 1].map((s) => (
          <mesh key={s} position={[s * (W / 2 - 0.06), H / 2, 0]} material={mats.frame}>
            <boxGeometry args={[0.12, H, 0.14]} />
          </mesh>
        ))}
        {[-0.75, 0.75].map((x) => (
          <mesh key={x} position={[x, (SILL + H) / 2, 0]} material={mats.frame}>
            <boxGeometry args={[0.04, H - SILL - 0.12, 0.08]} />
          </mesh>
        ))}
        <mesh position={[0, SILL + 0.6, 0]} material={mats.frame}>
          <boxGeometry args={[W - 0.2, 0.03, 0.06]} />
        </mesh>
        <mesh position={[0, (SILL + H) / 2, 0.02]} material={mats.glass}>
          <planeGeometry args={[W - 0.2, H - SILL - 0.12]} />
        </mesh>
        {vault && (
          <mesh position={[0, H - 0.13, -0.07]} material={mats.gold}>
            <boxGeometry args={[W - 0.2, 0.03, 0.02]} />
          </mesh>
        )}
      </group>

      {/* The work area. Clicking the console or screen opens the screen; the robot reacts. */}
      <group onClick={clickRobot} visible={!atScreen}>
        <Robot tint={tint} brain={brain} away={away} />
      </group>
      <group onClick={click}>
        <group position={[0, 0, CONSOLE_Z]}>
          <Console tint={tint} />
        </group>
        <Gadget id={id as BuildingId} tint={tint} detail="near" reducedMotion={reducedMotion} />
        <group position={view.screen} rotation={view.turn} visible={!atScreen}>
          <Monitor id={id} title={title} tint={tint} built={built} lines={lines} brain={brain} />
        </group>
      </group>

      {/* Light: warm from the ceiling, cool from the screen. */}
      <pointLight position={[0, H - 0.3, -0.4]} intensity={6} distance={7} color={0xffe2c0} />
      <pointLight position={[0, 1.3, 0.7]} intensity={2.2} distance={3} color={0x8aa4ff} />
    </group>
  );
}

export { SCREEN };
