// Level 1, the belt: space, the station and the seven asteroid buildings.
// Clicking a building calls onOpen(id). Each frame it also moves the glass
// labels (plain page elements, see Labels.tsx) to follow their buildings.
import { useQuery } from "@tanstack/react-query";
import { createPortal, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";

import { useHold } from "./HoldContext";
import { Fragment, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import * as THREE from "three";

import { getBuildings, listTasks, type BuildingId } from "../api";
import { Shuttle } from "../notifications/Shuttle";
import { BUILT } from "./built";
import { flightState } from "./flightState";
import { AsteroidDesk } from "../interior/AsteroidDesk";
import { StationInterior } from "../interior/StationInterior";
import { hallwayStatus } from "./hallwayStatus";
import { createAsteroids, DECK_Y } from "./asteroids";
import type { SceneApi } from "./CameraRig";
import type { View } from "./levels";
import { tintOf } from "./tints";
import type { LabelElements } from "./Labels";
import { fadeSecondsFor } from "./dayNight";
import { DESK_LIGHT_COUNT, deskLights } from "./deskLights";
import { LOOK } from "./look";
import { createKit } from "./materials";
import { createSpace, type Space } from "./space";
import { createStation } from "./station";
import type { DayNight } from "./useDayNight";

/** Pointer movement (px) below which a press counts as a click, not a drag. */
const CLICK_SLOP = 5;

export function BeltScene({
  view,
  onOpen,
  labels,
  api,
  sky,
  shuttle,
}: {
  view: View;
  onOpen: (id: BuildingId) => void;
  labels: RefObject<LabelElements>;
  /** Filled in for the camera rig: where each building is, this frame. */
  api: RefObject<SceneApi | null>;
  /** Day or night, and tonight's moon (from useDayNight). */
  sky: Pick<DayNight, "night" | "moonPhase" | "ready" | "choice">;
  /** A notification shuttle to fly now (belt level only), with the banner it carries. */
  shuttle: { key: string; banner: RefObject<HTMLDivElement | null>; onDone: () => void } | null;
}) {
  const { scene, gl, camera } = useThree();
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

  // Day or night: the first known answer for each new space is shown at once;
  // later changes fade (quicker after the Sky button), or jump with reduced motion.
  const shownFor = useRef<Space | null>(null);
  const lastChoice = useRef(sky.choice);
  useEffect(() => {
    if (!space || !sky.ready) return;
    const first = shownFor.current !== space;
    shownFor.current = space;
    space.setNight(sky.night, {
      instant: first || reducedMotion,
      seconds: fadeSecondsFor(lastChoice.current, sky.choice, LOOK.dayNight),
    });
    lastChoice.current = sky.choice;
  }, [space, sky.ready, sky.night, sky.choice, reducedMotion]);
  useEffect(() => {
    space?.setMoonPhase(sky.moonPhase);
  }, [space, sky.moonPhase]);

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

  // Get the station's inside ready in the background soon after the app opens.
  // The first time it's shown, the browser must build its materials and upload
  // every shape and texture, which froze the first flight in at the hatch (in
  // the dark, with the outside already hidden). Here, while the belt just sits
  // there: compile its materials in the background, then draw it once to a tiny
  // hidden target with nothing culled, so nothing is left to do at the hatch.
  useEffect(() => {
    let cancelled = false;
    // Same lights and objects as "inside the station" (the frame loop puts the
    // real state back before the next frame is drawn).
    const asInside = (on: boolean) => {
      const inside = interior.current;
      if (!inside) return false;
      world.station.group.visible = !on;
      inside.visible = on;
      return true;
    };
    const id = window.setTimeout(async () => {
      const inside = interior.current;
      if (cancelled || !inside || inside.visible || !asInside(true)) return;
      const compiled = gl.compileAsync(scene, camera);
      asInside(false);
      try {
        await compiled;
      } catch {
        return; // a warm-up only: the first flight still works without it
      }
      if (cancelled || interior.current?.visible) return;
      const culled: THREE.Object3D[] = [];
      inside.traverse((obj) => {
        if (obj.frustumCulled) {
          obj.frustumCulled = false;
          culled.push(obj);
        }
      });
      const target = new THREE.WebGLRenderTarget(1, 1);
      const before = gl.getRenderTarget();
      asInside(true);
      gl.setRenderTarget(target);
      gl.render(scene, camera);
      gl.setRenderTarget(before);
      asInside(false);
      for (const obj of culled) obj.frustumCulled = true;
      target.dispose();
    }, LOOK.warmUp.interiorAfterMs);
    return () => {
      cancelled = true;
      window.clearTimeout(id);
    };
  }, [gl, scene, camera, world]);

  // Mission Control or the Vault: the station's inside (hub, hallways, rooms)
  // shows while the camera is inside the station; its outside shows otherwise.
  const insideModule =
    view.level !== "belt" && (view.id === "planner" || view.id === "finance") ? view.id : null;
  const interior = useRef<THREE.Group>(null);
  // Which asteroid the camera is in (if any). Every asteroid keeps its desk and
  // hologram all the time, so all three views show the same world.
  const insideId = view.level !== "belt" && !insideModule ? view.id : null;
  const buildings = useQuery({
    queryKey: ["buildings"],
    queryFn: getBuildings,
    staleTime: Infinity,
  });
  const titleOf = (id: BuildingId) => buildings.data?.find((b) => b.id === id)?.name ?? "";

  // Mission Control's screen shows the live open tasks; other screens show the
  // robot's (generic) work.
  const openTasks = useQuery({ queryKey: ["tasks", "open"], queryFn: () => listTasks("open") });
  const hallRows = useMemo(() => hallwayStatus(buildings.data ?? [], BUILT), [buildings.data]);
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

  const hold = useHold();
  useFrame((state) => {
    const t = state.clock.elapsedTime;
    if (space) {
      // Behind the open computer screen the scene holds still, except the asteroid orbit.
      if (!hold) {
        space.update(t, state.camera);
        world.station.update(t);
        world.kit.updateBlinkers(t);
      }
      for (const a of world.asteroids) a.update(t, space.orbitSpeed, state.camera);
      world.kit.setStationLights(space.nightAmount());
    }
    // Inside the station's box (hatch, hub, hallways, rooms): show the inside.
    const c = state.camera.position;
    const inStation = Math.abs(c.x) < 12.9 && c.y > -1.3 && c.y < 2.2 && Math.abs(c.z) < 2.55;
    world.station.group.visible = !inStation;
    if (interior.current) interior.current.visible = inStation;
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
    if (flightState.flying()) return; // a click during a flight only finishes it
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
      {shuttle && <Shuttle key={shuttle.key} banner={shuttle.banner} onDone={shuttle.onDone} />}
      <primitive object={world.station.group} {...events} />
      <DeskLightPool />
      <group ref={interior} visible={false}>
        <StationInterior
          titleOf={titleOf}
          tintOf={tintOf}
          built={BUILT}
          rows={hallRows}
          summary={hallwayStatus.missionSummary(openTasks.data ?? [])}
          screenOf={atScreen ? insideModule : null}
          onOpenScreen={(id) => onOpen(id)}
        />
      </group>
      {world.asteroids.map((a) => (
        <Fragment key={a.id}>
          {createPortal(
            <group position={[0, DECK_Y, 0]}>
              <AsteroidDesk
                id={a.id}
                title={titleOf(a.id)}
                tint={tintOf(a.id)}
                built={BUILT.has(a.id)}
                inside={insideId === a.id}
                atScreen={atScreen && insideId === a.id}
                sign={a.deskSign}
                reducedMotion={reducedMotion}
                onDesk={() => onOpen(a.id)}
              />
            </group>,
            a.spin,
          )}
        </Fragment>
      ))}
      {world.asteroids.map((a) => (
        <primitive key={a.id} object={a.group} {...events} />
      ))}
    </>
  );
}

// The one shared set of close-up desk lights (see deskLights.ts): always in the
// scene so the light count never changes; dark when no desk is close up.
const DESK_LIGHTS = [
  { mark: "work", intensity: 3, distance: 5, color: 0xffe2c0 },
  { mark: "glow", intensity: 1.4, distance: 2.5, color: 0x8aa4ff },
  { mark: "lamp", intensity: 1.2, distance: 1.6, color: 0xffd9a8 },
] as const;

function DeskLightPool() {
  const lights = useRef<(THREE.PointLight | null)[]>([]);
  useFrame((state) => {
    const desk = deskLights.closestNear(state.camera.position);
    DESK_LIGHTS.forEach((spec, i) => {
      const light = lights.current[i];
      if (!light) return;
      if (desk) {
        desk[spec.mark].getWorldPosition(light.position);
        light.intensity = spec.intensity;
      } else {
        light.intensity = 0;
      }
    });
  });
  return (
    <>
      {DESK_LIGHTS.map((spec, i) => (
        <pointLight
          key={spec.mark}
          ref={(l) => {
            lights.current[i] = l;
          }}
          intensity={0}
          distance={spec.distance}
          color={spec.color}
        />
      ))}
    </>
  );
}
if (DESK_LIGHTS.length !== DESK_LIGHT_COUNT) throw new Error("Desk light count mismatch.");

function disposeTree(root: THREE.Object3D) {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const m = mesh.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(m)) m.forEach((x) => x.dispose());
    else m?.dispose();
  });
}
