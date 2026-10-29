import { useMemo, type ReactElement } from 'react';
import type { DiagramMeta, Link } from '../api';
import { stationSize } from './StationLine';

// The project as a transit map: stations along a snaking route, links as
// dashed interchange arcs, the active station ringed, a marker riding the
// line. Pure SVG; the browser does the animation.

interface Props {
  diagrams: DiagramMeta[];
  links: Link[];
  activeId: string | null;
  labels?: Map<string, string>;
  onOpen: (diagramId: string) => void;
  markerKey?: number;
}

const VIEW_W = 960;
const PER_ROW = 5;
const MAX_COL_W = 240;
const ROW_H = 170;
const PAD_X = 80;
const LABEL_PX = 7.2; // ≈ width of one bold 12px character

function layout(diagrams: DiagramMeta[]): { positions: Array<{ x: number; y: number }>; width: number; height: number; padY: number } {
  const count = diagrams.length;
  const cols = Math.min(PER_ROW, Math.max(1, count));
  const colW = cols > 1 ? Math.min(MAX_COL_W, (VIEW_W - PAD_X * 2) / (cols - 1)) : 0;
  const routeW = (cols - 1) * colW;
  const offsetX = (VIEW_W - routeW) / 2;
  const longest = diagrams.reduce((max, d) => Math.max(max, d.name.length), 0);
  // 45° labels need headroom proportional to the longest name.
  const padY = Math.min(190, Math.max(80, 44 + longest * LABEL_PX * 0.72));
  const positions: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < count; i++) {
    const row = Math.floor(i / PER_ROW);
    const col = i % PER_ROW;
    const x = offsetX + (row % 2 === 0 ? col : (cols - 1 - col)) * colW;
    const y = padY + row * ROW_H;
    positions.push({ x, y });
  }
  const rows = Math.max(1, Math.ceil(count / PER_ROW));
  return { positions, width: VIEW_W, height: padY + (rows - 1) * ROW_H + 70, padY };
}

function routePath(positions: Array<{ x: number; y: number }>): string {
  if (positions.length === 0) return '';
  if (positions.length === 1) return `M ${positions[0].x - 60} ${positions[0].y} L ${positions[0].x + 60} ${positions[0].y}`;
  const r = 28;
  let d = `M ${positions[0].x} ${positions[0].y}`;
  for (let i = 1; i < positions.length; i++) {
    const prev = positions[i - 1];
    const next = positions[i];
    if (prev.y === next.y) {
      d += ` L ${next.x} ${next.y}`;
    } else {
      const dir = prev.x >= next.x ? 1 : -1;
      const turnX = prev.x + dir * 50;
      d += ` L ${turnX - dir * r} ${prev.y} Q ${turnX} ${prev.y} ${turnX} ${prev.y + r}`;
      d += ` L ${turnX} ${next.y - r} Q ${turnX} ${next.y} ${turnX - dir * r} ${next.y}`;
      d += ` L ${next.x} ${next.y}`;
    }
  }
  return d;
}

export function TransitMap({ diagrams, links, activeId, labels, onOpen, markerKey = 0 }: Props): ReactElement {
  const { positions, width, height } = useMemo(() => layout(diagrams), [diagrams]);
  const byId = useMemo(() => new Map(diagrams.map((d, i) => [d.id, { diagram: d, pos: positions[i] }])), [diagrams, positions]);
  const path = routePath(positions);
  const interchangeIds = useMemo(() => new Set(links.flatMap(l => [l.from.diagramId, l.to.diagramId])), [links]);

  const arcs = links.flatMap((link, index) => {
    const from = byId.get(link.from.diagramId);
    const to = byId.get(link.to.diagramId);
    if (!from || !to) return [];
    const above = index % 2 === 0;
    const dx = to.pos.x - from.pos.x;
    const dy = to.pos.y - from.pos.y;
    const dist = Math.hypot(dx, dy) || 1;
    const lift = Math.min(70, 28 + dist * 0.18) * (above ? -1 : 1);
    const mx = (from.pos.x + to.pos.x) / 2 - (dy / dist) * lift;
    const my = (from.pos.y + to.pos.y) / 2 + (dx / dist) * lift;
    const fromLabel = link.from.elementId ? labels?.get(`${link.from.diagramId}:${link.from.elementId}`) : undefined;
    return [{
      id: link.id,
      d: `M ${from.pos.x} ${from.pos.y} Q ${mx} ${my} ${to.pos.x} ${to.pos.y}`,
      labelX: (from.pos.x + 2 * mx + to.pos.x) / 4,
      labelY: (from.pos.y + 2 * my + to.pos.y) / 4 + (above ? -8 : 16),
      text: fromLabel ? `${fromLabel} · ${link.relation}` : link.relation
    }];
  });

  return (
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Map of ${diagrams.length} diagrams and ${links.length} links`} style={{ maxHeight: 520 }}>
      <defs>
        <marker id="link-head" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" className="map-link-head" />
        </marker>
      </defs>
      <path id="route-path" d={path} className="map-route" />
      {arcs.map(arc => (
        <g key={arc.id}>
          <path d={arc.d} className="map-link" markerEnd="url(#link-head)" />
          <text x={arc.labelX} y={arc.labelY} textAnchor="middle" className="map-link-label">{arc.text}</text>
        </g>
      ))}
      {diagrams.map((diagram, index) => {
        const pos = positions[index];
        const r = stationSize(diagram.elementCount) / 2 + 2;
        const active = diagram.id === activeId;
        const confirmed = diagram.latestConfirmedVersion !== null;
        const interchange = interchangeIds.has(diagram.id);
        return (
          <g
            key={diagram.id}
            className="map-station"
            data-active={active ? 'true' : 'false'}
            data-confirmed={confirmed ? 'true' : 'false'}
            transform={`translate(${pos.x} ${pos.y})`}
            tabIndex={0}
            role="button"
            aria-label={`Open ${diagram.name}`}
            onClick={() => onOpen(diagram.id)}
            onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onOpen(diagram.id); } }}
          >
            <circle className="map-ring" r={r + 4} />
            {interchange && <circle className="interchange" r={r + 4.5} />}
            <circle className="dot" r={r} />
            <text transform={`translate(${r + 2} ${-r - 4}) rotate(-45)`}>{diagram.name}</text>
            <text className="sub" y={r + 16} textAnchor="middle">
              {diagram.elementCount} el{diagram.latestVersion ? ` · v${diagram.latestVersion}` : ''}
            </text>
          </g>
        );
      })}
      {diagrams.length > 1 && markerKey > 0 && (
        <circle key={markerKey} r={5} className="map-train">
          <animateMotion dur={`${Math.max(4, diagrams.length * 1.5)}s`} repeatCount="1" fill="freeze">
            <mpath href="#route-path" />
          </animateMotion>
        </circle>
      )}
    </svg>
  );
}

// The map's symbol key, drawn with the same marks the map uses.
export function MapKey(): ReactElement {
  const dot = (extra: ReactElement | null, stroke = 'var(--station-ring)', width = 2.5): ReactElement => (
    <svg viewBox="0 0 18 18" aria-hidden="true">
      <path d="M0 9h18" stroke="var(--route-line)" strokeWidth={4} />
      {extra}
      <circle cx="9" cy="9" r="4" fill="var(--station-fill)" stroke={stroke} strokeWidth={width} />
    </svg>
  );
  return (
    <div className="map-key" aria-label="Map key">
      <span>{dot(null)} diagram</span>
      <span>{dot(<circle cx="9" cy="9" r="7" fill="none" stroke="var(--station-ring)" strokeWidth={1.5} />)} linked</span>
      <span>{dot(null, 'var(--ok)')} confirmed</span>
      <span>{dot(null, 'var(--route)', 3.5)} on canvas</span>
      <span><svg viewBox="0 0 18 18" aria-hidden="true"><path d="M1 13 Q 9 2 17 13" fill="none" stroke="var(--ink-3)" strokeWidth={2} strokeDasharray="3 3" /></svg> link</span>
    </div>
  );
}
