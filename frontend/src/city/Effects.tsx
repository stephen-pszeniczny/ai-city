// The cinematic look: soft bloom on bright things, a touch of colour fringe,
// vignette and film grain. Takes over drawing from React Three Fiber.
//
// Performance: the bloom runs at half resolution, and frames are capped at
// 60 per second (a faster display won't make the Mac work harder).
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";

const MIN_FRAME_MS = 1000 / 61; // just under 60 fps, so a 60 Hz screen never skips

export function Effects() {
  const { gl, scene, camera, size } = useThree();

  const { composer, bloom, film } = useMemo(() => {
    const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
    const composer = new EffectComposer(gl, target);
    composer.addPass(new RenderPass(scene, camera));
    const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.85, 0.6, 0.88);
    composer.addPass(bloom);
    const film = new ShaderPass({
      uniforms: {
        tDiffuse: { value: null },
        time: { value: 0 },
        grain: { value: 0.03 },
        vignette: { value: 0.6 },
        res: { value: new THREE.Vector2(1, 1) },
      },
      vertexShader:
        "varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
      fragmentShader: `uniform sampler2D tDiffuse; uniform float time; uniform float grain; uniform float vignette; uniform vec2 res; varying vec2 vUv;
        float rnd(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
        void main(){ vec2 c = vUv - 0.5; float d = length(c);
          vec3 col; col.r = texture2D(tDiffuse, vUv + c * 0.0035).r; col.g = texture2D(tDiffuse, vUv).g; col.b = texture2D(tDiffuse, vUv - c * 0.0035).b;
          col *= mix(1.0, smoothstep(0.92, 0.28, d), vignette);
          float n = rnd(floor(vUv * res) + fract(time * 7.13) * 91.7) - 0.5;
          col += n * grain * (0.25 + col);
          gl_FragColor = vec4(max(col, 0.0), 1.0); }`,
    });
    composer.addPass(film);
    composer.addPass(new OutputPass());
    return { composer, bloom, film };
  }, [gl, scene, camera]);

  useEffect(() => {
    const pr = gl.getPixelRatio();
    composer.setSize(size.width, size.height);
    bloom.setSize((size.width * pr) / 2, (size.height * pr) / 2); // half-resolution bloom
    (film.uniforms.res!.value as THREE.Vector2).set(size.width * pr, size.height * pr);
  }, [composer, bloom, film, gl, size]);

  useEffect(() => () => composer.dispose(), [composer]);

  const last = useRef(0); // survives re-renders (e.g. window resizes)
  // Priority 1: React Three Fiber stops drawing by itself and leaves it to this.
  useFrame((state) => {
    const now = performance.now();
    if (now - last.current < MIN_FRAME_MS) return;
    last.current = now;
    film.uniforms.time!.value = state.clock.elapsedTime;
    composer.render();
  }, 1);

  return null;
}
