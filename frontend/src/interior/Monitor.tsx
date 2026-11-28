// The robot's computer screen in the building view: a slim monitor whose
// screen shows what the robot is working on (tabs, progress, log, chart; for
// Mission Control the real open tasks). It redraws as the robot types and
// switches tabs, at most a few times a second. Look-only: "Use the computer"
// opens the real, typeable desktop.
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";

import { shouldAnimate } from "../belt/hold";
import { useHold } from "../belt/HoldContext";
import { SCREEN } from "./deskSize";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";

import type { BuildingId } from "../api";
import type { RobotBrain } from "./robotBrain";
import { useLiveStat } from "./useLiveStat";
import { workScreen, type WorkScreen } from "./workScreen";

/** Screen size in scene units (16:10), shared with the camera and the desktop overlay. */
export { SCREEN };

/** One task row drawn on the screen. */

const W = 1024;
const H = 640;
const MIN_REDRAW_MS = 250;

const font = (weight: number, size: number) =>
  `${weight} ${size}px -apple-system, 'Helvetica Neue', Arial, sans-serif`;

function fit(g: CanvasRenderingContext2D, text: string, max: number): string {
  let t = text;
  while (g.measureText(t).width > max && t.length > 1) t = t.slice(0, -2) + "…";
  return t;
}

function draw(
  g: CanvasRenderingContext2D,
  title: string,
  tint: string,
  s: WorkScreen,
  typing: boolean,
) {
  const bg = g.createRadialGradient(W * 0.8, H * 1.1, 10, W * 0.8, H * 1.1, W);
  bg.addColorStop(0, "#2a46b8");
  bg.addColorStop(1, "#060a18");
  g.fillStyle = bg;
  g.fillRect(0, 0, W, H);

  // Menu bar.
  g.fillStyle = "rgba(10, 14, 28, 0.85)";
  g.fillRect(0, 0, W, 36);
  g.fillStyle = "#f5f5f7";
  g.font = font(600, 20);
  g.textAlign = "left";
  g.fillText(title, 20, 25);
  g.fillStyle = tint;
  g.beginPath();
  g.arc(W - 30, 18, 6, 0, Math.PI * 2);
  g.fill();

  // Window with traffic lights and the tab strip.
  const x0 = 70;
  const y0 = 60;
  const ww = W - 140;
  const wh = H - 140;
  g.fillStyle = "rgba(16, 18, 28, 0.94)";
  g.fillRect(x0, y0, ww, wh);
  g.fillStyle = "rgba(255, 255, 255, 0.06)";
  g.fillRect(x0, y0, ww, 44);
  ["#ff5f57", "#febc2e", "#28c840"].forEach((c, i) => {
    g.fillStyle = c;
    g.beginPath();
    g.arc(x0 + 22 + i * 22, y0 + 22, 7, 0, Math.PI * 2);
    g.fill();
  });
  s.tabs.forEach((tab, i) => {
    const tx = x0 + 110 + i * 170;
    const on = i === s.active;
    g.fillStyle = on ? "rgba(138, 164, 255, 0.28)" : "rgba(255, 255, 255, 0.05)";
    g.fillRect(tx, y0 + 8, 160, 30);
    if (on) {
      g.fillStyle = tint;
      g.fillRect(tx, y0 + 36, 160, 3);
    }
    g.fillStyle = on ? "#f5f5f7" : "rgba(245, 245, 247, 0.55)";
    g.font = font(600, 17);
    g.fillText(fit(g, tab, 140), tx + 12, y0 + 29);
  });

  const cx = x0 + 24;
  const cy = y0 + 70;
  if (s.live) {
    // The building's live counts: a big headline and a moving gauge (never names or amounts).
    g.fillStyle = "#f5f5f7";
    g.font = font(700, 44);
    g.fillText(fit(g, s.live.headline, 520), cx, cy + 46);
    const gx = x0 + ww - 150;
    const gy = cy + 120;
    const phase = (s.progress[0] ?? 0) * Math.PI * 2;
    g.lineWidth = 10;
    if (s.live.style === "ring") {
      g.strokeStyle = "rgba(255, 255, 255, 0.1)";
      g.beginPath();
      g.arc(gx, gy, 70, 0, Math.PI * 2);
      g.stroke();
      g.strokeStyle = tint;
      g.beginPath();
      g.arc(gx, gy, 70, phase, phase + Math.PI * 1.4);
      g.stroke();
    } else if (s.live.style === "bar") {
      g.fillStyle = "rgba(255, 255, 255, 0.1)";
      g.fillRect(cx, cy + 90, 420, 18);
      g.fillStyle = tint;
      g.fillRect(cx, cy + 90, 420 * (0.35 + 0.65 * (s.progress[0] ?? 0)), 18);
    } else {
      g.strokeStyle = "rgba(255, 255, 255, 0.15)";
      g.lineWidth = 2;
      [30, 55, 80].forEach((r) => {
        g.beginPath();
        g.arc(gx, gy, r, 0, Math.PI * 2);
        g.stroke();
      });
      g.strokeStyle = tint;
      g.lineWidth = 4;
      g.beginPath();
      g.moveTo(gx, gy);
      g.lineTo(gx + Math.cos(phase) * 80, gy + Math.sin(phase) * 80);
      g.stroke();
    }
  } else {
    // Progress bars.
    s.progress.forEach((v, i) => {
      const y = cy + i * 48;
      g.fillStyle = "rgba(245, 245, 247, 0.6)";
      g.font = font(500, 16);
      g.fillText(["Step", "Checks", "Sync"][i] ?? "", cx, y + 4);
      g.fillStyle = "rgba(255, 255, 255, 0.08)";
      g.fillRect(cx, y + 14, 380, 12);
      g.fillStyle = i === 0 ? tint : "#8aa4ff";
      g.fillRect(cx, y + 14, 380 * v, 12);
    });
    // Chart.
    const chx = cx + 440;
    const chw = 340;
    const chh = 130;
    g.fillStyle = "rgba(255, 255, 255, 0.04)";
    g.fillRect(chx, cy - 10, chw, chh + 20);
    const bw = chw / s.chart.length;
    s.chart.forEach((v, i) => {
      g.fillStyle = i === s.chart.length - 1 ? tint : "rgba(138, 164, 255, 0.75)";
      g.fillRect(chx + i * bw + 4, cy + chh - v * chh, bw - 8, v * chh);
    });
    // Log, newest last, with a typing cursor.
    g.font = font(500, 19);
    s.log.forEach((line, i) => {
      const y = cy + 175 + i * 32;
      const last = i === s.log.length - 1;
      g.fillStyle = last ? "#f5f5f7" : "rgba(245, 245, 247, 0.5)";
      g.fillText(`› ${line}`, cx, y);
      if (last && typing) {
        const w = g.measureText(`› ${line}`).width;
        g.fillStyle = tint;
        g.fillRect(cx + w + 6, y - 16, 10, 20);
      }
    });
  }

  if (s.construction) {
    // Hazard tape along the bottom of the window.
    g.save();
    g.beginPath();
    g.rect(x0, y0 + wh - 26, ww, 26);
    g.clip();
    g.fillStyle = "#1a1408";
    g.fillRect(x0, y0 + wh - 26, ww, 26);
    g.fillStyle = "#ffb340";
    for (let x = x0 - 30; x < x0 + ww; x += 40) {
      g.beginPath();
      g.moveTo(x, y0 + wh);
      g.lineTo(x + 20, y0 + wh - 26);
      g.lineTo(x + 40, y0 + wh - 26);
      g.lineTo(x + 20, y0 + wh);
      g.closePath();
      g.fill();
    }
    g.restore();
    g.fillStyle = "#ffb340";
    g.font = font(700, 16);
    g.textAlign = "right";
    g.fillText("UNDER CONSTRUCTION", x0 + ww - 16, y0 + 28);
    g.textAlign = "left";
  }

  // Dock.
  g.fillStyle = "rgba(255, 255, 255, 0.1)";
  g.fillRect(W / 2 - 110, H - 56, 220, 42);
  [tint, "#8aa4ff", "#55d39a", "#ffb340"].forEach((c, i) => {
    g.fillStyle = c;
    g.globalAlpha = 0.85;
    g.fillRect(W / 2 - 96 + i * 50, H - 48, 28, 28);
  });
  g.globalAlpha = 1;
}

export function Monitor({
  id,
  title,
  tint,
  built,
  brain,
  live = true,
}: {
  id: BuildingId;
  title: string;
  tint: string;
  built: boolean;
  brain: RobotBrain;
  /** Redraw as the robot works (off when far away: the last picture stays). */
  live?: boolean;
}) {
  const { g, texture, screenMat, bezelMat, standMat } = useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    const g = canvas.getContext("2d");
    if (!g) throw new Error("This browser can't draw 2D canvases.");
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 8;
    return {
      g,
      texture,
      screenMat: new THREE.MeshBasicMaterial({ map: texture, toneMapped: false }),
      bezelMat: new THREE.MeshStandardMaterial({
        color: 0x0d0f14,
        roughness: 0.35,
        metalness: 0.7,
      }),
      standMat: new THREE.MeshStandardMaterial({ color: 0x8c93a3, roughness: 0.3, metalness: 0.9 }),
    };
  }, []);
  useEffect(
    () => () => {
      texture.dispose();
      screenMat.dispose();
      bezelMat.dispose();
      standMat.dispose();
    },
    [texture, screenMat, bezelMat, standMat],
  );

  // The display's shapes (rounded, so it looks like a current monitor, not a box).
  const shapes = useMemo(() => {
    const { width, height } = SCREEN;
    return {
      bezel: new RoundedBoxGeometry(width + 0.03, height + 0.03, 0.022, 4, 0.012),
      back: new RoundedBoxGeometry(width * 0.96, height * 0.96, 0.026, 4, 0.02),
      arm: new RoundedBoxGeometry(0.1, 0.26, 0.014, 2, 0.006),
      base: new RoundedBoxGeometry(0.3, 0.012, 0.19, 3, 0.005),
    };
  }, []);
  useEffect(() => () => Object.values(shapes).forEach((g) => g.dispose()), [shapes]);

  const last = useRef({ key: "", at: 0 });
  const stat = useLiveStat(id);
  // Redraw straight away when the content (title, live counts) changes.
  useEffect(() => {
    last.current.key = "";
  }, [title, tint, built, stat?.headline]);

  const hold = useHold();
  useFrame(() => {
    if (!shouldAnimate({ hold, inView: true, keepMoving: false })) return;
    if (!live && last.current.key !== "") return;
    const s = brain.last;
    const typing = s.action === "type";
    const key = `${s.tick}:${typing}`;
    const now = performance.now();
    if (key === last.current.key || now - last.current.at < MIN_REDRAW_MS) return;
    last.current = { key, at: now };
    draw(g, title, tint, workScreen(id, built, s.tick, stat), typing);
    texture.needsUpdate = true;
  });

  const { width, height } = SCREEN;
  return (
    <group>
      {/* A modern display: thin rounded bezel, slim aluminium back, flat arm and base. */}
      <mesh material={bezelMat} castShadow geometry={shapes.bezel} />
      {/* Faces the robot (toward -z). */}
      <mesh position={[0, 0, -0.012]} rotation={[0, Math.PI, 0]} material={screenMat}>
        <planeGeometry args={[width, height]} />
      </mesh>
      <mesh position={[0, 0, 0.018]} material={standMat} geometry={shapes.back} />
      {/* Stand: a flat angled arm and a rounded base plate. */}
      <mesh
        position={[0, -height / 2 - 0.1, 0.09]}
        rotation={[-0.25, 0, 0]}
        material={standMat}
        geometry={shapes.arm}
      />
      <mesh position={[0, -height / 2 - 0.215, 0.12]} material={standMat} geometry={shapes.base} />
    </group>
  );
}
