// Measurements on picked points, B-rep edges and faces: highlights, dimension lines and a screen-space label.
import * as THREE from 'three';
import { formatLength, type UnitId } from '../core/units';

export type MeasureMode = 'edgeLength' | 'edgeRadius' | 'edgeDiameter' | 'pointDistance' | 'faceDistance' | 'faceAngle';

export const MEASURE_MODES: Record<MeasureMode, { label: string; pick: Pick['kind']; count: 1 | 2 }> = {
  edgeLength: { label: 'Length of edge', pick: 'edge', count: 1 },
  edgeRadius: { label: 'Radius of edge', pick: 'edge', count: 1 },
  edgeDiameter: { label: 'Diameter of edge', pick: 'edge', count: 1 },
  pointDistance: { label: 'Distance between points', pick: 'point', count: 2 },
  faceDistance: { label: 'Distance between faces', pick: 'face', count: 2 },
  faceAngle: { label: 'Angle between faces', pick: 'face', count: 2 },
};

// Picks are in world space; `point` is where the user clicked.
export interface PointPick {
  kind: 'point';
  point: THREE.Vector3;
}
export interface EdgePick {
  kind: 'edge';
  point: THREE.Vector3;
  segments: Float32Array; // for highlighting
  curve: 'line' | 'circle' | 'other';
  length: number;
  radius: number;
  center: THREE.Vector3;
  axis: THREE.Vector3;
}
export interface FacePick {
  kind: 'face';
  point: THREE.Vector3;
  triangles: Float32Array; // non-indexed, for highlighting
  plane: THREE.Plane | null; // outward normal; null when the face is not planar
}
export type Pick = PointPick | EdgePick | FacePick;

export interface Result {
  text: string;
  anchor: THREE.Vector3;
  lines: THREE.Vector3[]; // segment pairs
  warn?: boolean;
}

const PARALLEL_TOLERANCE = 1e-9; // on 1 - |cos|, ~0.003°
const DEG = 180 / Math.PI;

export function evaluate(mode: MeasureMode, picks: Pick[], unit: UnitId): Result {
  const fmt = (mm: number) => formatLength(mm, unit);
  const warn = (text: string, anchor: THREE.Vector3): Result => ({ text, anchor, lines: [], warn: true });

  switch (mode) {
    case 'edgeLength': {
      const e = picks[0] as EdgePick;
      return { text: fmt(e.length), anchor: e.point, lines: [] };
    }
    case 'edgeRadius':
    case 'edgeDiameter': {
      const e = picks[0] as EdgePick;
      if (e.curve !== 'circle') return warn('Not a circular edge', e.point);
      const dir = radialDirection(e);
      const rim = e.center.clone().addScaledVector(dir, e.radius);
      if (mode === 'edgeRadius') {
        return { text: `R ${fmt(e.radius)}`, anchor: e.center.clone().lerp(rim, 0.5), lines: [e.center, rim] };
      }
      const opposite = e.center.clone().addScaledVector(dir, -e.radius);
      return { text: `Ø ${fmt(2 * e.radius)}`, anchor: e.center, lines: [opposite, rim] };
    }
    case 'pointDistance': {
      const [a, b] = picks.map((p) => p.point);
      return { text: fmt(a.distanceTo(b)), anchor: a.clone().lerp(b, 0.5), lines: [a, b] };
    }
    case 'faceDistance':
    case 'faceAngle': {
      const [a, b] = picks as FacePick[];
      const mid = a.point.clone().lerp(b.point, 0.5);
      if (!a.plane || !b.plane) return warn('Select planar faces', mid);
      const cos = THREE.MathUtils.clamp(a.plane.normal.dot(b.plane.normal), -1, 1);
      const parallel = 1 - Math.abs(cos) < PARALLEL_TOLERANCE;
      const angle = Math.acos(cos) * DEG;
      if (mode === 'faceAngle') {
        if (parallel) return { text: '0.00° (parallel)', anchor: mid, lines: [] };
        const text = Math.abs(angle - 90) < 1e-6 ? '90.00°' : `${angle.toFixed(2)}° (${(180 - angle).toFixed(2)}°)`;
        return { text, anchor: mid, lines: [] };
      }
      if (!parallel) return warn(`Faces not parallel (${angle.toFixed(2)}°)`, mid);
      const onB = b.plane.projectPoint(b.point, new THREE.Vector3());
      const onA = a.plane.projectPoint(onB, new THREE.Vector3());
      return { text: fmt(onA.distanceTo(onB)), anchor: onA.clone().lerp(onB, 0.5), lines: [onA, onB] };
    }
  }
}

// Unit vector from the circle centre towards the clicked point, in the circle's plane.
function radialDirection(e: EdgePick): THREE.Vector3 {
  const v = e.point.clone().sub(e.center);
  v.addScaledVector(e.axis, -v.dot(e.axis));
  if (v.lengthSq() < 1e-12) {
    // Clicked at the centre: any direction in the plane will do.
    v.set(Math.abs(e.axis.x) < 0.9 ? 1 : 0, Math.abs(e.axis.x) < 0.9 ? 0 : 1, 0).cross(e.axis);
  }
  return v.normalize();
}

const COLOR = 0xffb020;

export class Measure {
  private readonly group = new THREE.Group();
  private readonly label = document.createElement('div');
  private mode: MeasureMode = 'pointDistance';
  private unit: UnitId = 'mm';
  private picks: Pick[] = [];
  private result: Result | null = null;

  private readonly markerMaterial = new THREE.PointsMaterial({ color: COLOR, size: 9, sizeAttenuation: false, depthTest: false });
  private readonly lineMaterial = new THREE.LineBasicMaterial({ color: COLOR, depthTest: false });
  private readonly faceMaterial = new THREE.MeshBasicMaterial({
    color: COLOR,
    transparent: true,
    opacity: 0.45,
    side: THREE.DoubleSide,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });

  constructor(scene: THREE.Scene, container: HTMLElement) {
    scene.add(this.group);
    this.label.className = 'measure-label';
    this.label.hidden = true;
    container.appendChild(this.label);
  }

  get pickKind(): Pick['kind'] {
    return MEASURE_MODES[this.mode].pick;
  }

  setMode(mode: MeasureMode): void {
    this.mode = mode;
    this.clear();
  }

  setUnit(unit: UnitId): void {
    this.unit = unit;
    this.update();
  }

  add(pick: Pick): void {
    const { count } = MEASURE_MODES[this.mode];
    if (this.picks.length >= count) this.picks = [];
    this.picks.push(pick);
    this.update();
  }

  clear(): void {
    this.picks = [];
    this.update();
  }

  updateLabel(camera: THREE.Camera, canvas: HTMLCanvasElement): void {
    if (!this.result) return;
    const p = this.result.anchor.clone().project(camera);
    this.label.style.left = `${((p.x + 1) / 2) * canvas.clientWidth}px`;
    this.label.style.top = `${((1 - p.y) / 2) * canvas.clientHeight}px`;
  }

  dispose(): void {
    this.clear();
    this.markerMaterial.dispose();
    this.lineMaterial.dispose();
    this.faceMaterial.dispose();
    this.label.remove();
  }

  private update(): void {
    const complete = this.picks.length === MEASURE_MODES[this.mode].count;
    this.result = complete ? evaluate(this.mode, this.picks, this.unit) : null;
    this.label.hidden = !this.result;
    this.label.textContent = this.result?.text ?? '';
    this.label.classList.toggle('warn', !!this.result?.warn);
    this.rebuild();
  }

  private rebuild(): void {
    this.group.traverse((o) => {
      if (o instanceof THREE.Mesh || o instanceof THREE.Line || o instanceof THREE.Points) o.geometry.dispose();
    });
    this.group.clear();

    const add = (o: THREE.Object3D) => {
      o.renderOrder = 10;
      this.group.add(o);
    };
    const geometry = (positions: Float32Array) =>
      new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(positions, 3));

    for (const p of this.picks) {
      if (p.kind === 'edge') add(new THREE.LineSegments(geometry(p.segments), this.lineMaterial));
      if (p.kind === 'face') add(new THREE.Mesh(geometry(p.triangles), this.faceMaterial));
    }
    const markers = this.picks.filter((p) => p.kind === 'point').map((p) => p.point);
    if (this.result?.lines.length) {
      add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(this.result.lines), this.lineMaterial));
      markers.push(...this.result.lines);
    }
    if (markers.length) add(new THREE.Points(new THREE.BufferGeometry().setFromPoints(markers), this.markerMaterial));
  }
}
