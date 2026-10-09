// The "Realistic" display style: post-processing (ambient occlusion, tone mapping, vignette) and a soft
// contact shadow under the model. Made on first use; the other styles render straight to the canvas.
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { HorizontalBlurShader } from 'three/examples/jsm/shaders/HorizontalBlurShader.js';
import { VerticalBlurShader } from 'three/examples/jsm/shaders/VerticalBlurShader.js';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';

type Camera = THREE.PerspectiveCamera | THREE.OrthographicCamera;

// Composites the tone-mapped scene (premultiplied by its coverage) over the background, with a soft vignette.
const BACKDROP = {
  uniforms: { tDiffuse: { value: null }, background: { value: new THREE.Color() } },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec3 background;
    varying vec2 vUv;
    void main() {
      vec4 scene = texture2D(tDiffuse, vUv);
      vec3 color = scene.rgb + background * (1.0 - scene.a);
      vec2 d = vUv - 0.5;
      color *= 1.0 - 0.35 * smoothstep(0.2, 0.8, dot(d, d) * 2.0);
      gl_FragColor = vec4(color, 1.0);
    }`,
};

export class Effects {
  private readonly composer: EffectComposer;
  private readonly renderPass: RenderPass;
  private readonly ao: GTAOPass;
  private readonly backdrop: ShaderPass;

  /**
   * `excludeFromAo` lists objects that must not occlude (overlays, ghosts, the grid): they are hidden
   * while the ambient occlusion pass renders its depth and normals.
   */
  constructor(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: Camera,
    clipping: THREE.Plane[],
    excludeFromAo: () => THREE.Object3D[],
  ) {
    // Multisampled, so edges stay as smooth as the plain renderer's; half float keeps highlights for tone mapping.
    const target = new THREE.WebGLRenderTarget(1, 1, { samples: 4, type: THREE.HalfFloatType });
    this.composer = new EffectComposer(renderer, target);
    this.renderPass = new RenderPass(scene, camera);
    this.ao = new GTAOPass(scene, camera);
    this.ao.normalMaterial.clippingPlanes = clipping; // cut-away geometry must not occlude
    this.ao.updateGtaoMaterial({ distanceExponent: 1, thickness: 1, scale: 1 });
    this.ao.blendIntensity = 0.8;
    const render = this.ao.render.bind(this.ao);
    this.ao.render = (...args) => {
      const hidden = excludeFromAo().filter((o) => o.visible);
      hidden.forEach((o) => (o.visible = false));
      render(...args);
      hidden.forEach((o) => (o.visible = true));
    };
    // The scene renders on transparent black; the backdrop goes in last, untouched by tone mapping
    // (which would crush the dark theme's background towards black).
    this.renderPass.clearColor = new THREE.Color(0, 0, 0);
    this.renderPass.clearAlpha = 0;
    this.backdrop = new ShaderPass(BACKDROP);
    this.composer.addPass(this.renderPass);
    this.composer.addPass(this.ao);
    this.composer.addPass(new OutputPass()); // tone mapping and sRGB, from the renderer's settings
    this.composer.addPass(this.backdrop);
  }

  /** The background behind the model, as an sRGB colour. */
  setBackground(color: number): void {
    // Colours are stored linear and uploaded as they are, but the backdrop pass works in the output's sRGB.
    const { r, g, b } = new THREE.Color(color).getRGB(new THREE.Color(), THREE.SRGBColorSpace);
    this.backdrop.uniforms.background.value.setRGB(r, g, b, THREE.LinearSRGBColorSpace);
  }

  /** How far ambient occlusion reaches, in world units: a few percent of the model is right. */
  setOcclusionRadius(radius: number): void {
    this.ao.updateGtaoMaterial({ radius });
  }

  setCamera(camera: Camera): void {
    this.renderPass.camera = camera;
    this.ao.camera = camera;
    this.ao.gtaoMaterial.defines.PERSPECTIVE_CAMERA = camera instanceof THREE.PerspectiveCamera ? 1 : 0;
    this.ao.gtaoMaterial.needsUpdate = true;
  }

  setSize(width: number, height: number, pixelRatio: number): void {
    this.composer.setPixelRatio(pixelRatio);
    this.composer.setSize(width, height);
  }

  render(): void {
    this.composer.render();
  }

  dispose(): void {
    this.ao.dispose();
    this.composer.dispose();
  }
}

const SHADOW_SIZE = 512;

/**
 * A soft shadow on the ground under the model: its depth seen from below, darker where it is closer
 * to the ground, blurred. It depends only on the model, so it is redrawn when the model changes.
 */
export class ContactShadow {
  readonly mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private readonly target = new THREE.WebGLRenderTarget(SHADOW_SIZE, SHADOW_SIZE);
  private readonly blurTarget = new THREE.WebGLRenderTarget(SHADOW_SIZE, SHADOW_SIZE);
  private readonly camera = new THREE.OrthographicCamera();
  private readonly scene = new THREE.Scene();
  private readonly blurH = new THREE.ShaderMaterial(HorizontalBlurShader);
  private readonly blurV = new THREE.ShaderMaterial(VerticalBlurShader);
  private readonly quad = new FullScreenQuad();

  constructor() {
    // Depth as darkness: opaque black at the ground, fading out with height.
    const depth = new THREE.MeshDepthMaterial({ side: THREE.DoubleSide });
    depth.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace(
        'gl_FragColor = vec4( vec3( 1.0 - fragCoordZ ), opacity );',
        'gl_FragColor = vec4( vec3( 0.0 ), pow( 1.0 - fragCoordZ, 2.0 ) );',
      );
    };
    this.scene.overrideMaterial = depth;
    this.mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ map: this.target.texture, transparent: true, depthWrite: false, opacity: 0.55 }),
    );
    // The camera looks up, so its image is mirrored in x relative to the plane seen from above.
    this.mesh.scale.x = -1;
    this.mesh.material.side = THREE.DoubleSide;
    this.mesh.raycast = () => {};
    this.mesh.renderOrder = -1;
  }

  /**
   * Redraw for `root` within `bounds`, with the ground at the bounds' bottom. `bounds` are in a Z-up frame
   * that `upright` turns to world. `exclude` lists objects under `root` that must not cast (annotations
   * floating around the model).
   */
  update(
    renderer: THREE.WebGLRenderer,
    root: THREE.Object3D,
    bounds: THREE.Box3,
    upright: THREE.Quaternion,
    exclude: THREE.Object3D[],
  ): void {
    if (bounds.isEmpty()) return;
    const size = bounds.getSize(new THREE.Vector3());
    const center = bounds.getCenter(new THREE.Vector3());
    const extent = Math.max(size.x, size.y) * 1.4; // room for the blur around the outline
    const reach = Math.max(size.z, extent * 0.25); // how high above the ground still casts a shadow
    const ground = bounds.min.z - extent * 1e-4; // just below the bottom faces, like the grid

    Object.assign(this.camera, { left: -extent / 2, right: extent / 2, top: extent / 2, bottom: -extent / 2, near: 0, far: reach });
    this.camera.position.set(center.x, center.y, ground).applyQuaternion(upright);
    this.camera.up.set(0, 1, 0).applyQuaternion(upright);
    this.camera.lookAt(new THREE.Vector3(center.x, center.y, ground + 1).applyQuaternion(upright));
    this.camera.updateProjectionMatrix();
    this.mesh.position.set(center.x, center.y, ground).applyQuaternion(upright);
    this.mesh.quaternion.copy(upright);
    this.mesh.scale.set(-extent, extent, 1);

    // Render the model alone: borrow it into the shadow scene for the draw.
    const parent = root.parent;
    const background = renderer.getClearColor(new THREE.Color());
    const alpha = renderer.getClearAlpha();
    const hidden = exclude.filter((o) => o.visible);
    hidden.forEach((o) => (o.visible = false));
    this.scene.add(root);
    renderer.setClearColor(0x000000, 0);
    renderer.setRenderTarget(this.target);
    renderer.clear();
    renderer.render(this.scene, this.camera);
    parent?.add(root);
    hidden.forEach((o) => (o.visible = true));

    for (let i = 0; i < 3; i++) this.blur((1 + i) / SHADOW_SIZE, renderer);

    renderer.setRenderTarget(null);
    renderer.setClearColor(background, alpha);
  }

  setVisible(visible: boolean): void {
    this.mesh.visible = visible;
  }

  private blur(amount: number, renderer: THREE.WebGLRenderer): void {
    this.quad.material = this.blurH;
    this.blurH.uniforms.tDiffuse.value = this.target.texture;
    this.blurH.uniforms.h.value = amount;
    renderer.setRenderTarget(this.blurTarget);
    this.quad.render(renderer);
    this.quad.material = this.blurV;
    this.blurV.uniforms.tDiffuse.value = this.blurTarget.texture;
    this.blurV.uniforms.v.value = amount;
    renderer.setRenderTarget(this.target);
    this.quad.render(renderer);
  }

  dispose(): void {
    this.target.dispose();
    this.blurTarget.dispose();
    this.blurH.dispose();
    this.blurV.dispose();
    this.quad.dispose();
    this.scene.overrideMaterial?.dispose();
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}
