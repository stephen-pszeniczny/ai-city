// Tells the 3D scene whether the computer screen is open (it then holds still), and
// lets a piece check whether it's in the camera's view (checked every 10 frames).
import { useFrame } from "@react-three/fiber";
import { createContext, useContext, useRef, type ReactNode, type RefObject } from "react";
import * as THREE from "three";

const HoldContext = createContext(false);

export function HoldProvider({ hold, children }: { hold: boolean; children: ReactNode }) {
  return <HoldContext.Provider value={hold}>{children}</HoldContext.Provider>;
}

/** True while the computer screen is open. */
export function useHold(): boolean {
  return useContext(HoldContext);
}

const frustum = new THREE.Frustum();
const matrix = new THREE.Matrix4();
const sphere = new THREE.Sphere();
const box = new THREE.Box3();

/** A ref to whether `target` is inside the camera's view, refreshed every 10 frames. */
export function useInView(target: RefObject<THREE.Object3D | null>): RefObject<boolean> {
  const inView = useRef(true);
  const frame = useRef(0);
  useFrame((state) => {
    frame.current = (frame.current + 1) % 10;
    if (frame.current !== 0 || !target.current) return;
    matrix.multiplyMatrices(state.camera.projectionMatrix, state.camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(matrix);
    box.setFromObject(target.current).getBoundingSphere(sphere);
    inView.current = sphere.radius === 0 || frustum.intersectsSphere(sphere);
  });
  return inView;
}
