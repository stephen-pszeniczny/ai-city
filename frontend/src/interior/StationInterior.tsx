// The inside of the station: the hub (entered through its hatch), a hallway
// to each side, Mission Control's room at the end of one and the Vault (behind
// its round door) at the end of the other. Built once and shown while the
// camera is inside the station. Station coordinates (see stationLayout).
import { useEffect, useMemo } from "react";
import * as THREE from "three";

import type { BuildingId } from "../api";
import type { HallwayRow } from "../belt/hallwayStatus";
import { ControlStation } from "./ControlStation";
import { Hallway } from "./Hallway";
import type { ScreenLine } from "./Monitor";
import { FLOOR_Y, HALL, HATCH, HUB, MODULE_X } from "./stationLayout";
import { VaultDoor } from "./VaultDoor";
import { PanelTexturesProvider, WallPanel } from "./WallPanels";

type Module = "planner" | "finance";

export function StationInterior({
  titleOf,
  tintOf,
  built,
  plannerLines,
  rows,
  summary,
  screenOf,
  onOpenScreen,
}: {
  titleOf: (id: BuildingId) => string;
  tintOf: (id: BuildingId) => string;
  built: ReadonlySet<BuildingId>;
  plannerLines: readonly ScreenLine[];
  rows: readonly HallwayRow[];
  summary: string;
  /** Which room's screen is open (its monitor and robot hide), if any. */
  screenOf: Module | null;
  onOpenScreen: (id: Module) => void;
}) {
  return (
    <PanelTexturesProvider>
      <Hub />
      <Hallway
        fromX={-HALL.startX}
        toX={-HALL.endX}
        tint={tintOf("planner")}
        vault={false}
        rows={rows}
        summary={summary}
        tintOf={tintOf}
      />
      <Hallway fromX={HALL.startX} toX={HALL.endX} tint={tintOf("finance")} vault tintOf={tintOf} />
      <VaultDoor />
      {(["planner", "finance"] as const).map((id) => (
        <group key={id} position={[MODULE_X[id], 0, 0]}>
          <ControlStation
            id={id}
            title={titleOf(id)}
            tint={tintOf(id)}
            built={built.has(id)}
            lines={id === "planner" ? plannerLines : []}
            atScreen={screenOf === id}
            onOpenScreen={() => onOpenScreen(id)}
          />
        </group>
      ))}
    </PanelTexturesProvider>
  );
}

/** The hub: an eight-sided room with the hatch (+z) and the two hallway openings (±x). */
function Hub() {
  const mats = useMemo(
    () => ({
      wall: new THREE.MeshStandardMaterial({ color: 0x262c39, roughness: 0.65, metalness: 0.45 }),
      floor: new THREE.MeshStandardMaterial({ color: 0x14171e, roughness: 0.75, metalness: 0.4 }),
      rib: new THREE.MeshStandardMaterial({ color: 0x3a4152, roughness: 0.4, metalness: 0.8 }),
      light: new THREE.MeshBasicMaterial({
        color: new THREE.Color(0xeaf0ff).multiplyScalar(1.3),
        toneMapped: false,
      }),
      accent: new THREE.MeshBasicMaterial({
        color: new THREE.Color(0x4169e1).multiplyScalar(1.6),
        toneMapped: false,
      }),
      holo: new THREE.MeshBasicMaterial({
        color: new THREE.Color(0x7fe8ff),
        transparent: true,
        opacity: 0.25,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      }),
    }),
    [],
  );
  useEffect(() => () => Object.values(mats).forEach((m) => m.dispose()), [mats]);

  const R = HUB.radius;
  const Ht = HUB.height;
  const sideLen = 2 * R * Math.tan(Math.PI / 8);
  // Eight wall faces; the hatch (+z) and the hallways (±x) are open.
  const faces = Array.from({ length: 8 }, (_, i) => (i / 8) * Math.PI * 2).filter(
    (_, i) => i !== 0 && i !== 2 && i !== 6,
  );
  return (
    <group position={[0, FLOOR_Y, 0]}>
      <mesh
        position={[0, -0.05, 0]}
        rotation={[0, Math.PI / 8, 0]}
        material={mats.floor}
        receiveShadow
      >
        <cylinderGeometry args={[R / Math.cos(Math.PI / 8), R / Math.cos(Math.PI / 8), 0.1, 8]} />
      </mesh>
      <mesh position={[0, Ht + 0.05, 0]} rotation={[0, Math.PI / 8, 0]} material={mats.wall}>
        <cylinderGeometry args={[R / Math.cos(Math.PI / 8), R / Math.cos(Math.PI / 8), 0.1, 8]} />
      </mesh>
      <mesh position={[0, Ht - 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]} material={mats.light}>
        <ringGeometry args={[0.9, 1.05, 48]} />
      </mesh>
      {faces.map((a) => (
        <group key={a} rotation={[0, a, 0]}>
          <mesh position={[0, Ht / 2, R]} material={mats.wall}>
            <boxGeometry args={[sideLen, Ht, 0.1]} />
          </mesh>
          <WallPanel
            kind={a > Math.PI ? "wave" : "bars"}
            width={0.55}
            height={0.8}
            position={[0, 1.4, R - 0.07]}
            rotation={[0, Math.PI, 0]}
          />
        </group>
      ))}
      {/* Frames round the three openings. */}
      {[0, Math.PI / 2, -Math.PI / 2].map((a) => (
        <group key={a} rotation={[0, a, 0]}>
          {[-1, 1].map((s) => (
            <mesh
              key={s}
              position={[s * (HALL.width / 2 + 0.08), HALL.height / 2, R]}
              material={mats.rib}
            >
              <boxGeometry args={[0.16, HALL.height, 0.2]} />
            </mesh>
          ))}
          <mesh position={[0, HALL.height + 0.08, R]} material={mats.rib}>
            <boxGeometry args={[HALL.width + 0.32, 0.16, 0.2]} />
          </mesh>
          {/* Fill above and beside the opening. */}
          <mesh position={[0, (HALL.height + Ht) / 2 + 0.08, R]} material={mats.wall}>
            <boxGeometry args={[sideLen, Ht - HALL.height - 0.16, 0.1]} />
          </mesh>
          <mesh position={[0, 0.02, R - 0.2]} material={mats.accent}>
            <boxGeometry args={[HALL.width, 0.005, 0.04]} />
          </mesh>
        </group>
      ))}
      {/* The hatch: a round frame in the +z opening. */}
      <mesh position={[0, HATCH.centreY - FLOOR_Y, R + 0.05]} material={mats.rib}>
        <torusGeometry args={[0.95, 0.07, 10, 48]} />
      </mesh>
      {/* Centre table with a small hologram of the belt. */}
      <mesh position={[0, 0.45, 0]} material={mats.rib}>
        <cylinderGeometry args={[0.45, 0.55, 0.9, 24]} />
      </mesh>
      <mesh position={[0, 0.91, 0]} material={mats.accent}>
        <cylinderGeometry args={[0.42, 0.42, 0.02, 32]} />
      </mesh>
      <mesh position={[0, 1.15, 0]} rotation={[-Math.PI / 2, 0, 0]} material={mats.holo}>
        <ringGeometry args={[0.25, 0.32, 48]} />
      </mesh>
      <mesh position={[0, 1.15, 0]} material={mats.holo}>
        <sphereGeometry args={[0.07, 16, 12]} />
      </mesh>
      <pointLight position={[0, Ht - 0.5, 0]} intensity={4} distance={6} color={0xdfe8ff} />
    </group>
  );
}
