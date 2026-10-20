// 16px Lucide icons (https://lucide.dev, ISC) drawn in the current text colour.
import {
  Check,
  ChevronDown,
  ChevronRight as LucideChevronRight,
  Eye,
  FileUp,
  Gem,
  Ghost,
  Grid3x3,
  Icon,
  Info,
  Lock,
  Maximize,
  Palette,
  Ruler,
  ScanSearch,
  Sun,
  Target,
  Video,
  X,
  type IconNode,
  type LucideIcon,
} from 'lucide-react';

const SIZE = 16;
const STROKE = 1.75;

const icon = (Glyph: LucideIcon) => () => <Glyph size={SIZE} strokeWidth={STROKE} />;

// Lucide's box, split up so the display modes can drop edges or fill the faces.
const BOX_OUTLINE = 'M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z';
const BOX_EDGES: IconNode = [
  ['path', { d: 'm3.3 7 8.7 5 8.7-5', key: 'edges' }],
  ['path', { d: 'M12 22V12', key: 'edge' }],
];
const SHADED: IconNode = [['path', { d: BOX_OUTLINE, fill: 'currentColor', fillOpacity: 0.35, key: 'outline' }]];

const custom = (node: IconNode) => () => <Icon iconNode={node} size={SIZE} strokeWidth={STROKE} />;

export const Chevron = icon(ChevronDown);
export const ChevronRight = icon(LucideChevronRight);
export const CheckIcon = icon(Check);
export const IsolateIcon = icon(Target);
export const PropertiesIcon = icon(Info);
export const FitIcon = icon(Maximize);
export const ZoomSelectionIcon = icon(ScanSearch);
export const ViewsIcon = icon(Video);
export const ShadedEdgesIcon = custom([...SHADED, ...BOX_EDGES]);
// The silhouette alone: no edges are drawn.
export const ShadedIcon = custom(SHADED);
export const WireframeIcon = custom([['path', { d: BOX_OUTLINE, key: 'outline' }], ...BOX_EDGES]);
// A shiny material.
export const RealisticIcon = icon(Gem);
// The studio style's warm key light.
export const StudioIcon = icon(Sun);
export const GridIcon = icon(Grid3x3);
// The GD&T position symbol in a frame cell, so PMI doesn't read as another ruler.
export const PmiIcon = custom([
  ['rect', { x: 3, y: 3, width: 18, height: 18, rx: 2, key: 'frame' }],
  ['circle', { cx: 12, cy: 12, r: 5, key: 'circle' }],
  ['path', { d: 'M12 5.5v13M5.5 12h13', key: 'cross' }],
]);
// Lucide's square-split-horizontal with the kept left half filled.
export const SectionIcon = custom([
  ['path', { d: 'M12 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7Z', fill: 'currentColor', key: 'kept' }],
  ['path', { d: 'M12 2v20', key: 'plane' }],
  ['path', { d: 'M16 3h3a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-3', key: 'cut' }],
]);
export const MeasureIcon = icon(Ruler);
export const AppearanceIcon = icon(Palette);
// The box's three faces, shrunk and pushed out from its centre.
export const ExplodeIcon = custom([
  ['path', { d: 'M12 2.25 18.3 5.75 12 9.25 5.7 5.75Z', key: 'top' }],
  ['path', { d: 'M3.32 9.88 9.62 13.38v7l-6.3-3.5Z', key: 'left' }],
  ['path', { d: 'M20.68 9.88 14.38 13.38v7l6.3-3.5Z', key: 'right' }],
]);
export const GhostIcon = icon(Ghost);
export const ShowAllIcon = icon(Eye);
export const OpenFileIcon = icon(FileUp);
export const LockIcon = icon(Lock);
export const CloseIcon = icon(X);
