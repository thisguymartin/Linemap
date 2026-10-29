import type { ServerElement, ExcalidrawFile, Snapshot } from '../types.js';
import type { DiagramScene } from '../domain/model.js';

// The live canvas: what every connected tab shows and what the drawing tools
// mutate. It is always the working copy of exactly one diagram (see
// domain/workspace.ts), and every mutation calls markSceneDirty() so the
// workspace can persist it.

export const elements = new Map<string, ServerElement>();
export const files = new Map<string, ExcalidrawFile>();

// Ephemeral named snapshots (not persisted; versions are the durable thing).
export const snapshots = new Map<string, Snapshot>();

type DirtyListener = () => void;
const dirtyListeners = new Set<DirtyListener>();

export function onSceneDirty(listener: DirtyListener): () => void {
  dirtyListeners.add(listener);
  return () => dirtyListeners.delete(listener);
}

export function markSceneDirty(): void {
  for (const listener of dirtyListeners) listener();
}

export function captureScene(): DiagramScene {
  return structuredClone({
    elements: Array.from(elements.values()),
    files: Object.fromEntries(files)
  });
}

// Replace the live scene wholesale. Does not broadcast; the caller decides
// which message the tabs get.
export function loadScene(scene: DiagramScene): void {
  elements.clear();
  files.clear();
  for (const element of structuredClone(scene.elements ?? [])) elements.set(element.id, element);
  for (const [id, file] of Object.entries(structuredClone(scene.files ?? {}))) files.set(id, file);
}

export function filesRecord(): Record<string, ExcalidrawFile> {
  return Object.fromEntries(files);
}
