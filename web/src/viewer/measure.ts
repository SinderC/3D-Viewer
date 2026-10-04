// Point-to-point distance: two clicks place a line and a screen-space label.
import * as THREE from 'three';
import type { LengthUnit } from '../core/model';

export class Measure {
  private readonly group = new THREE.Group();
  private readonly label = document.createElement('div');
  private points: THREE.Vector3[] = [];
  private unit: LengthUnit = { label: 'mm', perMm: 1 };

  private readonly markerMaterial = new THREE.PointsMaterial({ color: 0xffb020, size: 9, sizeAttenuation: false, depthTest: false });
  private readonly lineMaterial = new THREE.LineBasicMaterial({ color: 0xffb020, depthTest: false });

  constructor(scene: THREE.Scene, container: HTMLElement) {
    this.group.renderOrder = 10;
    scene.add(this.group);
    this.label.className = 'measure-label';
    this.label.hidden = true;
    container.appendChild(this.label);
  }

  setUnit(unit: LengthUnit): void {
    this.unit = unit;
  }

  addPoint(p: THREE.Vector3): void {
    if (this.points.length === 2) this.clear();
    this.points.push(p);
    const geometry = new THREE.BufferGeometry().setFromPoints(this.points);
    this.disposeChildren();
    const markers = new THREE.Points(geometry, this.markerMaterial);
    markers.renderOrder = 10;
    this.group.add(markers);
    if (this.points.length === 2) {
      const line = new THREE.Line(geometry, this.lineMaterial);
      line.renderOrder = 10;
      this.group.add(line);
      const mm = this.points[0].distanceTo(this.points[1]);
      const digits = this.unit.label === 'mm' ? 3 : 4;
      this.label.textContent = `${(mm * this.unit.perMm).toFixed(digits)} ${this.unit.label}`;
      this.label.hidden = false;
    }
  }

  clear(): void {
    this.points = [];
    this.disposeChildren();
    this.label.hidden = true;
  }

  updateLabel(camera: THREE.Camera, canvas: HTMLCanvasElement): void {
    if (this.points.length !== 2) return;
    const mid = this.points[0].clone().add(this.points[1]).multiplyScalar(0.5).project(camera);
    this.label.style.left = `${((mid.x + 1) / 2) * canvas.clientWidth}px`;
    this.label.style.top = `${((1 - mid.y) / 2) * canvas.clientHeight}px`;
  }

  dispose(): void {
    this.clear();
    this.markerMaterial.dispose();
    this.lineMaterial.dispose();
    this.label.remove();
  }

  private disposeChildren(): void {
    // Markers and line share one geometry.
    const first = this.group.children[0] as THREE.Points | undefined;
    first?.geometry.dispose();
    this.group.clear();
  }
}
