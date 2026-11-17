// A hallway from the hub to a room: windows onto space along one side, moving
// control panels and a ledge of switches along the other, light strips in the
// ceiling. Mission Control's hallway also has status screens for each
// asteroid building (counts and status only). The Vault's has hazard stripes
// before its door. Station coordinates are set by the parent; this hallway
// runs along x from `fromX` to `toX` at z = HALL.z.
import { useEffect, useMemo } from "react";
import * as THREE from "three";

import type { HallwayRow } from "../belt/hallwayStatus";
import { FLOOR_Y, HALL } from "./stationLayout";
import { WallPanel } from "./WallPanels";

const WINDOW_W = 1.0;
const SILL = 0.8;
const LINTEL = 2.0;

function statusTexture(
  title: string,
  text: string,
  tint: string,
  bad: boolean,
): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 256;
  const g = c.getContext("2d");
  if (!g) throw new Error("This browser can't draw 2D canvases.");
  g.fillStyle = "#070b16";
  g.fillRect(0, 0, 512, 256);
  g.strokeStyle = "rgba(138, 164, 255, 0.4)";
  g.lineWidth = 4;
  g.strokeRect(8, 8, 496, 240);
  g.fillStyle = tint;
  g.beginPath();
  g.arc(48, 70, 14, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "#f5f5f7";
  g.font = "700 40px -apple-system, 'Helvetica Neue', Arial, sans-serif";
  let t = title;
  while (g.measureText(t).width > 420 && t.length > 1) t = t.slice(0, -2) + "…";
  g.fillText(t, 76, 84);
  g.fillStyle = bad ? "#ffb340" : "#30d158";
  g.font = "600 34px -apple-system, 'Helvetica Neue', Arial, sans-serif";
  g.fillText(text, 36, 170);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function StatusScreen({
  title,
  text,
  tint,
  bad,
  ...rest
}: { title: string; text: string; tint: string; bad: boolean } & {
  position: [number, number, number];
  rotation?: [number, number, number];
}) {
  const { tex, mat, frame } = useMemo(() => {
    const tex = statusTexture(title, text, tint, bad);
    return {
      tex,
      mat: new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }),
      frame: new THREE.MeshStandardMaterial({ color: 0x1a1e27, roughness: 0.45, metalness: 0.7 }),
    };
  }, [title, text, tint, bad]);
  useEffect(
    () => () => {
      tex.dispose();
      mat.dispose();
      frame.dispose();
    },
    [tex, mat, frame],
  );
  return (
    <group {...rest}>
      <mesh position={[0, 0, -0.015]} material={frame}>
        <boxGeometry args={[0.66, 0.36, 0.03]} />
      </mesh>
      <mesh material={mat}>
        <planeGeometry args={[0.6, 0.3]} />
      </mesh>
    </group>
  );
}

export function Hallway({
  fromX,
  toX,
  tint,
  vault,
  rows = [],
  summary,
  tintOf,
}: {
  fromX: number;
  toX: number;
  tint: string;
  /** The Vault's hallway: hazard stripes before the door, gold trim. */
  vault: boolean;
  /** Mission Control's hallway: one status screen per asteroid building. */
  rows?: readonly HallwayRow[];
  /** Mission Control's to-do summary ("2 overdue · 5 open"). */
  summary?: string;
  tintOf: (id: HallwayRow["id"]) => string;
}) {
  const mats = useMemo(() => {
    const t = new THREE.Color(tint);
    return {
      wall: new THREE.MeshStandardMaterial({ color: 0x252b38, roughness: 0.65, metalness: 0.45 }),
      rib: new THREE.MeshStandardMaterial({ color: 0x3a4152, roughness: 0.4, metalness: 0.8 }),
      floor: new THREE.MeshStandardMaterial({ color: 0x14171e, roughness: 0.75, metalness: 0.4 }),
      ceiling: new THREE.MeshStandardMaterial({ color: 0x1c212b, roughness: 0.7, metalness: 0.4 }),
      strip: new THREE.MeshBasicMaterial({
        color: t.clone().multiplyScalar(1.3),
        toneMapped: false,
      }),
      light: new THREE.MeshBasicMaterial({
        color: new THREE.Color(0xeaf0ff).multiplyScalar(1.4),
        toneMapped: false,
      }),
      glass: new THREE.MeshBasicMaterial({
        color: 0x9fb6ff,
        transparent: true,
        opacity: 0.06,
        depthWrite: false,
      }),
      ledge: new THREE.MeshStandardMaterial({ color: 0x2d3444, roughness: 0.55, metalness: 0.6 }),
      led: [0x30d158, 0xffb340, 0x64d2ff, 0xff453a].map(
        (c) =>
          new THREE.MeshBasicMaterial({
            color: new THREE.Color(c).multiplyScalar(1.3),
            toneMapped: false,
          }),
      ),
      hazard: new THREE.MeshStandardMaterial({
        color: 0xffb340,
        roughness: 0.6,
        emissive: 0x3a2400,
      }),
      dark: new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.6 }),
      gold: new THREE.MeshStandardMaterial({ color: 0xd19a35, roughness: 0.3, metalness: 1 }),
    };
  }, [tint]);
  useEffect(
    () => () =>
      Object.values(mats).forEach((m) =>
        Array.isArray(m) ? m.forEach((x) => x.dispose()) : m.dispose(),
      ),
    [mats],
  );

  const dir = Math.sign(toX - fromX);
  const len = Math.abs(toX - fromX);
  const mid = (fromX + toX) / 2;
  const { width: Wd, height: Ht, z } = HALL;
  const back = z - Wd / 2; // window side
  const front = z + Wd / 2; // panel side
  const windows = useMemo(() => {
    const n = Math.floor((len - 0.6) / (WINDOW_W + 0.4));
    const step = len / n;
    return Array.from({ length: n }, (_, i) => fromX + dir * (step * (i + 0.5)));
  }, [len, fromX, dir]);
  const panels = useMemo(() => {
    const n = Math.max(3, Math.floor(len / 1.25));
    return Array.from({ length: n }, (_, i) => fromX + dir * ((len / n) * (i + 0.5)));
  }, [len, fromX, dir]);
  const screens = rows.slice(0, 7);

  return (
    <group position={[0, FLOOR_Y, 0]}>
      {/* Floor with tint guide lines, and the ceiling with a light strip. */}
      <mesh position={[mid, -0.05, z]} material={mats.floor} receiveShadow>
        <boxGeometry args={[len, 0.1, Wd]} />
      </mesh>
      {[-1, 1].map((s) => (
        <mesh key={s} position={[mid, 0.003, z + s * (Wd / 2 - 0.12)]} material={mats.strip}>
          <boxGeometry args={[len, 0.004, 0.025]} />
        </mesh>
      ))}
      <mesh position={[mid, Ht + 0.05, z]} material={mats.ceiling}>
        <boxGeometry args={[len, 0.1, Wd]} />
      </mesh>
      <mesh position={[mid, Ht - 0.005, z]} material={mats.light}>
        <boxGeometry args={[len - 0.4, 0.01, 0.16]} />
      </mesh>

      {/* Window side: a low wall, a lintel, pillars between the windows, faint glass. */}
      <mesh position={[mid, SILL / 2, back]} material={mats.wall}>
        <boxGeometry args={[len, SILL, 0.1]} />
      </mesh>
      <mesh position={[mid, (LINTEL + Ht) / 2, back]} material={mats.wall}>
        <boxGeometry args={[len, Ht - LINTEL, 0.1]} />
      </mesh>
      {windows.map((x, i) => (
        <group key={i}>
          <mesh position={[x, (SILL + LINTEL) / 2, back + 0.01]} material={mats.glass}>
            <planeGeometry args={[WINDOW_W, LINTEL - SILL]} />
          </mesh>
          {[-1, 1].map((s) => (
            <mesh
              key={s}
              position={[x + s * (WINDOW_W / 2 + 0.12), (SILL + LINTEL) / 2, back]}
              material={mats.rib}
            >
              <boxGeometry args={[0.24, LINTEL - SILL, 0.14]} />
            </mesh>
          ))}
        </group>
      ))}
      {/* Fill between the last window and each end. */}
      {[fromX, toX].map((xEnd, i) => {
        const nearest = i === 0 ? windows[0] : windows[windows.length - 1];
        if (nearest === undefined) return null;
        const a = nearest + (i === 0 ? -dir : dir) * (WINDOW_W / 2 + 0.24);
        const w = Math.abs(xEnd - a);
        if (w < 0.01) return null;
        return (
          <mesh key={i} position={[(a + xEnd) / 2, (SILL + LINTEL) / 2, back]} material={mats.wall}>
            <boxGeometry args={[w, LINTEL - SILL, 0.1]} />
          </mesh>
        );
      })}

      {/* Panel side: solid wall, moving panels, a ledge of switches and lights. */}
      <mesh position={[mid, Ht / 2, front]} material={mats.wall}>
        <boxGeometry args={[len, Ht, 0.1]} />
      </mesh>
      {panels.map((x, i) => (
        <WallPanel
          key={i}
          kind={i % 2 ? "wave" : "bars"}
          width={0.5}
          height={0.75}
          position={[x, 1.45, front - 0.06]}
          rotation={[0, Math.PI, 0]}
        />
      ))}
      <mesh position={[mid, 0.95, front - 0.16]} rotation={[0.35, 0, 0]} material={mats.ledge}>
        <boxGeometry args={[len - 0.6, 0.04, 0.26]} />
      </mesh>
      {Array.from({ length: Math.floor(len * 5) }, (_, i) => {
        const x = fromX + dir * (0.4 + i * 0.2);
        return (
          <mesh key={i} position={[x, 0.99, front - 0.2]} material={mats.led[i % 4]}>
            <boxGeometry args={[0.04, 0.012, 0.04]} />
          </mesh>
        );
      })}
      {/* Ribs across the hallway every so often. */}
      {panels.map((x, i) => (
        <group key={`r${i}`} position={[x + dir * 0.62, 0, z]}>
          <mesh position={[0, Ht - 0.06, 0]} material={mats.rib}>
            <boxGeometry args={[0.1, 0.12, Wd]} />
          </mesh>
          <mesh position={[0, Ht / 2, Wd / 2 - 0.1]} material={mats.rib}>
            <boxGeometry args={[0.1, Ht, 0.12]} />
          </mesh>
        </group>
      ))}

      {/* Mission Control: status screens above the panels, one per asteroid building. */}
      {screens.map((r, i) => {
        const x = fromX + dir * ((len / (screens.length + 1)) * (i + 1));
        return (
          <StatusScreen
            key={r.id}
            title={r.name}
            text={r.text}
            tint={tintOf(r.id)}
            bad={r.text !== "Ready"}
            position={[x, 2.05, front - 0.07]}
            rotation={[0.15, Math.PI, 0]}
          />
        );
      })}
      {summary && (
        <StatusScreen
          title="To-do"
          text={summary}
          tint={tint}
          bad={summary.includes("overdue")}
          position={[toX - dir * 0.6, 1.5, back + 0.08]}
          rotation={[0, 0, 0]}
        />
      )}

      {/* The Vault: hazard stripes on the floor before the door, gold trim on the ribs. */}
      {vault && (
        <group position={[toX - dir * 0.55, 0.004, z]}>
          {Array.from({ length: 7 }, (_, i) => (
            <mesh
              key={i}
              position={[0, 0, -Wd / 2 + 0.2 + i * 0.25]}
              rotation={[0, 0.6, 0]}
              material={i % 2 ? mats.dark : mats.hazard}
            >
              <boxGeometry args={[0.6, 0.004, 0.13]} />
            </mesh>
          ))}
          <mesh position={[0, Ht - 0.13, 0]} material={mats.gold}>
            <boxGeometry args={[0.12, 0.05, Wd]} />
          </mesh>
        </group>
      )}

      <pointLight position={[mid, Ht - 0.4, z]} intensity={4} distance={7} color={0xdfe8ff} />
    </group>
  );
}
