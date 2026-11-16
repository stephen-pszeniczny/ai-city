// Level 1, the belt: space, the station and the seven asteroid buildings.
// Clicking a building calls onOpen(id). Each frame it also moves the glass
// labels (plain page elements, see Labels.tsx) to follow their buildings.
import { useQuery } from "@tanstack/react-query";
import { createPortal, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { useEffect, useMemo, useState, type RefObject } from "react";
import * as THREE from "three";

import { getBuildings, listTasks, type BuildingId } from "../api";
import type { ScreenContent } from "../interior/Monitor";
import { statusNotes, type Tone } from "../todo/dates";
import { BUILT } from "./built";
import { AsteroidDesk } from "../interior/AsteroidDesk";
import { ControlStation } from "../interior/ControlStation";
import { createAsteroids, DECK_Y } from "./asteroids";
import type { SceneApi } from "./CameraRig";
import type { View } from "./levels";
import { tintOf } from "./tints";
import type { LabelElements } from "./Labels";
import { createKit } from "./materials";
import { createSpace, type Space } from "./space";
import { createStation } from "./station";

const TONE_COLOURS: Record<Tone, string> = {
  bad: "#ff453a",
  warn: "#ffb340",
  accent: "#8aa4ff",
  plain: "#f5f5f7",
  muted: "#98989f",
};
const CONSTRUCTION: ScreenContent = { kind: "construction" };

/** Pointer movement (px) below which a press counts as a click, not a drag. */
const CLICK_SLOP = 5;

export function BeltScene({
  view,
  onOpen,
  labels,
  api,
}: {
  view: View;
  onOpen: (id: BuildingId) => void;
  labels: RefObject<LabelElements>;
  /** Filled in for the camera rig: where each building is, this frame. */
  api: RefObject<SceneApi | null>;
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

  // Inside Mission Control or the Vault: build that control station, and hide
  // the station's outside (its truss runs right through the module, and the
  // window looks away from the station anyway).
  const insideModule =
    view.level !== "belt" && (view.id === "planner" || view.id === "finance") ? view.id : null;
  useEffect(() => {
    world.station.group.visible = insideModule === null;
  }, [insideModule, world]);
  // On an asteroid: its landmark/hologram/worksite make way for the robot's desk.
  const insideAsteroid =
    view.level !== "belt" && !insideModule
      ? world.asteroids.find((a) => a.id === view.id)
      : undefined;
  useEffect(() => {
    for (const a of world.asteroids) a.holder.visible = a !== insideAsteroid;
  }, [insideAsteroid, world]);
  const buildings = useQuery({
    queryKey: ["buildings"],
    queryFn: getBuildings,
    staleTime: Infinity,
  });
  const titleOf = (id: BuildingId) => buildings.data?.find((b) => b.id === id)?.name ?? "";

  // What each robot's screen shows: Mission Control's live open tasks; an
  // under-construction desktop for anything not built.
  const openTasks = useQuery({ queryKey: ["tasks", "open"], queryFn: () => listTasks("open") });
  const plannerScreen = useMemo<ScreenContent>(
    () => ({
      kind: "lines",
      lines: (openTasks.data ?? []).map((t) => {
        const note = statusNotes(t)[0];
        return {
          title: t.title,
          note: note?.text,
          noteColour: note ? TONE_COLOURS[note.tone] : undefined,
        };
      }),
    }),
    [openTasks.data],
  );
  const screenFor = (id: BuildingId): ScreenContent =>
    id === "planner" ? plannerScreen : BUILT.has(id) ? { kind: "lines", lines: [] } : CONSTRUCTION;
  const atScreen = view.level === "screen";

  useEffect(() => {
    const modules = {
      planner: new THREE.Vector3(-10.5, 0, 0),
      finance: new THREE.Vector3(10.5, 0, 0),
    };
    api.current = {
      locate(id, out) {
        if (id === "planner" || id === "finance") return out.copy(modules[id]);
        const a = world.asteroids.find((x) => x.id === id);
        return a ? out.copy(a.group.position) : out.set(0, 0, 0);
      },
      deckToWorld(id, local, out) {
        const a = world.asteroids.find((x) => x.id === id);
        if (!a) return out.set(0, 0, 0);
        a.spin.updateWorldMatrix(true, false);
        return a.spin.localToWorld(out.copy(local).setY(local.y + DECK_Y));
      },
    };
    return () => {
      api.current = null;
    };
  }, [api, world]);

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
      {insideModule && (
        <group position={[insideModule === "planner" ? -10.5 : 10.5, 0, 0]}>
          <ControlStation
            title={titleOf(insideModule)}
            tint={tintOf(insideModule)}
            content={screenFor(insideModule)}
            atScreen={atScreen}
            onOpenScreen={() => onOpen(insideModule)}
          />
        </group>
      )}
      {insideAsteroid &&
        createPortal(
          <group position={[0, DECK_Y, 0]}>
            <AsteroidDesk
              title={titleOf(insideAsteroid.id)}
              tint={tintOf(insideAsteroid.id)}
              content={screenFor(insideAsteroid.id)}
              atScreen={atScreen}
              sign={insideAsteroid.deskSign}
              onOpenScreen={() => onOpen(insideAsteroid.id)}
            />
          </group>,
          insideAsteroid.spin,
        )}
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
