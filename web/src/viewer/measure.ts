// Measurements on picked points, B-rep edges and faces: highlights, dimension lines and a screen-space label.
import * as THREE from 'three';
import { formatLength, type UnitId } from '../core/units';

export type MeasureMode =
  | 'edgeLength'
  | 'edgeRadius'
  | 'edgeDiameter'
  | 'pointDistance'
  | 'pointFace'
  | 'faceDistance'
  | 'faceAngle'
  | 'pointCoords';

/** Per mode, what each pick must be, in order. */
export const MEASURE_MODES: Record<MeasureMode, { label: string; picks: Pick['kind'][] }> = {
  edgeLength: { label: 'Length of edge', picks: ['edge'] },
  edgeRadius: { label: 'Radius of edge', picks: ['edge'] },
  edgeDiameter: { label: 'Diameter of edge', picks: ['edge'] },
  pointDistance: { label: 'Distance between points', picks: ['point', 'point'] },
  pointFace: { label: 'Distance from point to face', picks: ['point', 'face'] },
  faceDistance: { label: 'Distance between faces', picks: ['face', 'face'] },
  faceAngle: { label: 'Angle between faces', picks: ['face', 'face'] },
  pointCoords: { label: 'Point coordinates', picks: ['point'] },
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
    case 'pointFace': {
      const p = picks[0].point;
      const f = picks[1] as FacePick;
      if (!f.plane) return warn('Select a planar face', f.point);
      const foot = f.plane.projectPoint(p, new THREE.Vector3());
      return { text: fmt(p.distanceTo(foot)), anchor: p.clone().lerp(foot, 0.5), lines: [p, foot] };
    }
    case 'pointCoords': {
      const p = picks[0].point;
      return { text: `X ${fmt(p.x)}   Y ${fmt(p.y)}   Z ${fmt(p.z)}`, anchor: p, lines: [] };
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

// A completed measurement and its screen-space label.
interface Done {
  mode: MeasureMode;
  picks: Pick[];
  result: Result;
  label: HTMLDivElement;
}

// Completed measurements stay until removed; picks for the next one collect alongside them.
export class Measure {
  /** Called after a change the scene must be redrawn for, e.g. a label's remove button. */
  onChange: () => void = () => {};

  private readonly group = new THREE.Group();
  private readonly hoverGroup = new THREE.Group();
  private mode: MeasureMode = 'pointDistance';
  private unit: UnitId = 'mm';
  private picks: Pick[] = [];
  private done: Done[] = [];

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
  private readonly hoverFaceMaterial = Object.assign(this.faceMaterial.clone(), { opacity: 0.2 });

  constructor(
    scene: THREE.Scene,
    private readonly container: HTMLElement,
  ) {
    scene.add(this.group, this.hoverGroup);
  }

  /** What the next pick must be. */
  get pickKind(): Pick['kind'] {
    return MEASURE_MODES[this.mode].picks[this.picks.length];
  }

  /** Number of completed measurements. */
  get count(): number {
    return this.done.length;
  }

  setMode(mode: MeasureMode): void {
    this.mode = mode;
    this.picks = [];
    this.rebuild();
  }

  setUnit(unit: UnitId): void {
    this.unit = unit;
    for (const d of this.done) this.setResult(d, evaluate(d.mode, d.picks, unit));
  }

  add(pick: Pick): void {
    this.picks.push(pick);
    if (this.picks.length === MEASURE_MODES[this.mode].picks.length) {
      const d: Done = { mode: this.mode, picks: this.picks, result: evaluate(this.mode, this.picks, this.unit), label: this.makeLabel() };
      d.label.querySelector('button')!.onclick = () => this.remove(d);
      this.setResult(d, d.result);
      this.done.push(d);
      this.picks = [];
    }
    this.rebuild();
  }

  /** Drop the picks of an unfinished measurement, else the last completed one. */
  undo(): void {
    if (this.picks.length) {
      this.picks = [];
      this.rebuild();
    } else if (this.done.length) {
      this.remove(this.done[this.done.length - 1]);
    }
  }

  clear(): void {
    this.picks = [];
    this.done.forEach((d) => d.label.remove());
    this.done = [];
    this.setHover(null);
    this.rebuild();
  }

  // Preview of the edge or face under the cursor. Returns whether anything changed.
  setHover(pick: Pick | null): boolean {
    if (!pick && !this.hoverGroup.children.length) return false;
    clearGroup(this.hoverGroup);
    const o = pick && this.highlight(pick, this.hoverFaceMaterial);
    if (o) this.hoverGroup.add(o);
    return true;
  }

  updateLabel(camera: THREE.Camera, canvas: HTMLCanvasElement): void {
    for (const { result, label } of this.done) {
      const p = result.anchor.clone().project(camera);
      label.style.left = `${((p.x + 1) / 2) * canvas.clientWidth}px`;
      label.style.top = `${((1 - p.y) / 2) * canvas.clientHeight}px`;
    }
  }

  dispose(): void {
    this.clear();
    this.markerMaterial.dispose();
    this.lineMaterial.dispose();
    this.faceMaterial.dispose();
    this.hoverFaceMaterial.dispose();
  }

  private makeLabel(): HTMLDivElement {
    const label = document.createElement('div');
    label.className = 'measure-label';
    label.append(document.createElement('span'));
    const remove = document.createElement('button');
    remove.title = 'Remove';
    remove.ariaLabel = 'Remove measurement';
    remove.textContent = '×';
    label.append(remove);
    this.container.appendChild(label);
    return label;
  }

  private setResult(d: Done, result: Result): void {
    d.result = result;
    d.label.firstElementChild!.textContent = result.text;
    d.label.classList.toggle('warn', !!result.warn);
  }

  private remove(d: Done): void {
    d.label.remove();
    this.done = this.done.filter((x) => x !== d);
    this.rebuild();
    this.onChange();
  }

  private rebuild(): void {
    clearGroup(this.group);

    const add = (o: THREE.Object3D) => {
      o.renderOrder = 10;
      this.group.add(o);
    };

    const picks = [...this.done.flatMap((d) => d.picks), ...this.picks];
    for (const p of picks) {
      const o = this.highlight(p, this.faceMaterial);
      if (o) add(o);
    }
    const markers = picks.filter((p) => p.kind === 'point').map((p) => p.point);
    const lines = this.done.flatMap((d) => d.result.lines);
    if (lines.length) {
      add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(lines), this.lineMaterial));
      markers.push(...lines);
    }
    if (markers.length) add(new THREE.Points(new THREE.BufferGeometry().setFromPoints(markers), this.markerMaterial));
  }

  private highlight(p: Pick, faceMaterial: THREE.Material): THREE.Object3D | null {
    const geometry = (positions: Float32Array) =>
      new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const o =
      p.kind === 'edge'
        ? new THREE.LineSegments(geometry(p.segments), this.lineMaterial)
        : p.kind === 'face'
          ? new THREE.Mesh(geometry(p.triangles), faceMaterial)
          : null;
    if (o) o.renderOrder = 10;
    return o;
  }
}

function clearGroup(group: THREE.Group): void {
  group.traverse((o) => {
    if (o instanceof THREE.Mesh || o instanceof THREE.Line || o instanceof THREE.Points) o.geometry.dispose();
  });
  group.clear();
}
