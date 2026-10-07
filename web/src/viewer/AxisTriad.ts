// XYZ axis indicator in the viewport corner, drawn as SVG and rotated with the camera.
import * as THREE from 'three';

const SIZE = 80; // px, keep in sync with .axis-triad in styles.css
const LENGTH = 26; // px from origin to the axis tip
const SVG_NS = 'http://www.w3.org/2000/svg';

const AXES = [
  { label: 'X', dir: new THREE.Vector3(1, 0, 0), color: '#e5534b' },
  { label: 'Y', dir: new THREE.Vector3(0, 1, 0), color: '#57ab5a' },
  { label: 'Z', dir: new THREE.Vector3(0, 0, 1), color: '#539bf5' },
];

export class AxisTriad {
  private readonly root = document.createElementNS(SVG_NS, 'svg');
  private readonly axes: { g: SVGGElement; line: SVGLineElement; text: SVGTextElement }[] = [];
  private readonly inverse = new THREE.Quaternion();
  private readonly v = new THREE.Vector3();

  constructor(container: HTMLElement) {
    this.root.classList.add('axis-triad');
    this.root.setAttribute('viewBox', `${-SIZE / 2} ${-SIZE / 2} ${SIZE} ${SIZE}`);
    this.root.setAttribute('aria-hidden', 'true');
    this.root.style.display = 'none';
    for (const { label, color } of AXES) {
      const g = document.createElementNS(SVG_NS, 'g');
      g.setAttribute('stroke', color);
      g.setAttribute('fill', color);
      const line = document.createElementNS(SVG_NS, 'line');
      const text = document.createElementNS(SVG_NS, 'text');
      text.textContent = label;
      g.append(line, text);
      this.root.append(g);
      this.axes.push({ g, line, text });
    }
    container.append(this.root);
  }

  /** Rotate the axes to match the camera. */
  update(camera: THREE.Camera): void {
    this.inverse.copy(camera.quaternion).invert();
    const depth: number[] = [];
    AXES.forEach(({ dir }, i) => {
      const v = this.v.copy(dir).applyQuaternion(this.inverse); // camera space: x right, y up, z towards viewer
      const { line, text } = this.axes[i];
      line.setAttribute('x2', String(v.x * LENGTH));
      line.setAttribute('y2', String(-v.y * LENGTH));
      text.setAttribute('x', String(v.x * (LENGTH + 9)));
      text.setAttribute('y', String(-v.y * (LENGTH + 9)));
      depth[i] = v.z;
    });
    // Paint back to front so axes pointing at the viewer stay on top.
    [0, 1, 2].sort((a, b) => depth[a] - depth[b]).forEach((i) => this.root.append(this.axes[i].g));
  }

  setVisible(visible: boolean): void {
    this.root.style.display = visible ? '' : 'none';
  }

  dispose(): void {
    this.root.remove();
  }
}
