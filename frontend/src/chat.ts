import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, type ChatMessage, type ChatThreadSummary, type RunnerId, type RunnerInfo } from './api';
import { useWorkspace } from './workspace';

const RUNNER_KEY = 'excalidraw-chat-runner';
const PREFS_KEY = 'excalidraw-chat-prefs';
const activeKey = (projectId: string): string => `excalidraw-chat-active-${projectId}`;

export interface RunnerPrefs { model: string; effort: string }

function readJson<T>(key: string, fallback: T): T {
  try { const raw = window.localStorage?.getItem(key); return raw ? JSON.parse(raw) as T : fallback; } catch { return fallback; }
}
function writeJson(key: string, value: unknown): void {
  try { window.localStorage?.setItem(key, JSON.stringify(value)); } catch { /* storage blocked */ }
}

export interface ChatController {
  enabled: boolean;
  runners: RunnerInfo[];
  runner: RunnerId | null;
  setRunner: (runner: RunnerId) => void;
  prefs: RunnerPrefs;
  setPrefs: (prefs: Partial<RunnerPrefs>) => void;
  threads: ChatThreadSummary[];
  activeThreadId: string | null;
  selectThread: (threadId: string | null) => void;
  renameThread: (threadId: string, title: string) => Promise<void>;
  deleteThread: (threadId: string) => Promise<void>;
  messages: ChatMessage[];
  loaded: boolean;
  running: boolean;
  runningThreadId: string | null;
  send: (text: string, extra: { diagramId: string | null; selectedIds: string[] }) => Promise<void>;
  cancel: () => Promise<void>;
  refreshRunners: () => Promise<void>;
  lastFinishedId: string | null;
}

// A project's chats with the local agent CLIs. Each chat is its own
// session; the active one is remembered per project in this browser.
export function useChat(projectId: string | null): ChatController {
  const { subscribe, connectionGeneration, toast } = useWorkspace();
  const [enabled, setEnabled] = useState(true);
  const [runners, setRunners] = useState<RunnerInfo[]>([]);
  const [threads, setThreads] = useState<ChatThreadSummary[]>([]);
  const [runningThreadId, setRunningThreadId] = useState<string | null>(null);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [lastFinishedId, setLastFinishedId] = useState<string | null>(null);
  const [preferred, setPreferred] = useState<RunnerId | null>(() => {
    const v = readJson<string | null>(RUNNER_KEY, null);
    return v === 'claude' || v === 'codex' ? v : null;
  });
  const [allPrefs, setAllPrefs] = useState<Partial<Record<RunnerId, RunnerPrefs>>>(() => readJson(PREFS_KEY, {}));
  const activeRef = useRef<string | null>(null);
  activeRef.current = activeThreadId;
  const listTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refreshRunners = useCallback(async (): Promise<void> => {
    try {
      const result = await api.agents(true);
      setEnabled(result.enabled);
      setRunners(result.runners);
    } catch { /* offline */ }
  }, []);

  useEffect(() => {
    void api.agents().then(r => { setEnabled(r.enabled); setRunners(r.runners); }).catch(() => undefined);
  }, []);

  const loadThreads = useCallback(async (pickActive: boolean): Promise<void> => {
    if (!projectId) return;
    try {
      const result = await api.chats(projectId);
      setThreads(result.threads);
      setRunningThreadId(result.runningThreadId);
      if (pickActive) {
        const remembered = readJson<string | null>(activeKey(projectId), null);
        const next = result.threads.find(t => t.id === remembered)?.id ?? result.threads[0]?.id ?? null;
        setActiveThreadId(next);
        if (!next) { setMessages([]); setLoaded(true); }
      }
    } catch { setLoaded(true); }
  }, [projectId]);

  useEffect(() => {
    setLoaded(false);
    setMessages([]);
    void loadThreads(true);
  }, [loadThreads, connectionGeneration]);

  useEffect(() => {
    if (!projectId) return;
    writeJson(activeKey(projectId), activeThreadId);
    if (!activeThreadId) { setMessages([]); setLoaded(true); return; }
    let cancelled = false;
    setLoaded(false);
    api.chatThread(projectId, activeThreadId)
      .then(thread => { if (!cancelled) { setMessages(thread.messages); setLoaded(true); } })
      .catch(() => { if (!cancelled) { setMessages([]); setLoaded(true); } });
    return () => { cancelled = true; };
  }, [projectId, activeThreadId, connectionGeneration]);

  useEffect(() => subscribe(data => {
    if (data.type !== 'chat_event' || data.projectId !== projectId) return;
    if (data.threadsChanged) {
      if (listTimer.current) clearTimeout(listTimer.current);
      listTimer.current = setTimeout(() => void loadThreads(false), 150);
      if (data.deletedThreadId && data.deletedThreadId === activeRef.current) setActiveThreadId(null);
    }
    const incoming = data.message as ChatMessage | undefined;
    if (!incoming) return;
    if (incoming.role === 'assistant') {
      setRunningThreadId(incoming.status === 'running' ? incoming.threadId : prev => (prev === incoming.threadId ? null : prev));
      if (incoming.status !== 'running') setLastFinishedId(incoming.id);
    }
    if (incoming.threadId !== activeRef.current) return;
    setMessages(prev => {
      const index = prev.findIndex(m => m.id === incoming.id);
      if (index === -1) return [...prev, incoming];
      const next = prev.slice();
      next[index] = incoming;
      return next;
    });
  }), [subscribe, projectId, loadThreads]);

  const available = runners.filter(r => r.available);
  const runner: RunnerId | null = preferred && available.some(r => r.id === preferred) ? preferred : available[0]?.id ?? null;
  const prefs: RunnerPrefs = (runner && allPrefs[runner]) || { model: '', effort: '' };
  const running = runningThreadId !== null || messages.some(m => m.status === 'running');

  const setRunner = useCallback((next: RunnerId) => {
    setPreferred(next);
    writeJson(RUNNER_KEY, next);
  }, []);

  const setPrefs = useCallback((patch: Partial<RunnerPrefs>) => {
    if (!runner) return;
    setAllPrefs(prev => {
      const next = { ...prev, [runner]: { ...(prev[runner] ?? { model: '', effort: '' }), ...patch } };
      writeJson(PREFS_KEY, next);
      return next;
    });
  }, [runner]);

  const send = useCallback(async (text: string, extra: { diagramId: string | null; selectedIds: string[] }) => {
    if (!projectId || !runner) return;
    const result = await api.sendChat(projectId, activeRef.current, { message: text, runner, model: prefs.model || null, effort: prefs.effort || null, ...extra });
    setRunningThreadId(result.threadId);
    if (activeRef.current !== result.threadId) {
      activeRef.current = result.threadId;
      setActiveThreadId(result.threadId);
    }
    setMessages(prev => {
      const known = new Set(prev.map(m => m.id));
      return [...prev, ...[result.user, result.assistant].filter(m => !known.has(m.id))];
    });
  }, [projectId, runner, prefs]);

  const cancel = useCallback(async () => {
    if (!projectId) return;
    try { await api.cancelChat(projectId); } catch (error) { toast((error as Error).message, 'error'); }
  }, [projectId, toast]);

  const renameThread = useCallback(async (threadId: string, title: string) => {
    if (!projectId) return;
    try { await api.renameChat(projectId, threadId, title); await loadThreads(false); } catch (error) { toast((error as Error).message, 'error'); }
  }, [projectId, loadThreads, toast]);

  const deleteThread = useCallback(async (threadId: string) => {
    if (!projectId) return;
    try {
      await api.deleteChat(projectId, threadId);
      if (activeRef.current === threadId) setActiveThreadId(null);
      await loadThreads(false);
    } catch (error) { toast((error as Error).message, 'error'); }
  }, [projectId, loadThreads, toast]);

  return useMemo(() => ({
    enabled, runners, runner, setRunner, prefs, setPrefs, threads, activeThreadId, selectThread: setActiveThreadId,
    renameThread, deleteThread, messages, loaded, running, runningThreadId, send, cancel, refreshRunners, lastFinishedId
  }), [enabled, runners, runner, setRunner, prefs, setPrefs, threads, activeThreadId, renameThread, deleteThread, messages, loaded, running, runningThreadId, send, cancel, refreshRunners, lastFinishedId]);
}
