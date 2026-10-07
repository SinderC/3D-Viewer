// Orientation cube in the viewport corner, built from CSS 3D transformed elements.
// Each face is a 3×3 grid: the centre looks at the face, the borders at an edge or corner.
import * as THREE from 'three';

const SIZE = 64; // px, keep in sync with .viewcube .face in styles.css

export interface Face {
  label: string;
  normal: THREE.Vector3;
  up: THREE.Vector3; // world direction shown as "up" on the label
}

// Models are Z-up.
export const FACES: Face[] = [
  { label: 'Front', normal: new THREE.Vector3(0, -1, 0), up: new THREE.Vector3(0, 0, 1) },
  { label: 'Back', normal: new THREE.Vector3(0, 1, 0), up: new THREE.Vector3(0, 0, 1) },
  { label: 'Right', normal: new THREE.Vector3(1, 0, 0), up: new THREE.Vector3(0, 0, 1) },
  { label: 'Left', normal: new THREE.Vector3(-1, 0, 0), up: new THREE.Vector3(0, 0, 1) },
  { label: 'Top', normal: new THREE.Vector3(0, 0, 1), up: new THREE.Vector3(0, 1, 0) },
  { label: 'Bottom', normal: new THREE.Vector3(0, 0, -1), up: new THREE.Vector3(0, -1, 0) },
];

// Face-local axes in world space: x to the right and y downwards on the label, as in CSS.
function faceAxes({ normal, up }: Face): { right: THREE.Vector3; down: THREE.Vector3 } {
  return { right: up.clone().cross(normal), down: up.clone().negate() };
}

/** View direction (target towards camera, not normalised) for grid cell column i, row j. */
export function cellDirection(face: Face, i: number, j: number): THREE.Vector3 {
  const { right, down } = faceAxes(face);
  return face.normal
    .clone()
    .addScaledVector(right, i - 1)
    .addScaledVector(down, j - 1);
}

const HOME_ICON =
  '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2 7.5 8 2l6 5.5M3.5 6.5V14h9V6.5"/></svg>';

const css = (m: THREE.Matrix4) => `matrix3d(${m.elements.join(',')})`;

export class ViewCube {
  private readonly root = document.createElement('div');
  private readonly cube = document.createElement('div');
  private readonly view = new THREE.Matrix4();
  private readonly flipY = new THREE.Matrix4().makeScale(1, -1, 1);

  constructor(container: HTMLElement, home: THREE.Vector3, onPick: (dir: THREE.Vector3) => void) {
    this.root.className = 'viewcube';
    this.root.hidden = true;
    this.cube.className = 'cube';
    this.root.append(this.cube);

    for (const face of FACES) {
      const el = document.createElement('div');
      el.className = 'face';
      const { right, down } = faceAxes(face);
      const place = new THREE.Matrix4().makeBasis(right, down, face.normal).setPosition(face.normal.clone().multiplyScalar(SIZE / 2));
      el.style.transform = css(place);
      for (let j = 0; j < 3; j++) {
        for (let i = 0; i < 3; i++) {
          const dir = cellDirection(face, i, j);
          const cell = document.createElement('div');
          cell.className = 'cell';
          cell.dataset.dir = dir.toArray().join(',');
          // Edge and corner cells sit on two or three faces; highlight all of them together.
          const highlight = (on: boolean) =>
            this.cube.querySelectorAll(`[data-dir="${cell.dataset.dir}"]`).forEach((c) => c.classList.toggle('hover', on));
          cell.addEventListener('pointerenter', () => highlight(true));
          cell.addEventListener('pointerleave', () => highlight(false));
          cell.addEventListener('click', () => onPick(dir));
          el.append(cell);
        }
      }
      const label = document.createElement('span');
      label.textContent = face.label;
      el.append(label);
      this.cube.append(el);
    }

    const button = document.createElement('button');
    button.className = 'home';
    button.title = 'Home view';
    button.setAttribute('aria-label', 'Home view');
    button.innerHTML = HOME_ICON;
    button.addEventListener('click', () => onPick(home));
    this.root.append(button);

    container.append(this.root);
  }

  /** Rotate the cube to match the camera. */
  update(camera: THREE.Camera): void {
    // World → camera rotation, then flip Y because CSS y points down.
    this.view.makeRotationFromQuaternion(camera.quaternion).transpose().premultiply(this.flipY);
    this.cube.style.transform = css(this.view);
  }

  setVisible(visible: boolean): void {
    this.root.hidden = !visible;
  }

  dispose(): void {
    this.root.remove();
  }
}
