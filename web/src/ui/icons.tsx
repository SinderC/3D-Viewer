// 16px line icons drawn in the current text colour.
import type { ReactNode } from 'react';

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

const CUBE = 'M8 1.5l5.5 3v7L8 14.5l-5.5-3v-7z';
const CUBE_FRONT_EDGES = 'M2.5 4.5L8 7.5l5.5-3M8 7.5v7';
const CORNERS = 'M2 6V2h4M10 2h4v4M14 10v4h-4M6 14H2v-4';

export const Chevron = () => (
  <Icon>
    <path d="M5 6.5l3 3 3-3" />
  </Icon>
);

export const FitIcon = () => (
  <Icon>
    <path d={CORNERS} />
  </Icon>
);

export const ZoomSelectionIcon = () => (
  <Icon>
    <path d={CORNERS} />
    <rect x="6" y="6" width="4" height="4" fill="currentColor" />
  </Icon>
);

export const ViewsIcon = () => (
  <Icon>
    <path d={CUBE} />
    <path d={CUBE_FRONT_EDGES} />
    <path d="M8 7.5l5.5-3v7L8 14.5z" fill="currentColor" fillOpacity="0.45" />
  </Icon>
);

// Oblique box: parallel edges stay parallel.
export const OrthoIcon = () => (
  <Icon>
    <rect x="2" y="5" width="9" height="9" />
    <path d="M2 5l3-3h9v9l-3 3M11 5l3-3" />
  </Icon>
);

export const ShadedEdgesIcon = () => (
  <Icon>
    <path d={CUBE} fill="currentColor" fillOpacity="0.35" />
    <path d={CUBE_FRONT_EDGES} />
  </Icon>
);

export const ShadedIcon = () => (
  <Icon>
    <path d={CUBE} fill="currentColor" fillOpacity="0.6" stroke="none" />
  </Icon>
);

export const WireframeIcon = () => (
  <Icon>
    <path d={CUBE} />
    <path d={CUBE_FRONT_EDGES} />
    <path d="M2.5 11.5L8 8.5l5.5 3M8 1.5v7" strokeDasharray="1.5 1.5" strokeWidth="1" />
  </Icon>
);

// Grid in perspective, like a ground plane.
export const GridIcon = () => (
  <Icon>
    <path d="M4 4.5h8L15 12H1zM1.75 10h12.5M2.8 7.25h10.4M6.7 4.5 5.7 12M9.3 4.5l1 7.5" />
  </Icon>
);

// Dimension with arrows and extension lines.
export const PmiIcon = () => (
  <Icon>
    <path d="M2 3v10M14 3v10M2 8h12M4.5 6 2 8l2.5 2M11.5 6 14 8l-2.5 2" />
  </Icon>
);

export const SectionIcon = () => (
  <Icon>
    <rect x="2" y="2" width="12" height="12" />
    <rect x="2" y="2" width="6" height="12" fill="currentColor" fillOpacity="0.45" stroke="none" />
    <path d="M8 1v14" />
  </Icon>
);

export const MeasureIcon = () => (
  <Icon>
    <path d="M1.5 10.5l9-9 4 4-9 9zM4.5 7.5L6 9M6.5 5.5L8 7M8.5 3.5L10 5" />
  </Icon>
);

export const ShowAllIcon = () => (
  <Icon>
    <path d="M1 8s2.5-5 7-5 7 5 7 5-2.5 5-7 5-7-5-7-5z" />
    <circle cx="8" cy="8" r="2" />
  </Icon>
);

export const OpenFileIcon = () => (
  <Icon>
    <path d="M9.5 1.5H4a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V5z M9.5 1.5V5H13 M8 12V7.5 M6 9.5l2-2 2 2" />
  </Icon>
);

export const LockIcon = () => (
  <Icon>
    <rect x="3.5" y="7" width="9" height="7" rx="1" />
    <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
  </Icon>
);
