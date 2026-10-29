import type { ServerElement } from '../types.js';
import { elements } from './live-scene.js';

// Edge point of a shape in the direction of a target, so bound arrows start
// and end at the border rather than the centre.
export function computeEdgePoint(el: ServerElement, targetCenterX: number, targetCenterY: number): { x: number; y: number } {
  const cx = el.x + (el.width || 0) / 2;
  const cy = el.y + (el.height || 0) / 2;
  const dx = targetCenterX - cx;
  const dy = targetCenterY - cy;

  if (el.type === 'diamond') {
    const hw = (el.width || 0) / 2;
    const hh = (el.height || 0) / 2;
    if (dx === 0 && dy === 0) return { x: cx, y: cy + hh };
    const absDx = Math.abs(dx);
    const absDy = Math.abs(dy);
    const scale = (absDx / hw + absDy / hh) > 0 ? 1 / (absDx / hw + absDy / hh) : 1;
    return { x: cx + dx * scale, y: cy + dy * scale };
  }

  if (el.type === 'ellipse') {
    const a = (el.width || 0) / 2;
    const b = (el.height || 0) / 2;
    if (dx === 0 && dy === 0) return { x: cx, y: cy + b };
    const angle = Math.atan2(dy, dx);
    return { x: cx + a * Math.cos(angle), y: cy + b * Math.sin(angle) };
  }

  const hw = (el.width || 0) / 2;
  const hh = (el.height || 0) / 2;
  if (dx === 0 && dy === 0) return { x: cx, y: cy + hh };
  const angle = Math.atan2(dy, dx);
  const tanA = Math.tan(angle);
  if (Math.abs(tanA * hw) <= hh) {
    const signX = dx >= 0 ? 1 : -1;
    return { x: cx + signX * hw, y: cy + signX * hw * tanA };
  }
  const signY = dy >= 0 ? 1 : -1;
  return { x: cx + signY * hh / tanA, y: cy + signY * hh };
}

// Resolve `start`/`end` references into arrow geometry. `includeExisting`
// lets a batch bind to shapes already on the canvas.
export function resolveArrowBindings(batchElements: ServerElement[], includeExisting = true): void {
  const elementMap = new Map<string, ServerElement>();
  batchElements.forEach(el => elementMap.set(el.id, el));
  if (includeExisting) {
    elements.forEach((el, id) => {
      if (!elementMap.has(id)) elementMap.set(id, el);
    });
  }

  for (const el of batchElements) {
    if (el.type !== 'arrow' && el.type !== 'line') continue;
    const startRef = el.start;
    const endRef = el.end;
    if (!startRef && !endRef) continue;

    const startEl = startRef ? elementMap.get(startRef.id) : undefined;
    const endEl = endRef ? elementMap.get(endRef.id) : undefined;

    const startCenter = startEl
      ? { x: startEl.x + (startEl.width || 0) / 2, y: startEl.y + (startEl.height || 0) / 2 }
      : { x: el.x, y: el.y };
    const endCenter = endEl
      ? { x: endEl.x + (endEl.width || 0) / 2, y: endEl.y + (endEl.height || 0) / 2 }
      : { x: el.x + 100, y: el.y };

    const GAP = 8;
    const startPt = startEl ? computeEdgePoint(startEl, endCenter.x, endCenter.y) : startCenter;
    const endPt = endEl ? computeEdgePoint(endEl, startCenter.x, startCenter.y) : endCenter;

    const startDx = endPt.x - startPt.x;
    const startDy = endPt.y - startPt.y;
    const startDist = Math.sqrt(startDx * startDx + startDy * startDy) || 1;
    const endDx = startPt.x - endPt.x;
    const endDy = startPt.y - endPt.y;
    const endDist = Math.sqrt(endDx * endDx + endDy * endDy) || 1;

    const finalStart = { x: startPt.x + (startDx / startDist) * GAP, y: startPt.y + (startDy / startDist) * GAP };
    const finalEnd = { x: endPt.x + (endDx / endDist) * GAP, y: endPt.y + (endDy / endDist) * GAP };

    el.x = finalStart.x;
    el.y = finalStart.y;
    el.points = [[0, 0], [finalEnd.x - finalStart.x, finalEnd.y - finalStart.y]];
    // `start`/`end` stay: the tab's converter derives real bindings from them.
  }
}

// After a shape moves or resizes, re-route every arrow bound to it.
export function rerouteBoundArrows(movedId: string): ServerElement[] {
  const rerouted: ServerElement[] = [];
  elements.forEach(el => {
    if (el.type !== 'arrow' && el.type !== 'line') return;
    if (el.start?.id !== movedId && el.end?.id !== movedId) return;
    resolveArrowBindings([el]);
    el.updatedAt = new Date().toISOString();
    el.version = (el.version || 0) + 1;
    rerouted.push(el);
  });
  return rerouted;
}
