// The robot's computer screen in the building view: a bezel with a glowing
// screen. Until the live desktop arrives (plan Task 8) it shows a desktop-like
// placeholder with the building's name and abstract lines (never real data).
import { useEffect, useMemo } from "react";
import * as THREE from "three";

/** Screen size in scene units (16:10), shared with the camera and Task 8. */
export const SCREEN = { width: 1.28, height: 0.8 } as const;

function screenTexture(title: string, tint: string): THREE.CanvasTexture {
  const w = 1024;
  const h = 640;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d");
  if (!g) throw new Error("This browser can't draw 2D canvases.");
  const bg = g.createRadialGradient(w * 0.8, h * 1.1, 10, w * 0.8, h * 1.1, w);
  bg.addColorStop(0, "#2a46b8");
  bg.addColorStop(1, "#060a18");
  g.fillStyle = bg;
  g.fillRect(0, 0, w, h);
  // Menu bar.
  g.fillStyle = "rgba(10, 14, 28, 0.8)";
  g.fillRect(0, 0, w, 40);
  g.fillStyle = "#f5f5f7";
  g.font = "600 22px -apple-system, 'Helvetica Neue', Arial, sans-serif";
  g.fillText(title, 24, 28);
  // A window with abstract list lines.
  g.fillStyle = "rgba(18, 20, 30, 0.92)";
  g.fillRect(200, 80, 624, 470);
  g.fillStyle = "rgba(255, 255, 255, 0.06)";
  g.fillRect(200, 80, 624, 40);
  for (let i = 0; i < 7; i++) {
    const y = 150 + i * 54;
    g.strokeStyle = "rgba(255, 255, 255, 0.35)";
    g.lineWidth = 3;
    g.beginPath();
    g.arc(236, y, 11, 0, Math.PI * 2);
    g.stroke();
    g.fillStyle = "rgba(245, 245, 247, 0.55)";
    g.fillRect(262, y - 8, 200 + ((i * 97) % 220), 12);
    g.fillStyle = tint;
    g.globalAlpha = 0.6;
    g.fillRect(262, y + 10, 70, 8);
    g.globalAlpha = 1;
  }
  // Dock.
  g.fillStyle = "rgba(255, 255, 255, 0.1)";
  g.fillRect(392, 576, 240, 50);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

export function Monitor({ title, tint }: { title: string; tint: string }) {
  const { texture, screenMat, bezelMat } = useMemo(() => {
    const texture = screenTexture(title, tint);
    return {
      texture,
      screenMat: new THREE.MeshBasicMaterial({ map: texture, toneMapped: false }),
      bezelMat: new THREE.MeshStandardMaterial({ color: 0x0d0f14, roughness: 0.4, metalness: 0.6 }),
    };
  }, [title, tint]);
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
