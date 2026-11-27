// Moving wall panels for the station: bar meters, level gauges, a scrolling
// waveform and a grid of status lights. Two shared textures are redrawn about
// ten times a second (scaled by LOOK.station.wallPanelMotion) and used by every
// panel, so many panels cost the same as two.
import { useFrame, type ThreeElements } from "@react-three/fiber";
import { createContext, useContext, useEffect, useMemo, useRef, type ReactNode } from "react";
import * as THREE from "three";

import { shouldAnimate } from "../belt/hold";
import { useHold } from "../belt/HoldContext";

import { LOOK, motionScale } from "../belt/look";

type PanelTextures = { bars: THREE.CanvasTexture; wave: THREE.CanvasTexture };
const Ctx = createContext<PanelTextures | null>(null);

const W = 256;
const H = 384;

function canvas() {
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const g = c.getContext("2d");
  if (!g) throw new Error("This browser can't draw 2D canvases.");
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return { g, t };
}

function frame(g: CanvasRenderingContext2D) {
  g.fillStyle = "#070b16";
  g.fillRect(0, 0, W, H);
  g.strokeStyle = "rgba(138, 164, 255, 0.35)";
  g.lineWidth = 3;
  g.strokeRect(6, 6, W - 12, H - 12);
}

function drawBars(g: CanvasRenderingContext2D, t: number) {
  frame(g);
  // Eight bar meters.
  for (let i = 0; i < 8; i++) {
    const v = 0.5 + 0.45 * Math.sin(t * (0.9 + i * 0.37) + i * 1.7) * Math.cos(t * 0.31 + i);
    const x = 22 + i * 27;
    g.fillStyle = "rgba(255, 255, 255, 0.07)";
    g.fillRect(x, 24, 18, 170);
    g.fillStyle = v > 0.8 ? "#ff9f43" : i % 3 === 0 ? "#64d2ff" : "#30d158";
    g.fillRect(x, 24 + 170 * (1 - v), 18, 170 * v);
  }
  // Two level gauges (half dials with needles).
  for (let k = 0; k < 2; k++) {
    const cx = 70 + k * 116;
    const cy = 290;
    g.strokeStyle = "rgba(245, 245, 247, 0.35)";
    g.lineWidth = 5;
    g.beginPath();
    g.arc(cx, cy, 44, Math.PI, 0);
    g.stroke();
    const a = Math.PI + (0.5 + 0.4 * Math.sin(t * (0.6 + k * 0.5) + k)) * Math.PI;
    g.strokeStyle = k ? "#ffb340" : "#8aa4ff";
    g.lineWidth = 4;
    g.beginPath();
    g.moveTo(cx, cy);
    g.lineTo(cx + Math.cos(a) * 40, cy + Math.sin(a) * 40);
    g.stroke();
  }
  // Status lights row.
  for (let i = 0; i < 8; i++) {
    const on = Math.sin(t * 2.1 + i * 2.3) > 0.1;
    g.fillStyle = on ? (i % 4 === 0 ? "#ff453a" : "#30d158") : "rgba(255, 255, 255, 0.12)";
    g.beginPath();
    g.arc(28 + i * 28, 350, 7, 0, Math.PI * 2);
    g.fill();
  }
}

function drawWave(g: CanvasRenderingContext2D, t: number) {
  frame(g);
  // Scrolling waveform.
  g.strokeStyle = "rgba(100, 210, 255, 0.25)";
  g.lineWidth = 1;
  for (let y = 40; y < 170; y += 26) {
    g.beginPath();
    g.moveTo(16, y);
    g.lineTo(W - 16, y);
    g.stroke();
  }
  g.strokeStyle = "#64d2ff";
  g.lineWidth = 3;
  g.beginPath();
  for (let x = 16; x < W - 16; x += 3) {
    const y =
      105 +
      Math.sin(x * 0.07 + t * 4) * 28 * Math.sin(x * 0.013 + t * 0.7) +
      Math.sin(x * 0.31 + t * 9) * 5;
    if (x === 16) g.moveTo(x, y);
    else g.lineTo(x, y);
  }
  g.stroke();
  // Grid of status cells.
  for (let r = 0; r < 5; r++) {
    for (let c = 0; c < 6; c++) {
      const v = Math.sin(t * 0.8 + r * 1.3 + c * 2.1);
      g.fillStyle =
        v > 0.6 ? "#ffb340" : v > -0.2 ? "rgba(48, 209, 88, 0.85)" : "rgba(255, 255, 255, 0.1)";
      g.fillRect(22 + c * 37, 200 + r * 34, 28, 24);
    }
  }
}

/** Provides the two shared, moving panel textures to every <WallPanel> inside. */
export function PanelTexturesProvider({ children }: { children: ReactNode }) {
  const reducedMotion = useMemo(() => matchMedia("(prefers-reduced-motion: reduce)").matches, []);
  const parts = useMemo(() => ({ bars: canvas(), wave: canvas() }), []);
  useEffect(
    () => () => {
      parts.bars.t.dispose();
      parts.wave.t.dispose();
    },
    [parts],
  );
  const next = useRef(0);
  const hold = useHold();
  useFrame((state) => {
    if (!shouldAnimate({ hold, inView: true, keepMoving: false })) return;
    const now = state.clock.elapsedTime;
    if (now < next.current) return;
    next.current = now + 0.1;
    const t = now * LOOK.station.wallPanelMotion * motionScale(reducedMotion);
    drawBars(parts.bars.g, t);
    drawWave(parts.wave.g, t);
    parts.bars.t.needsUpdate = true;
    parts.wave.t.needsUpdate = true;
  });
  const value = useMemo(() => ({ bars: parts.bars.t, wave: parts.wave.t }), [parts]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** One glowing panel showing the bars or wave texture, with a dark frame. Faces +z. */
export function WallPanel({
  kind,
  width = 0.6,
  height = 0.9,
  ...rest
}: {
  kind: "bars" | "wave";
  width?: number;
  height?: number;
} & ThreeElements["group"]) {
  const tex = useContext(Ctx);
  const mats = useMemo(
    () => ({
      screen: new THREE.MeshBasicMaterial({ map: tex?.[kind] ?? null, toneMapped: false }),
      frame: new THREE.MeshStandardMaterial({ color: 0x1a1e27, roughness: 0.45, metalness: 0.7 }),
    }),
    [tex, kind],
  );
  useEffect(() => () => Object.values(mats).forEach((m) => m.dispose()), [mats]);
  return (
    <group {...rest}>
      <mesh position={[0, 0, -0.012]} material={mats.frame}>
        <boxGeometry args={[width + 0.06, height + 0.06, 0.03]} />
      </mesh>
      <mesh position={[0, 0, 0.004]} material={mats.screen}>
        <planeGeometry args={[width, height]} />
      </mesh>
    </group>
  );
}
