// Level 1, the belt: space, the station and the seven asteroid buildings.
// Clicking a building calls onOpen(id). Each frame it also moves the glass
// labels (plain page elements, see Labels.tsx) to follow their buildings.
import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { useEffect, useMemo, useState, type RefObject } from "react";
import * as THREE from "three";

import type { BuildingId } from "../api";
import { createAsteroids } from "./asteroids";
import type { LabelElements } from "./Labels";
import { createKit } from "./materials";
import { createSpace, type Space } from "./space";
import { createStation } from "./station";

/** Pointer movement (px) below which a press counts as a click, not a drag. */
const CLICK_SLOP = 5;

export function BeltScene({
  onOpen,
  labels,
}: {
  onOpen: (id: BuildingId) => void;
  labels: RefObject<LabelElements>;
}) {
  const { scene, gl } = useThree();
  const reducedMotion = useMemo(() => matchMedia("(prefers-reduced-motion: reduce)").matches, []);

  // Plain objects only (nothing is added to the scene here), so it's safe for
  // React to run this more than once in development.
  const world = useMemo(() => {
    const kit = createKit();
    return { kit, station: createStation(kit), asteroids: createAsteroids(kit) };
  }, []);
  useEffect(
    () => () => {
      for (const g of [world.station.group, ...world.asteroids.map((a) => a.group)]) disposeTree(g);
      world.kit.dispose();
    },
    [world],
  );

  // Created in an effect (not useMemo): it adds itself to the scene, and React
  // may run memo code twice in development, which would leave a stray copy.
  const [space, setSpace] = useState<Space | null>(null);
  useEffect(() => {
    const s = createSpace(scene, gl, { reducedMotion });
    setSpace(s);
    return () => s.dispose();
  }, [scene, gl, reducedMotion]);

  const anchors = useMemo(
    () => [
      {
        id: "planner" as BuildingId,
        obj: world.station.group,
        local: world.station.anchors.planner,
      },
      {
        id: "finance" as BuildingId,
        obj: world.station.group,
        local: world.station.anchors.finance,
      },
      ...world.asteroids.map((a) => ({
        id: a.id,
        obj: a.group as THREE.Object3D,
        local: a.anchor,
      })),
    ],
    [world],
  );
  const v = useMemo(() => new THREE.Vector3(), []);

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    if (space) {
      space.update(t);
      world.station.update(t);
      for (const a of world.asteroids) a.update(t, space.orbitSpeed, state.camera);
      world.kit.updateBlinkers(t);
    }
    // Labels follow their buildings; hidden when behind the camera or far off screen.
    const { width, height } = state.size;
    for (const { id, obj, local } of anchors) {
      const el = labels.current.get(id);
      if (!el) continue;
      obj.updateMatrixWorld();
      v.copy(local).applyMatrix4(obj.matrixWorld).project(state.camera);
      const visible = v.z < 1 && Math.abs(v.x) < 1.2 && Math.abs(v.y) < 1.2;
      el.style.visibility = visible ? "visible" : "hidden";
      if (!visible) continue;
      const x = ((v.x + 1) / 2) * width;
      const y = ((1 - v.y) / 2) * height;
      el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) translate(-50%, -100%)`;
      el.style.zIndex = String(Math.round((1 - v.z) * 10000)); // nearer labels on top
    }
  });

  const click = (e: ThreeEvent<MouseEvent>) => {
    if (e.delta > CLICK_SLOP) return; // that was a drag to rotate the view
    const id = e.object.userData.buildingId as BuildingId | undefined;
    if (!id) return;
    e.stopPropagation();
    onOpen(id);
  };
  const hover = (on: boolean) => (e: ThreeEvent<PointerEvent>) => {
    if (e.object.userData.buildingId) gl.domElement.style.cursor = on ? "pointer" : "";
  };
  const events = { onClick: click, onPointerOver: hover(true), onPointerOut: hover(false) };

  return (
    <>
      <primitive object={world.station.group} {...events} />
      {world.asteroids.map((a) => (
        <primitive key={a.id} object={a.group} {...events} />
      ))}
    </>
  );
}

function disposeTree(root: THREE.Object3D) {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const m = mesh.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(m)) m.forEach((x) => x.dispose());
    else m?.dispose();
  });
}
