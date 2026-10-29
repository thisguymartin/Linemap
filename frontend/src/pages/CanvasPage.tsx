import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import {
  Excalidraw,
  convertToExcalidrawElements,
  CaptureUpdateAction,
  exportToBlob,
  exportToSvg,
  useHandleLibrary
} from '@excalidraw/excalidraw';
import type { ExcalidrawElement, NonDeletedExcalidrawElement } from '@excalidraw/excalidraw/element/types';
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types';
import type { LibraryPersistedData, LibraryPersistenceAdapter } from '@excalidraw/excalidraw/data/library';
import { convertMermaidToExcalidraw, normalizeMermaidConfig } from '../utils/mermaidConverter';
import { cleanElementForExcalidraw, prepareServerScene, assertScenePreserved } from '../utils/scene';
import { preloadCanvasFonts } from '../utils/fonts';
import type { ServerElement } from '../utils/scene';
import { api, diagramPath, fmtTime, projectPath, type DiagramMeta, type Link, type Note } from '../api';
import { applyRoute } from '../color';
import { useChat } from '../chat';
import { navigate, onLinkClick } from '../router';
import { useSiblingDiagrams, useWorkspace, type SocketMessage } from '../workspace';
import { Icon } from '../icons';
import { StationLine } from '../components/StationLine';
import { SidePanel, type PanelTab } from '../components/SidePanel';
import type { SelectedElementInfo } from '../components/ContextTab';

const LIBRARY_STORAGE_KEY = 'excalidraw-canvas-library';
const PANEL_OPEN_KEY = 'excalidraw-panel-open';
const PANEL_TAB_KEY = 'excalidraw-panel-tab';
const AUTO_SYNC_DEBOUNCE_MS = 1200;
const SCENE_MUTATIONS = new Set(['element_created', 'element_updated', 'element_deleted', 'elements_batch_created']);

// The user's library is a user asset, not scene data: keep it in this browser.
const libraryAdapter: LibraryPersistenceAdapter = {
  load: () => {
    try {
      const raw = window.localStorage?.getItem(LIBRARY_STORAGE_KEY);
      return raw ? { libraryItems: JSON.parse(raw) } : null;
    } catch (error) {
      console.warn('Failed to read library from localStorage:', error);
      return null;
    }
  },
  save: (data: LibraryPersistedData) => {
    try {
      window.localStorage?.setItem(LIBRARY_STORAGE_KEY, JSON.stringify(data.libraryItems));
    } catch (error) {
      console.warn('Failed to save library to localStorage:', error);
    }
  }
};

interface ExportImageOptions { background?: boolean; dark?: boolean; scale?: number; padding?: number; elementIds?: string[]; frameId?: string }

type SceneLoadStatus = 'loading' | 'ready' | 'failed';
type SyncState = 'offline' | 'loading' | 'saved' | 'editing' | 'syncing' | 'error';

function readStored<T extends string>(key: string, fallback: T, allowed: readonly T[]): T {
  try {
    const value = window.localStorage?.getItem(key);
    return allowed.includes(value as T) ? (value as T) : fallback;
  } catch {
    return fallback;
  }
}

function elementLabel(element: { id: string; type: string; text?: string; boundElements?: readonly { id: string; type: string }[] | null }, byId: Map<string, { text?: string }>): string {
  if (element.type === 'text' && typeof element.text === 'string') return element.text.replace(/\s+/g, ' ').slice(0, 40) || 'text';
  const bound = (element.boundElements ?? []).find(b => b.type === 'text');
  const text = bound ? byId.get(bound.id)?.text : undefined;
  if (text) return text.replace(/\s+/g, ' ').slice(0, 40);
  return `${element.type} ${element.id.slice(0, 6)}`;
}

export function CanvasPage({ projectId, diagramId }: { projectId: string; diagramId: string }): ReactElement {
  const ws = useWorkspace();
  const { connected, connectionGeneration, activeDiagramId, subscribe, theme, setTheme, project, loadProject, toast, lastSave, eventTick } = ws;

  const [excalidrawAPI, setExcalidrawAPI] = useState<ExcalidrawImperativeAPI | null>(null);
  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null);
  useEffect(() => { apiRef.current = excalidrawAPI; }, [excalidrawAPI]);
  useHandleLibrary({ excalidrawAPI, adapter: libraryAdapter });

  const [sceneLoadStatus, setSceneLoadStatus] = useState<SceneLoadStatus>('loading');
  const sceneLoadStatusRef = useRef<SceneLoadStatus>('loading');
  const sceneGenerationRef = useRef(0);
  const sceneDiagramIdRef = useRef<string | null>(null);
  const autoSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const syncInFlightRef = useRef(false);
  const suppressAutoSyncCountRef = useRef(0);
  const userInteractedRef = useRef(false);
  const serverFileIdsRef = useRef<Set<string>>(new Set());
  const [syncState, setSyncState] = useState<SyncState>('loading');
  const [elementCount, setElementCount] = useState(0);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const selectedKeyRef = useRef('');
  const sceneVersionRef = useRef(-1);
  const [sceneTick, setSceneTick] = useState(0);

  const [panelOpen, setPanelOpen] = useState<boolean>(() => readStored(PANEL_OPEN_KEY, window.innerWidth > 900 ? 'true' : 'false', ['true', 'false']) === 'true');
  const [panelTab, setPanelTab] = useState<PanelTab>(() => readStored<PanelTab>(PANEL_TAB_KEY, 'chat', ['chat', 'versions', 'notes', 'context']));
  const [saveFocusTick, setSaveFocusTick] = useState(0);
  const [pulseKey, setPulseKey] = useState(0);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [links, setLinks] = useState<Link[]>([]);
  const [openNotes, setOpenNotes] = useState<Note[]>([]);
  const [versionCount, setVersionCount] = useState(0);
  const [newNotes, setNewNotes] = useState(false);
  const chat = useChat(projectId);
  const [chatNew, setChatNew] = useState(false);
  useEffect(() => {
    if (chat.lastFinishedId && !(panelOpen && panelTab === 'chat')) setChatNew(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chat.lastFinishedId]);
  useEffect(() => { if (panelOpen && panelTab === 'chat') setChatNew(false); }, [panelOpen, panelTab]);
  const bootRef = useRef(true);
  const diagramIdRef = useRef(diagramId);
  diagramIdRef.current = diagramId;

  useEffect(() => { try { window.localStorage?.setItem(PANEL_OPEN_KEY, String(panelOpen)); } catch { /* ignore */ } }, [panelOpen]);
  useEffect(() => { try { window.localStorage?.setItem(PANEL_TAB_KEY, panelTab); } catch { /* ignore */ } }, [panelTab]);

  // ---- which diagram is on the canvas -------------------------------------

  useEffect(() => { void loadProject(projectId); }, [projectId, loadProject]);

  // URL is the intent at boot; afterwards the server's active diagram leads
  // (an agent opening a diagram moves every tab there).
  useEffect(() => {
    if (!activeDiagramId) return;
    if (bootRef.current) {
      bootRef.current = false;
      if (activeDiagramId !== diagramIdRef.current) {
        api.openDiagram(diagramIdRef.current).catch(() => {
          toast('That diagram no longer exists; showing the active one', 'error');
          navigate(diagramPath(ws.activeProjectId ?? projectId, activeDiagramId), { replace: true });
        });
      }
      return;
    }
    if (activeDiagramId !== diagramIdRef.current) {
      navigate(diagramPath(ws.activeProjectId ?? projectId, activeDiagramId), { replace: true });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeDiagramId]);

  // User navigated to another diagram (station click, link, back button).
  useEffect(() => {
    if (bootRef.current || !activeDiagramId || activeDiagramId === diagramId) return;
    api.openDiagram(diagramId).catch(() => {
      toast('That diagram no longer exists', 'error');
      navigate(diagramPath(ws.activeProjectId ?? projectId, activeDiagramId), { replace: true });
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [diagramId]);

  const diagram: DiagramMeta | null = useMemo(() => project?.diagrams.find(d => d.id === diagramId) ?? null, [project, diagramId]);
  const siblings = useSiblingDiagrams(project);

  useEffect(() => {
    applyRoute(project?.color ?? null, theme);
    document.title = diagram && project ? `${diagram.name} · ${project.name} · Linemap` : 'Linemap';
  }, [project, diagram, theme]);

  useEffect(() => {
    if (!project) return;
    void api.links(project.id, diagramId).then(setLinks).catch(() => setLinks([]));
  }, [project, diagramId, eventTick.link_changed]);

  useEffect(() => {
    if (!project) return;
    void api.notes(project.id).then(list => {
      setOpenNotes(list.filter(n => (n.diagramId === diagramId || n.diagramId === null) && !n.resolved));
    }).catch(() => undefined);
  }, [project, diagramId, eventTick.note_changed]);

  useEffect(() => {
    const last = ws.lastEvent;
    if (last?.event === 'note_changed' && last.diagramId === diagramId && panelTab !== 'notes') setNewNotes(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventTick.note_changed]);
  useEffect(() => { if (panelTab === 'notes' && panelOpen) setNewNotes(false); }, [panelTab, panelOpen]);

  useEffect(() => {
    void api.versions(diagramId).then(list => setVersionCount(list.length)).catch(() => undefined);
  }, [diagramId, eventTick.version_changed]);

  useEffect(() => {
    if (lastSave?.diagramId === diagramId) {
      setSyncState('saved');
      setPulseKey(k => k + 1);
    }
  }, [lastSave, diagramId]);

  // ---- scene loading / sync (ported from the single-canvas app) ------------

  const pauseSceneSync = useCallback((status: SceneLoadStatus = 'loading'): number => {
    sceneGenerationRef.current += 1;
    sceneLoadStatusRef.current = status;
    setSceneLoadStatus(status);
    if (autoSyncTimerRef.current) {
      clearTimeout(autoSyncTimerRef.current);
      autoSyncTimerRef.current = null;
    }
    return sceneGenerationRef.current;
  }, []);

  const failSceneLoad = useCallback((error: unknown, generation = sceneGenerationRef.current): void => {
    if (generation !== sceneGenerationRef.current) return;
    console.error('Scene load failed; backend sync is paused:', error);
    pauseSceneSync('failed');
    setSyncState('error');
  }, [pauseSceneSync]);

  const canSyncScene = (): boolean => sceneLoadStatusRef.current === 'ready' && connected;

  const applySceneUpdateWithoutAutoSync = (api: ExcalidrawImperativeAPI, scene: Parameters<ExcalidrawImperativeAPI['updateScene']>[0]): void => {
    suppressAutoSyncCountRef.current += 1;
    try {
      api.updateScene(scene);
    } finally {
      setTimeout(() => { suppressAutoSyncCountRef.current = Math.max(0, suppressAutoSyncCountRef.current - 1); }, 0);
    }
  };

  const rememberServerFiles = (files: unknown): void => {
    const list = Array.isArray(files) ? files : Object.values((files as Record<string, unknown>) || {});
    for (const file of list as { id?: unknown }[]) {
      if (typeof file?.id === 'string') serverFileIdsRef.current.add(file.id);
    }
  };

  const applyServerScene = (incoming: readonly Partial<ExcalidrawElement>[], generation: number, files?: Record<string, unknown>, opts: { refreshDimensions?: boolean } = {}): void => {
    const api = apiRef.current;
    if (!api || generation !== sceneGenerationRef.current) return;
    const prepared = prepareServerScene(incoming, opts);
    const previous = api.getSceneElementsIncludingDeleted();
    try {
      if (files) {
        api.addFiles(Object.values(files) as Parameters<typeof api.addFiles>[0]);
        rememberServerFiles(files);
      }
      applySceneUpdateWithoutAutoSync(api, { elements: prepared, captureUpdate: CaptureUpdateAction.NEVER });
      assertScenePreserved(prepared, api.getSceneElements());
    } catch (error) {
      applySceneUpdateWithoutAutoSync(api, { elements: previous, captureUpdate: CaptureUpdateAction.NEVER });
      throw error;
    }
    sceneLoadStatusRef.current = 'ready';
    setSceneLoadStatus('ready');
    setElementCount(prepared.filter(el => !el.isDeleted).length);
    setSceneTick(t => t + 1);
    setSyncState(s => (s === 'loading' || s === 'error' || s === 'offline' ? 'saved' : s));
  };

  const loadExistingElements = useCallback(async (): Promise<void> => {
    if (!apiRef.current) return;
    const generation = pauseSceneSync();
    try {
      const response = await fetch('/api/elements', { signal: AbortSignal.timeout(10000) });
      const result = await response.json() as { success: boolean; elements?: ServerElement[]; diagramId?: string | null; error?: string };
      if (generation !== sceneGenerationRef.current) return;
      if (!response.ok || !result.success || !Array.isArray(result.elements)) throw new Error(result.error || 'Invalid scene response');
      const filesResponse = await fetch('/api/files', { signal: AbortSignal.timeout(10000) });
      const filesResult = await filesResponse.json() as { files?: Record<string, unknown> };
      if (generation !== sceneGenerationRef.current) return;
      if (!filesResponse.ok || !filesResult.files) throw new Error('Could not load scene files');
      await preloadCanvasFonts();
      if (generation !== sceneGenerationRef.current) return;
      sceneDiagramIdRef.current = result.diagramId ?? null;
      applyServerScene(result.elements.map(cleanElementForExcalidraw), generation, filesResult.files);
    } catch (error) {
      failSceneLoad(error, generation);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pauseSceneSync, failSceneLoad]);

  useEffect(() => {
    if (excalidrawAPI && connected && sceneLoadStatusRef.current !== 'ready') void loadExistingElements();
  }, [excalidrawAPI, connected, connectionGeneration, loadExistingElements]);

  useEffect(() => {
    if (!connected) {
      setSyncState('offline');
      pauseSceneSync();
    } else {
      setSyncState(s => (s === 'offline' ? 'loading' : s));
    }
  }, [connected, pauseSceneSync]);

  // Fonts that arrive late leave text measured with a fallback; re-measure once.
  useEffect(() => {
    const fontSet = document.fonts;
    if (!fontSet?.addEventListener) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const remeasureText = (): void => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const api = apiRef.current;
        if (!api || sceneLoadStatusRef.current !== 'ready') return;
        const current = api.getSceneElements();
        if (!current.some(el => el.type === 'text')) return;
        try {
          applyServerScene(current, sceneGenerationRef.current, undefined, { refreshDimensions: true });
        } catch (error) {
          console.warn('Could not re-measure text after fonts loaded:', error);
        }
      }, 50);
    };
    fontSet.addEventListener('loadingdone', remeasureText);
    return () => { fontSet.removeEventListener('loadingdone', remeasureText); clearTimeout(timer); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const syncToBackend = useCallback(async (options: { silent?: boolean } = {}): Promise<void> => {
    if (!canSyncScene()) return;
    const api = apiRef.current;
    if (!api || syncInFlightRef.current) return;
    if (autoSyncTimerRef.current) { clearTimeout(autoSyncTimerRef.current); autoSyncTimerRef.current = null; }
    syncInFlightRef.current = true;
    if (!options.silent) setSyncState('syncing');
    try {
      const activeElements = api.getSceneElements().filter(el => !el.isDeleted);
      const usedFileIds = new Set(activeElements.flatMap(el => el.type === 'image' && el.fileId ? [el.fileId as string] : []));
      const newFiles = Object.values(api.getFiles()).filter(file => usedFileIds.has(file.id) && file.dataURL && !serverFileIdsRef.current.has(file.id));
      for (const file of newFiles) {
        const fileResponse = await fetch('/api/files', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ files: [{ id: file.id, dataURL: file.dataURL, mimeType: file.mimeType, created: file.created }] })
        });
        if (!fileResponse.ok) throw new Error(`Image upload failed: HTTP ${fileResponse.status}`);
        serverFileIdsRef.current.add(file.id);
      }
      const response = await fetch('/api/elements/sync', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ elements: activeElements, timestamp: new Date().toISOString(), diagramId: sceneDiagramIdRef.current ?? undefined })
      });
      if (response.status === 409) {
        // The canvas moved to another diagram under us; drop our edits and reload.
        void loadExistingElements();
        return;
      }
      if (!response.ok) {
        const error = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(error.error || `Sync failed: HTTP ${response.status}`);
      }
      setElementCount(activeElements.length);
      setSyncState('saved');
    } catch (error) {
      console.error('Sync error:', error);
      setSyncState('error');
    } finally {
      syncInFlightRef.current = false;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected, loadExistingElements]);

  const scheduleAutoSync = (): void => {
    if (!canSyncScene() || !apiRef.current || !userInteractedRef.current || suppressAutoSyncCountRef.current > 0) return;
    setSyncState('editing');
    if (autoSyncTimerRef.current) clearTimeout(autoSyncTimerRef.current);
    autoSyncTimerRef.current = setTimeout(() => {
      autoSyncTimerRef.current = null;
      if (suppressAutoSyncCountRef.current > 0 || syncInFlightRef.current) return;
      void syncToBackend({ silent: true });
    }, AUTO_SYNC_DEBOUNCE_MS);
  };

  useEffect(() => () => { if (autoSyncTimerRef.current) clearTimeout(autoSyncTimerRef.current); }, []);

  // ---- socket messages -----------------------------------------------------

  useEffect(() => subscribe(data => { void handleSocketMessage(data); }));

  const handleSocketMessage = async (data: SocketMessage): Promise<void> => {
    const api = apiRef.current;
    if (!api) return;
    if (data.type === 'workspace_event') return;
    if (SCENE_MUTATIONS.has(data.type) && sceneLoadStatusRef.current !== 'ready') {
      void loadExistingElements();
      return;
    }
    try {
      const currentElements = api.getSceneElements();
      const mergeAndApplySceneElements = (incomingElements: Partial<ExcalidrawElement>[]): void => {
        if (incomingElements.length === 0) return;
        const incomingById = new Map<string, Partial<ExcalidrawElement>>();
        incomingElements.forEach(element => { if (element.id) incomingById.set(element.id, element); });
        const merged: Partial<ExcalidrawElement>[] = currentElements.map(element => {
          const incoming = incomingById.get(element.id);
          if (!incoming) return element;
          incomingById.delete(element.id);
          return { ...element, ...incoming };
        });
        merged.push(...incomingById.values());
        applyServerScene(merged, pauseSceneSync(), undefined, { refreshDimensions: true });
      };

      switch (data.type) {
        case 'initial_elements': {
          const generation = pauseSceneSync();
          if (!Array.isArray(data.elements)) throw new Error('Invalid initial scene');
          await preloadCanvasFonts();
          if (generation !== sceneGenerationRef.current) return;
          sceneDiagramIdRef.current = typeof data.diagramId === 'string' ? data.diagramId : null;
          serverFileIdsRef.current = new Set();
          applyServerScene((data.elements as ServerElement[]).map(cleanElementForExcalidraw), generation, data.files as Record<string, unknown> | undefined);
          break;
        }
        case 'files_added':
          if (Array.isArray(data.files)) {
            api.addFiles(data.files as Parameters<typeof api.addFiles>[0]);
            rememberServerFiles(data.files);
          }
          break;
        case 'file_deleted':
          if (typeof data.fileId === 'string') serverFileIdsRef.current.delete(data.fileId);
          break;
        case 'element_created':
        case 'element_updated':
          if (!data.element) throw new Error('Missing element');
          mergeAndApplySceneElements([cleanElementForExcalidraw(data.element as ServerElement)]);
          break;
        case 'element_deleted':
          if (!data.elementId) throw new Error('Missing deleted element ID');
          applyServerScene(currentElements.filter(el => el.id !== data.elementId), pauseSceneSync());
          break;
        case 'elements_batch_created':
          if (!Array.isArray(data.elements)) throw new Error('Invalid element batch');
          mergeAndApplySceneElements((data.elements as ServerElement[]).map(cleanElementForExcalidraw));
          break;
        case 'canvas_cleared':
          applyServerScene([], pauseSceneSync());
          break;
        case 'elements_synced':
        case 'sync_status':
          break;
        case 'export_image_request':
          await handleExportRequest(api, data);
          break;
        case 'set_viewport':
          await handleViewportRequest(api, data);
          break;
        case 'mermaid_convert':
          await handleMermaid(api, data);
          break;
        default:
          break;
      }
    } catch (error) {
      console.error('Error processing WebSocket message:', error, data);
      if (data.type === 'initial_elements' || data.type === 'canvas_cleared' || SCENE_MUTATIONS.has(data.type)) failSceneLoad(error);
    }
  };

  const postResult = (path: string, body: Record<string, unknown>): Promise<unknown> =>
    fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).catch(() => undefined);

  const handleExportRequest = async (api: ExcalidrawImperativeAPI, data: SocketMessage): Promise<void> => {
    const requestId = data.requestId as string | undefined;
    if (!requestId) return;
    try {
      if (!canSyncScene()) throw new Error('Scene is not fully loaded; export is paused');
      const opts = (data.options ?? {}) as ExportImageOptions;
      const allElements = api.getSceneElements();
      const wanted = opts.elementIds ? new Set(opts.elementIds) : null;
      const elements = wanted
        ? allElements.filter(el => wanted.has(el.id) || (el.type === 'text' && (el as { containerId?: string }).containerId && wanted.has((el as { containerId?: string }).containerId!)))
        : allElements;
      const exportingFrame = opts.frameId
        ? (allElements.find(el => el.id === opts.frameId && (el.type === 'frame' || el.type === 'magicframe')) as never) ?? null
        : null;
      if (opts.frameId && !exportingFrame) throw new Error(`Unknown frame id: ${opts.frameId}`);
      const appState = api.getAppState();
      const exportAppState = { ...appState, exportBackground: data.background !== false, ...(opts.dark !== undefined ? { exportWithDarkMode: opts.dark } : {}), exportScale: opts.scale ?? 1 };
      const files = api.getFiles();
      if (data.format === 'svg') {
        const svg = await exportToSvg({ elements, appState: exportAppState, files, exportPadding: opts.padding, exportingFrame });
        await postResult('/api/export/image/result', { requestId, format: 'svg', data: new XMLSerializer().serializeToString(svg) });
      } else {
        const blob = await exportToBlob({ elements, appState: exportAppState, files, mimeType: 'image/png', exportPadding: opts.padding, exportingFrame });
        const base64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => {
            const result = (reader.result as string | null)?.split(',')[1];
            if (result) resolve(result); else reject(new Error('Could not extract base64 data from result'));
          };
          reader.onerror = () => reject(reader.error ?? new Error('FileReader failed'));
          reader.readAsDataURL(blob);
        });
        await postResult('/api/export/image/result', { requestId, format: 'png', data: base64 });
      }
    } catch (error) {
      console.error('Image export failed:', error);
      await postResult('/api/export/image/result', { requestId, error: (error as Error).message });
    }
  };

  const handleViewportRequest = async (api: ExcalidrawImperativeAPI, data: SocketMessage): Promise<void> => {
    const requestId = data.requestId as string | undefined;
    if (!requestId) return;
    try {
      const allElements = api.getSceneElements();
      if (data.scrollToContent) {
        if (allElements.length > 0) api.scrollToContent(allElements, { fitToViewport: true, viewportZoomFactor: data.viewportZoomFactor as number | undefined, animate: true });
      } else if (Array.isArray(data.scrollToElementIds)) {
        const ids = data.scrollToElementIds as string[];
        const targets = allElements.filter(el => ids.includes(el.id));
        const missing = ids.filter(id => !targets.some(el => el.id === id));
        if (missing.length > 0) throw new Error(`Elements not found for IDs: ${missing.join(', ')}`);
        api.scrollToContent(targets, { fitToViewport: true, viewportZoomFactor: data.viewportZoomFactor as number | undefined, animate: true });
      } else if (typeof data.scrollToElementId === 'string') {
        const target = allElements.find(el => el.id === data.scrollToElementId);
        if (!target) throw new Error(`Element ${data.scrollToElementId} not found`);
        api.scrollToContent([target], { fitToViewport: false, animate: true });
      } else {
        const appState: Record<string, unknown> = {};
        if (typeof data.zoom === 'number') appState.zoom = { value: data.zoom };
        if (typeof data.offsetX === 'number') appState.scrollX = data.offsetX;
        if (typeof data.offsetY === 'number') appState.scrollY = data.offsetY;
        if (Object.keys(appState).length > 0) applySceneUpdateWithoutAutoSync(api, { appState: appState as never });
      }
      await postResult('/api/viewport/result', { requestId, success: true, message: 'Viewport updated' });
    } catch (error) {
      console.error('Viewport control failed:', error);
      await postResult('/api/viewport/result', { requestId, error: (error as Error).message });
    }
  };

  const handleMermaid = async (api: ExcalidrawImperativeAPI, data: SocketMessage): Promise<void> => {
    if (typeof data.mermaidDiagram !== 'string') return;
    try {
      if (!canSyncScene()) throw new Error('Scene is not fully loaded; Mermaid import is paused');
      const generation = sceneGenerationRef.current;
      const result = await convertMermaidToExcalidraw(data.mermaidDiagram, normalizeMermaidConfig(data.config));
      if (!canSyncScene() || generation !== sceneGenerationRef.current) return;
      if (result.error) { console.error('Mermaid conversion error:', result.error); return; }
      if (result.elements.length === 0) return;
      const converted = convertToExcalidrawElements([...result.elements] as Parameters<typeof convertToExcalidrawElements>[0], { regenerateIds: true });
      applySceneUpdateWithoutAutoSync(api, { elements: [...api.getSceneElements(), ...converted], captureUpdate: CaptureUpdateAction.IMMEDIATELY });
      if (result.files) api.addFiles(Object.values(result.files));
      await syncToBackend();
    } catch (error) {
      console.error('Error converting Mermaid diagram:', error);
    }
  };

  // ---- selection, labels, focusing ---------------------------------------

  const labelFor = useCallback((elementId: string): string => {
    const api = apiRef.current;
    if (!api) return elementId.slice(0, 8);
    const elements = api.getSceneElements();
    const byId = new Map(elements.map(el => [el.id, el as { text?: string }]));
    const element = elements.find(el => el.id === elementId);
    return element ? elementLabel(element as never, byId) : `${elementId.slice(0, 8)} (gone)`;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sceneTick]);

  const selected: SelectedElementInfo[] = useMemo(() => {
    const api = apiRef.current;
    if (!api) return [];
    const elements = api.getSceneElements();
    const byId = new Map(elements.map(el => [el.id, el as { text?: string }]));
    return selectedIds.flatMap(id => {
      const element = elements.find(el => el.id === id);
      if (!element) return [];
      const custom = (element.customData ?? null) as { tags?: unknown; note?: unknown } | null;
      return [{
        id,
        type: element.type,
        label: elementLabel(element as never, byId),
        tags: Array.isArray(custom?.tags) ? custom.tags.filter((t): t is string => typeof t === 'string') : [],
        note: typeof custom?.note === 'string' ? custom.note : '',
        link: typeof element.link === 'string' ? element.link : null
      }];
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedIds, sceneTick]);

  const focusElement = useCallback((elementId: string): void => {
    const api = apiRef.current;
    if (!api) return;
    const element = api.getSceneElements().find(el => el.id === elementId);
    if (!element) { toast('That shape is no longer on the canvas', 'error'); return; }
    // Center it at the current zoom; zooming to fit one shape is disorienting.
    api.scrollToContent([element], { fitToViewport: false, animate: true });
    applySceneUpdateWithoutAutoSync(api, { appState: { selectedElementIds: { [elementId]: true } } as never });
  }, [toast]);

  // ---- top bar actions ---------------------------------------------------

  const openDiagram = (id: string): void => { if (id !== diagramId) navigate(diagramPath(projectId, id)); };

  const createDiagram = async (name: string): Promise<void> => {
    try {
      const { diagram: created } = await api.createDiagram(projectId, { name, open: true });
      navigate(diagramPath(projectId, created.id));
    } catch (error) {
      toast((error as Error).message, 'error');
    }
  };

  const interchangeIds = useMemo(() => new Set((project?.links ?? []).flatMap(l => [l.from.diagramId, l.to.diagramId])), [project]);

  const commitName = async (): Promise<void> => {
    setEditingName(false);
    const next = nameDraft.trim();
    if (!diagram || !next || next === diagram.name) return;
    try {
      await api.updateDiagram(diagram.id, { name: next });
    } catch (error) {
      toast((error as Error).message, 'error');
    }
  };

  const clearCanvas = useCallback(async (): Promise<void> => {
    if (!canSyncScene()) return;
    const generation = pauseSceneSync();
    try {
      const response = await fetch('/api/elements/clear', { method: 'DELETE', signal: AbortSignal.timeout(10000) });
      if (!response.ok) throw new Error('Could not clear the saved canvas');
      // The server broadcasts canvas_cleared; HTTP is the fallback when that
      // message has not arrived. Never overwrite a newer WebSocket scene.
      if (generation === sceneGenerationRef.current) await loadExistingElements();
    } catch (error) {
      failSceneLoad(error, generation);
      toast('Could not clear the canvas; sync is paused', 'error');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected, pauseSceneSync, loadExistingElements, failSceneLoad, toast]);

  const readoutText = (): string => {
    switch (syncState) {
      case 'offline': return 'offline · reconnecting';
      case 'loading': return 'loading scene';
      case 'editing': return 'editing';
      case 'syncing': return 'syncing';
      case 'error': return 'sync failed';
      case 'saved': return lastSave && lastSave.diagramId === diagramId ? `saved ${fmtTime(lastSave.savedAt)} · ${lastSave.elementCount} el` : `${elementCount} el`;
    }
  };

  const onLinkOpen = useCallback((element: NonDeletedExcalidrawElement, event: CustomEvent<{ nativeEvent: MouseEvent | React.PointerEvent<HTMLCanvasElement> }>): void => {
    const link = element.link;
    if (typeof link === 'string' && link.startsWith('/')) {
      event.preventDefault();
      navigate(link);
    }
  }, []);

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-left">
          <a className="route-chip" href={projectPath(projectId)} onClick={onLinkClick} title={`${project?.name ?? 'Project'}: open the project map`} aria-label={`${project?.name ?? 'Project'}: open the project map`}>
            <span className="route-swatch" aria-hidden="true" />
            <span className="name">{project?.name ?? '…'}</span>
          </a>
          <span className="crumb-sep" aria-hidden="true"><Icon name="chevron" size={12} /></span>
          {editingName ? (
            <span className="diagram-title">
              <input
                autoFocus
                value={nameDraft}
                onChange={e => setNameDraft(e.target.value)}
                onBlur={() => void commitName()}
                onKeyDown={e => { if (e.key === 'Enter') void commitName(); if (e.key === 'Escape') setEditingName(false); }}
                aria-label="Diagram name"
              />
            </span>
          ) : (
            <button type="button" className="diagram-title" onClick={() => { setNameDraft(diagram?.name ?? ''); setEditingName(true); }} title="Rename diagram">
              <span className="text">{diagram?.name ?? '…'}</span>
            </button>
          )}
        </div>
        <div className="topbar-center">
          <StationLine diagrams={siblings} activeId={diagramId} interchangeIds={interchangeIds} pulseKey={pulseKey} onOpen={openDiagram} onCreate={createDiagram} />
        </div>
        <div className="topbar-right">
          <button
            type="button"
            className="readout"
            data-state={syncState}
            aria-label="Sync now"
            title="Sync the canvas to the server now (it autosaves after each edit)"
            onClick={() => void syncToBackend()}
            disabled={!connected || sceneLoadStatus !== 'ready' || syncState === 'syncing'}
          >
            <span className="dot" aria-hidden="true" /><span className="text" role="status" aria-live="polite">{readoutText()}</span>
          </button>
          <button type="button" className="btn btn-primary" onClick={() => { setPanelOpen(true); setPanelTab('versions'); setSaveFocusTick(t => t + 1); }} disabled={sceneLoadStatus !== 'ready'}>
            <Icon name="save" /> Save<span className="label-full">&nbsp;version</span>
          </button>
          <button type="button" className="btn btn-icon btn-ghost" aria-pressed={panelOpen} onClick={() => setPanelOpen(o => !o)} title={panelOpen ? 'Hide panel' : 'Show panel'} aria-label={panelOpen ? 'Hide panel' : 'Show panel'}>
            <Icon name="panel" />
          </button>
          <button type="button" className="btn btn-icon btn-ghost" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} title={theme === 'dark' ? 'Day theme' : 'Night theme'} aria-label={theme === 'dark' ? 'Switch to day theme' : 'Switch to night theme'}>
            <Icon name={theme === 'dark' ? 'sun' : 'moon'} />
          </button>
        </div>
      </header>

      <div className="workbench">
        <div className="canvas-host" onPointerDownCapture={() => { userInteractedRef.current = true; }} onKeyDownCapture={() => { userInteractedRef.current = true; }}>
          {sceneLoadStatus !== 'ready' && (
            <div className="scene-banner" data-kind={sceneLoadStatus} role={sceneLoadStatus === 'failed' ? 'alert' : 'status'}>
              <span>{sceneLoadStatus === 'failed' ? 'The canvas could not be loaded. Sync is paused to protect the saved scene.' : connected ? 'Loading the diagram…' : 'Connecting to the canvas server…'}</span>
              {sceneLoadStatus === 'failed' && <button type="button" className="btn btn-sm" onClick={() => void loadExistingElements()}>Retry loading</button>}
            </div>
          )}
          <Excalidraw
            theme={theme}
            viewModeEnabled={sceneLoadStatus !== 'ready'}
            excalidrawAPI={(instance: ExcalidrawImperativeAPI) => setExcalidrawAPI(instance)}
            onLinkOpen={onLinkOpen}
            onChange={(elements, appState) => {
              if (appState?.theme && appState.theme !== theme) setTheme(appState.theme);
              const ids = Object.keys(appState?.selectedElementIds ?? {}).filter(id => appState.selectedElementIds[id]);
              const key = ids.join('|');
              if (key !== selectedKeyRef.current) {
                selectedKeyRef.current = key;
                setSelectedIds(ids);
              }
              // onChange also fires for selection, scroll and zoom. Only an
              // element edit bumps a version; sync on those alone.
              let sceneVersion = 0;
              for (const element of elements) sceneVersion += element.version;
              if (sceneVersion === sceneVersionRef.current) return;
              sceneVersionRef.current = sceneVersion;
              scheduleAutoSync();
            }}
            initialData={{ elements: [], appState: { theme } }}
            name={diagram?.name}
          />
        </div>
        <SidePanel
          open={panelOpen}
          tab={panelTab}
          onTab={setPanelTab}
          project={project}
          diagram={diagram}
          diagramId={diagramId}
          elementCount={elementCount}
          selected={selected}
          links={links}
          labelFor={labelFor}
          onFocusElement={focusElement}
          onClearCanvas={clearCanvas}
          canClear={connected && sceneLoadStatus === 'ready'}
          openNotes={openNotes}
          onOpenNotes={() => { setPanelOpen(true); setPanelTab('notes'); }}
          saveFocusTick={saveFocusTick}
          counts={{ versions: versionCount, notes: openNotes.length, newNotes }}
          chat={chat}
          chatNew={chatNew}
        />
      </div>
    </div>
  );
}
