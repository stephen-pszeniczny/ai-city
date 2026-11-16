// The robot's computer screen in the building view: a bezel with a glowing
// screen showing the building's live content, drawn as an image (this view is
// look-only; "Use the computer" opens the real, typeable desktop).
import { useEffect, useMemo } from "react";
import * as THREE from "three";

/** Screen size in scene units (16:10), shared with the camera and Task 8. */
export const SCREEN = { width: 1.28, height: 0.8 } as const;

/** One task row drawn on the building-view screen. */
export type ScreenLine = { title: string; note?: string; noteColour?: string };

/** What the screen shows: a building's live lines, or the under-construction desktop. */
export type ScreenContent = { kind: "lines"; lines: ScreenLine[] } | { kind: "construction" };

function screenTexture(title: string, tint: string, content: ScreenContent): THREE.CanvasTexture {
  const w = 1024;
  const h = 640;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d");
  if (!g) throw new Error("This browser can't draw 2D canvases.");
  const font = (weight: number, size: number) =>
    `${weight} ${size}px -apple-system, 'Helvetica Neue', Arial, sans-serif`;
  const bg = g.createRadialGradient(w * 0.8, h * 1.1, 10, w * 0.8, h * 1.1, w);
  bg.addColorStop(0, "#2a46b8");
  bg.addColorStop(1, "#060a18");
  g.fillStyle = bg;
  g.fillRect(0, 0, w, h);
  // Menu bar with the building's name.
  g.fillStyle = "rgba(10, 14, 28, 0.8)";
  g.fillRect(0, 0, w, 40);
  g.fillStyle = "#f5f5f7";
  g.font = font(600, 22);
  g.fillText(title, 24, 28);
  // Window.
  g.fillStyle = "rgba(18, 20, 30, 0.92)";
  g.fillRect(160, 76, 704, 486);
  g.fillStyle = "rgba(255, 255, 255, 0.06)";
  g.fillRect(160, 76, 704, 40);
  g.fillStyle = "#ff5f57";
  g.beginPath();
  g.arc(184, 96, 7, 0, Math.PI * 2);
  g.fill();

  if (content.kind === "construction") {
    g.fillStyle = "#ffb340";
    for (let x = 160; x < 864; x += 44) {
      g.beginPath();
      g.moveTo(x, 470);
      g.lineTo(x + 22, 470);
      g.lineTo(x + 2, 500);
      g.lineTo(x - 20, 500);
      g.closePath();
      g.fill();
    }
    g.textAlign = "center";
    g.fillStyle = "#f5f5f7";
    g.font = font(700, 54);
    g.fillText("Under construction", w / 2, 300);
    g.fillStyle = "rgba(245, 245, 247, 0.6)";
    g.font = font(500, 26);
    g.fillText("This building's screens arrive in a later phase.", w / 2, 360);
  } else {
    g.fillStyle = "rgba(245, 245, 247, 0.7)";
    g.font = font(600, 22);
    g.fillText("To-do", 470, 103);
    const rows = content.lines.slice(0, 7);
    if (rows.length === 0) {
      g.fillStyle = "rgba(245, 245, 247, 0.55)";
      g.font = font(500, 28);
      g.fillText("Nothing open.", 200, 180);
    }
    rows.forEach((row, i) => {
      const y = 160 + i * 56;
      g.strokeStyle = "rgba(255, 255, 255, 0.45)";
      g.lineWidth = 3;
      g.beginPath();
      g.arc(200, y, 12, 0, Math.PI * 2);
      g.stroke();
      g.fillStyle = "#f5f5f7";
      g.font = font(500, 26);
      let text = row.title;
      while (g.measureText(text).width > 420 && text.length > 1) text = text.slice(0, -2) + "…";
      g.fillText(text, 228, y + 9);
      if (row.note) {
        g.fillStyle = row.noteColour ?? "rgba(245, 245, 247, 0.6)";
        g.font = font(600, 20);
        g.fillText(row.note, 680, y + 8);
      }
    });
  }
  // Dock.
  g.textAlign = "left";
  g.fillStyle = "rgba(255, 255, 255, 0.1)";
  g.fillRect(392, 584, 240, 44);
  g.fillStyle = tint;
  g.globalAlpha = 0.8;
  g.fillRect(410, 592, 28, 28);
  g.globalAlpha = 1;
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

export function Monitor({
  title,
  tint,
  content,
}: {
  title: string;
  tint: string;
  content: ScreenContent;
}) {
  const { texture, screenMat, bezelMat } = useMemo(() => {
    const texture = screenTexture(title, tint, content);
    return {
      texture,
      screenMat: new THREE.MeshBasicMaterial({ map: texture, toneMapped: false }),
      bezelMat: new THREE.MeshStandardMaterial({ color: 0x0d0f14, roughness: 0.4, metalness: 0.6 }),
    };
  }, [title, tint, content]);
  useEffect(
    () => () => {
      texture.dispose();
      screenMat.dispose();
      bezelMat.dispose();
    },
    [texture, screenMat, bezelMat],
  );

  const { width, height } = SCREEN;
  return (
    <group>
      <mesh material={bezelMat} castShadow>
        <boxGeometry args={[width + 0.08, height + 0.08, 0.05]} />
      </mesh>
      {/* Faces the robot (toward -z). */}
      <mesh position={[0, 0, -0.026]} rotation={[0, Math.PI, 0]} material={screenMat}>
        <planeGeometry args={[width, height]} />
      </mesh>
      {/* Stand. */}
      <mesh position={[0, -height / 2 - 0.12, 0.03]} material={bezelMat}>
        <boxGeometry args={[0.08, 0.24, 0.05]} />
      </mesh>
    </group>
  );
}
