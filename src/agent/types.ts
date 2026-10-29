export type RunnerId = 'claude' | 'codex';

export type ChatPart =
  | { type: 'text'; text: string }
  | {
      type: 'tool';
      id: string;
      name: string;
      // 'mcp' = excalidraw/workbench tool, 'read' = file/search tool, 'command' = shell (codex read-only)
      kind: 'mcp' | 'read' | 'command' | 'other';
      detail: string;
      status: 'running' | 'done' | 'error';
      error?: string;
    };

// What the agent is doing right now, for the live status line.
export interface ChatActivity {
  phase: 'starting' | 'thinking' | 'writing' | 'tool' | 'replying';
  label: string;
  since: string;
}

export interface ChatMessage {
  id: string;
  threadId: string;
  projectId: string;
  diagramId: string | null;
  role: 'user' | 'assistant';
  runner: RunnerId | null;
  text: string;
  parts: ChatPart[];
  selectedIds: string[];
  status: 'running' | 'done' | 'error' | 'cancelled';
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  costUsd: number | null;
  model: string | null;
  effort: string | null;
  // Live-only while running: reasoning summary and partial reply text.
  thinking: string;
  liveText: string;
  activity: ChatActivity | null;
}

export interface ChatThread {
  id: string;
  projectId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  // CLI session/thread ids, so later turns resume the same conversation.
  sessions: Partial<Record<RunnerId, string>>;
  messages: ChatMessage[];
}

export interface ChatThreadSummary {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  runners: RunnerId[];
  running: boolean;
}

export interface ChatFile {
  threads: ChatThread[];
}

export interface RunnerOption {
  value: string;
  label: string;
}

export interface RunnerInfo {
  id: RunnerId;
  label: string;
  available: boolean;
  path: string | null;
  version: string | null;
  reason: string | null;
  models: RunnerOption[];
  efforts: RunnerOption[];
}
