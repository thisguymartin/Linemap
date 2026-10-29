import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { api, type DiagramMeta, type ProjectDetail } from './api';

// App-level state: one WebSocket per tab (shared by the canvas sync and the
// workspace panels), the active diagram, the current project, the theme,
// and a toast line. Pages subscribe to raw socket messages through `subscribe`.

export type Theme = 'light' | 'dark';

export interface WorkspaceEvent {
  type: 'workspace_event';
  event: 'active_changed' | 'diagram_saved' | 'version_changed' | 'note_changed' | 'project_changed' | 'diagram_changed' | 'link_changed';
  projectId?: string | null;
  diagramId?: string | null;
  diagramName?: string | null;
  versionId?: string;
  noteId?: string;
  linkId?: string;
  savedAt?: string;
  elementCount?: number;
}

export type SocketMessage = { type: string; [key: string]: unknown };
type Listener = (message: SocketMessage) => void;

interface WorkspaceState {
  connected: boolean;
  connectionGeneration: number;
  activeDiagramId: string | null;
  activeProjectId: string | null;
  activeDiagramName: string | null;
  lastSave: { diagramId: string; savedAt: string; elementCount: number } | null;
  project: ProjectDetail | null;
  projectVersion: number;
  theme: Theme;
  setTheme: (theme: Theme) => void;
  subscribe: (listener: Listener) => () => void;
  loadProject: (projectId: string) => Promise<ProjectDetail | null>;
  toast: (message: string, kind?: 'info' | 'error') => void;
  toastState: { message: string; kind: 'info' | 'error'; id: number } | null;
  eventTick: Record<WorkspaceEvent['event'], number>;
  lastEvent: WorkspaceEvent | null;
}

const WorkspaceContext = createContext<WorkspaceState | null>(null);

const THEME_KEY = 'excalidraw-canvas-theme';

function initialTheme(): Theme {
  try {
    const saved = window.localStorage?.getItem(THEME_KEY);
    if (saved === 'light' || saved === 'dark') return saved;
  } catch { /* storage blocked */ }
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

const EVENT_NAMES: WorkspaceEvent['event'][] = ['active_changed', 'diagram_saved', 'version_changed', 'note_changed', 'project_changed', 'diagram_changed', 'link_changed'];

export function WorkspaceProvider({ children }: { children: ReactNode }): ReactElement {
  const [connected, setConnected] = useState(false);
  const [connectionGeneration, setConnectionGeneration] = useState(0);
  const [active, setActive] = useState<{ diagramId: string | null; projectId: string | null; name: string | null }>({ diagramId: null, projectId: null, name: null });
  const [lastSave, setLastSave] = useState<WorkspaceState['lastSave']>(null);
  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [projectVersion, setProjectVersion] = useState(0);
  const [theme, setThemeState] = useState<Theme>(initialTheme);
  const [toastState, setToastState] = useState<WorkspaceState['toastState']>(null);
  const [eventTick, setEventTick] = useState<Record<WorkspaceEvent['event'], number>>(() =>
    Object.fromEntries(EVENT_NAMES.map(n => [n, 0])) as Record<WorkspaceEvent['event'], number>);
  const [lastEvent, setLastEvent] = useState<WorkspaceEvent | null>(null);
  const listeners = useRef(new Set<Listener>());
  const socketRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const projectRef = useRef<ProjectDetail | null>(null);
  projectRef.current = project;

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try { window.localStorage?.setItem(THEME_KEY, theme); } catch { /* storage blocked */ }
  }, [theme]);

  const setTheme = useCallback((next: Theme) => setThemeState(next), []);

  const subscribe = useCallback((listener: Listener) => {
    listeners.current.add(listener);
    return () => { listeners.current.delete(listener); };
  }, []);

  const loadProject = useCallback(async (projectId: string): Promise<ProjectDetail | null> => {
    try {
      const detail = await api.project(projectId);
      setProject(detail);
      return detail;
    } catch {
      setProject(null);
      return null;
    }
  }, []);

  const toast = useCallback((message: string, kind: 'info' | 'error' = 'info') => {
    setToastState({ message, kind, id: Date.now() });
  }, []);

  useEffect(() => {
    if (!toastState) return;
    const timer = setTimeout(() => setToastState(null), 3200);
    return () => clearTimeout(timer);
  }, [toastState]);

  // Initial active diagram from HTTP, so the first paint already knows where it is.
  useEffect(() => {
    void api.workspace().then(info => {
      setActive({ diagramId: info.activeDiagramId, projectId: info.activeProjectId, name: info.activeDiagram?.name ?? null });
    }).catch(() => { /* socket will tell us */ });
  }, []);

  useEffect(() => {
    let disposed = false;
    const connect = (): void => {
      if (disposed) return;
      const current = socketRef.current;
      if (current && (current.readyState === WebSocket.CONNECTING || current.readyState === WebSocket.OPEN)) return;
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const socket = new WebSocket(`${protocol}//${window.location.host}`);
      socketRef.current = socket;
      socket.onopen = () => {
        if (socketRef.current !== socket) return;
        setConnected(true);
        setConnectionGeneration(g => g + 1);
      };
      socket.onmessage = (event: MessageEvent) => {
        if (socketRef.current !== socket) return;
        let data: SocketMessage;
        try { data = JSON.parse(event.data) as SocketMessage; } catch { return; }
        if (data.type === 'workspace_event') {
          const ev = data as unknown as WorkspaceEvent;
          setLastEvent(ev);
          setEventTick(t => ({ ...t, [ev.event]: t[ev.event] + 1 }));
          if (ev.event === 'active_changed') {
            setActive({ diagramId: ev.diagramId ?? null, projectId: ev.projectId ?? null, name: ev.diagramName ?? null });
          } else if (ev.event === 'diagram_saved' && ev.diagramId && ev.savedAt) {
            setLastSave({ diagramId: ev.diagramId, savedAt: ev.savedAt, elementCount: ev.elementCount ?? 0 });
          }
          if (ev.projectId && projectRef.current?.id === ev.projectId && ev.event !== 'diagram_saved') {
            void api.project(ev.projectId).then(detail => {
              setProject(detail);
              setProjectVersion(v => v + 1);
            }).catch(() => { /* project may have been deleted */ });
          }
        }
        listeners.current.forEach(listener => listener(data));
      };
      socket.onclose = (event: CloseEvent) => {
        if (socketRef.current !== socket) return;
        setConnected(false);
        if (event.code !== 1000 && !disposed) reconnectTimer.current = setTimeout(connect, 2500);
      };
      socket.onerror = () => {
        if (socketRef.current !== socket) return;
        setConnected(false);
      };
    };
    connect();
    return () => {
      disposed = true;
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      const socket = socketRef.current;
      socketRef.current = null;
      socket?.close();
    };
  }, []);

  const value = useMemo<WorkspaceState>(() => ({
    connected,
    connectionGeneration,
    activeDiagramId: active.diagramId,
    activeProjectId: active.projectId,
    activeDiagramName: active.name,
    lastSave,
    project,
    projectVersion,
    theme,
    setTheme,
    subscribe,
    loadProject,
    toast,
    toastState,
    eventTick,
    lastEvent
  }), [connected, connectionGeneration, active, lastSave, project, projectVersion, theme, setTheme, subscribe, loadProject, toast, toastState, eventTick, lastEvent]);

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace(): WorkspaceState {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error('useWorkspace must be used inside WorkspaceProvider');
  return value;
}

export function useSiblingDiagrams(project: ProjectDetail | null): DiagramMeta[] {
  return useMemo(() => [...(project?.diagrams ?? [])].sort((a, b) => a.createdAt.localeCompare(b.createdAt)), [project]);
}

// Remember which versions/notes this tab has already seen, so arrivals from an
// agent (or another tab) hold their "new" tint until read.
export function useUnread(ids: string[], ownIds: Set<string>): { unread: Set<string>; markRead: (id: string) => void } {
  const seen = useRef<Set<string> | null>(null);
  const [unread, setUnread] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (seen.current === null) {
      seen.current = new Set(ids);
      return;
    }
    const fresh = ids.filter(id => !seen.current!.has(id) && !ownIds.has(id));
    ids.forEach(id => seen.current!.add(id));
    if (fresh.length) setUnread(prev => new Set([...prev, ...fresh]));
  }, [ids, ownIds]);
  const markRead = useCallback((id: string) => {
    setUnread(prev => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, []);
  return { unread, markRead };
}
