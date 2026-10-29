import { useEffect, useRef, useState, type ReactElement } from 'react';
import { api, fmtWhen, type ChatMessage, type ChatPart, type ProjectDetail } from '../api';
import type { ChatController } from '../chat';
import { Icon, type IconName } from '../icons';
import { useWorkspace } from '../workspace';
import { Markdown } from './Markdown';
import { FolderPicker } from './FolderPicker';

interface Props {
  chat: ChatController;
  project: ProjectDetail | null;
  diagramId: string;
  selectedIds: string[];
  labelFor: (elementId: string) => string;
  onFocusElement: (elementId: string) => void;
}

const SUGGESTIONS = [
  'Explain this diagram back to me in five lines and point out what is missing.',
  'Read the linked folder and draw how a request flows through it.',
  'Turn the selected shapes into their own diagram and link to it.'
];

type ToolPart = Extract<ChatPart, { type: 'tool' }>;

function toolIcon(part: ToolPart): IconName {
  if (part.kind === 'read') return 'search';
  if (part.kind === 'command') return 'terminal';
  return 'sparkle';
}

function duration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

// Re-render every second while something is running, for elapsed timers.
function useTick(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

function Steps({ parts, live }: { parts: ToolPart[]; live: boolean }): ReactElement | null {
  const [open, setOpen] = useState(false);
  if (parts.length === 0) return null;
  const errors = parts.filter(p => p.status === 'error').length;
  const shown = open || live ? parts : parts.slice(-3);
  return (
    <div className="steps">
      <ol>
        {shown.map(part => (
          <li key={part.id} data-status={part.status} title={part.error ?? undefined}>
            <span className="step-dot" aria-hidden="true" />
            <Icon name={toolIcon(part)} size={12} />
            <span className="step-name">{part.name}</span>
            {part.detail && <span className="step-detail">{part.detail}</span>}
            {part.status === 'error' && <span className="step-error">{part.error ? part.error : 'failed'}</span>}
          </li>
        ))}
      </ol>
      {parts.length > 3 && !live && (
        <button type="button" className="steps-toggle" onClick={() => setOpen(o => !o)}>
          {open ? 'Show fewer steps' : `Show all ${parts.length} steps${errors ? ` · ${errors} failed` : ''}`}
        </button>
      )}
    </div>
  );
}

function Thinking({ message, now }: { message: ChatMessage; now: number }): ReactElement | null {
  const running = message.status === 'running';
  const thinkingNow = running && message.activity?.phase === 'thinking';
  const ref = useRef<HTMLPreElement | null>(null);
  useEffect(() => { if (ref.current && running) ref.current.scrollTop = ref.current.scrollHeight; }, [message.thinking, running]);
  if (!message.thinking.trim() && !thinkingNow) return null;
  const label = thinkingNow
    ? `Thinking${message.activity ? ` · ${duration(now - Date.parse(message.activity.since))}` : ''}`
    : 'Thinking';
  return (
    <details className="thinking" open={running ? true : undefined}>
      <summary>
        <span className={thinkingNow ? 'thinking-pulse' : undefined} aria-hidden="true" />
        {label}
      </summary>
      {message.thinking.trim()
        ? <pre ref={ref} className="scroll">{message.thinking.trim()}</pre>
        : <p className="small muted">The model is reasoning; its summary appears here when the CLI shares it.</p>}
    </details>
  );
}

function RunLog({ projectId, message }: { projectId: string; message: ChatMessage }): ReactElement {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const running = message.status === 'running';
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const load = (): void => {
      api.runLog(projectId, message.threadId, message.id)
        .then(t => { if (!cancelled) { setText(t); setError(null); } })
        .catch(e => { if (!cancelled) setError((e as Error).message); });
    };
    load();
    const timer = running ? setInterval(load, 1500) : null;
    return () => { cancelled = true; if (timer) clearInterval(timer); };
  }, [open, running, projectId, message.threadId, message.id]);
  const tail = text ? text.split('\n').slice(-400).join('\n') : '';
  return (
    <>
      <button type="button" className="linkish small" onClick={() => setOpen(o => !o)}>{open ? 'Hide log' : 'View log'}</button>
      {open && (
        <div className="runlog">
          {error ? <p className="small chat-error">{error}</p> : <pre className="scroll">{tail || 'Loading…'}</pre>}
        </div>
      )}
    </>
  );
}

function AssistantBody({ message, now, projectId }: { message: ChatMessage; now: number; projectId: string }): ReactElement {
  const running = message.status === 'running';
  // Interleave text and consecutive tool steps in the order they happened.
  const groups: Array<{ kind: 'text'; text: string } | { kind: 'tools'; parts: ToolPart[] }> = [];
  for (const part of message.parts) {
    if (part.type === 'text') groups.push({ kind: 'text', text: part.text });
    else {
      const last = groups[groups.length - 1];
      if (last?.kind === 'tools') last.parts.push(part);
      else groups.push({ kind: 'tools', parts: [part] });
    }
  }
  return (
    <>
      <Thinking message={message} now={now} />
      {groups.map((g, i) => g.kind === 'text' ? <Markdown key={i} text={g.text} /> : <Steps key={i} parts={g.parts} live={running} />)}
      {running && message.liveText.trim() && <div className="live-text"><Markdown text={message.liveText} /></div>}
      {running && (
        <div className="working" role="status">
          <span className="working-line" aria-hidden="true"><i /></span>
          <span className="working-label">{message.activity?.label ?? 'Working'}</span>
          <span className="working-time">{duration(now - Date.parse(message.createdAt))}</span>
        </div>
      )}
      {message.status === 'error' && <p className="chat-error" role="alert">{message.error ?? 'The agent stopped with an error.'}</p>}
      {message.status === 'cancelled' && <p className="small muted">Stopped.</p>}
      <div className="chat-foot small muted">
        {!running && message.durationMs !== null && <span>{duration(message.durationMs)}</span>}
        {!running && message.costUsd !== null && <span>${message.costUsd.toFixed(message.costUsd < 0.1 ? 3 : 2)}</span>}
        {message.effort && <span>{message.effort} effort</span>}
        <RunLog projectId={projectId} message={message} />
      </div>
    </>
  );
}

export function ChatTab({ chat, project, diagramId, selectedIds, labelFor, onFocusElement }: Props): ReactElement {
  const { toast, loadProject } = useWorkspace();
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [customModel, setCustomModel] = useState(false);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const stick = useRef(true);
  const now = useTick(chat.running);

  const last = chat.messages[chat.messages.length - 1];
  useEffect(() => {
    const el = bodyRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [chat.messages.length, last?.parts.length, last?.text, last?.liveText, last?.thinking, last?.status]);
  useEffect(() => { setConfirmDelete(false); setRenaming(null); stick.current = true; }, [chat.activeThreadId]);

  const runnerInfo = chat.runners.find(r => r.id === chat.runner) ?? null;
  const modelKnown = !chat.prefs.model || runnerInfo?.models.some(m => m.value === chat.prefs.model);
  useEffect(() => { if (!modelKnown) setCustomModel(true); }, [modelKnown]);

  const submit = async (): Promise<void> => {
    const text = draft.trim();
    if (!text || chat.running || !chat.runner) return;
    setSending(true);
    stick.current = true;
    try {
      await chat.send(text, { diagramId, selectedIds });
      setDraft('');
    } catch (error) {
      toast((error as Error).message, 'error');
    } finally {
      setSending(false);
    }
  };

  const linkFolder = async (path: string): Promise<void> => {
    if (!project) return;
    try {
      await api.updateProject(project.id, { rootPath: path });
      await loadProject(project.id);
      setPicking(false);
      toast('Folder linked. The agent can read it now.');
    } catch (error) {
      toast((error as Error).message, 'error');
    }
  };

  if (!chat.enabled) {
    return <div className="panel-body"><p className="empty"><strong>Agents are off</strong>The canvas server listens beyond localhost, so it will not start local agents. Run it on 127.0.0.1 to chat.</p></div>;
  }

  const available = chat.runners.filter(r => r.available);
  const folder = project?.folder;
  const active = chat.threads.find(t => t.id === chat.activeThreadId) ?? null;

  return (
    <>
      <div className="chat-head">
        {renaming !== null && active ? (
          <form className="chat-rename" onSubmit={e => { e.preventDefault(); void chat.renameThread(active.id, renaming); setRenaming(null); }}>
            <input className="input" autoFocus value={renaming} onChange={e => setRenaming(e.target.value)} onKeyDown={e => { if (e.key === 'Escape') setRenaming(null); }} aria-label="Chat name" />
            <button type="submit" className="btn btn-sm">Save</button>
          </form>
        ) : (
          <select
            className="select chat-select"
            value={chat.activeThreadId ?? ''}
            onChange={e => chat.selectThread(e.target.value || null)}
            aria-label="Chat"
          >
            {chat.activeThreadId === null && <option value="">New chat</option>}
            {chat.threads.map(t => (
              <option key={t.id} value={t.id}>{t.running ? '● ' : ''}{t.title} · {fmtWhen(t.updatedAt)}</option>
            ))}
          </select>
        )}
        <button type="button" className="btn btn-sm btn-icon" title="New chat (a fresh session)" aria-label="New chat" onClick={() => { chat.selectThread(null); inputRef.current?.focus(); }} disabled={chat.activeThreadId === null}>
          <Icon name="plus" />
        </button>
        {active && renaming === null && (confirmDelete ? (
          <span className="confirm-inline">
            <button type="button" className="btn btn-sm btn-danger" onClick={() => { setConfirmDelete(false); void chat.deleteThread(active.id); }}>Delete</button>
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setConfirmDelete(false)}>Keep</button>
          </span>
        ) : (
          <>
            <button type="button" className="btn btn-sm btn-ghost btn-icon" title="Rename chat" aria-label="Rename chat" onClick={() => setRenaming(active.title)}><Icon name="edit" size={14} /></button>
            <button type="button" className="btn btn-sm btn-ghost btn-icon btn-danger" title="Delete chat" aria-label="Delete chat" onClick={() => setConfirmDelete(true)} disabled={active.running}><Icon name="trash" size={14} /></button>
          </>
        ))}
      </div>

      <div className="chat-controls">
        <div className="segmented" role="radiogroup" aria-label="Agent">
          {chat.runners.map(r => (
            <button
              key={r.id}
              type="button"
              role="radio"
              aria-checked={chat.runner === r.id}
              disabled={!r.available || chat.running}
              title={r.available ? `${r.label} ${r.version ?? ''}`.trim() : r.reason ?? 'Not installed'}
              onClick={() => chat.setRunner(r.id)}
            >
              {r.label}
            </button>
          ))}
        </div>
        {runnerInfo && (
          customModel ? (
            <input
              className="input chat-model"
              value={chat.prefs.model}
              placeholder="model id"
              onChange={e => chat.setPrefs({ model: e.target.value.trim() })}
              onBlur={() => { if (!chat.prefs.model) setCustomModel(false); }}
              aria-label="Model"
              title="Any model id this CLI accepts. Clear it to go back to the list."
            />
          ) : (
            <select className="select chat-model" value={chat.prefs.model} onChange={e => { if (e.target.value === '__custom') setCustomModel(true); else chat.setPrefs({ model: e.target.value }); }} aria-label="Model" disabled={chat.running}>
              {runnerInfo.models.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
              <option value="__custom">Other model…</option>
            </select>
          )
        )}
        {runnerInfo && (
          <select className="select chat-effort" value={chat.prefs.effort} onChange={e => chat.setPrefs({ effort: e.target.value })} aria-label="Effort" disabled={chat.running} title="Lower effort answers faster">
            {runnerInfo.efforts.map(e => <option key={e.value} value={e.value}>{e.label}</option>)}
          </select>
        )}
      </div>

      <div className="chat-folder">
        {folder?.rootPath ? (
          <>
            <Icon name={folder.git?.isRepo ? 'branch' : 'folder'} size={12} />
            <span title={folder.rootPath}>Reads <b>{folder.display}</b>{folder.git?.branch ? ` · ${folder.git.branch}` : ''}</span>
            <button type="button" className="linkish" onClick={() => setPicking(p => !p)}>Change</button>
          </>
        ) : (
          <>
            <Icon name="folder" size={12} />
            <span>No folder linked. The agent sees only the diagrams.</span>
            <button type="button" className="linkish" onClick={() => setPicking(p => !p)}>Link folder</button>
          </>
        )}
      </div>
      {picking && (
        <div style={{ padding: '0 var(--gutter) 10px', borderBottom: '1px solid var(--rule)' }}>
          <FolderPicker initialPath={folder?.rootPath} onPick={linkFolder} onCancel={() => setPicking(false)} pickLabel="Link this folder" />
        </div>
      )}

      <div
        className="panel-body scroll"
        ref={bodyRef}
        onScroll={e => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40; }}
      >
        {!chat.loaded ? (
          <p className="empty">Loading the conversation…</p>
        ) : available.length === 0 ? (
          <div className="empty">
            <strong>No agent CLI found</strong>
            Install Claude Code (<code>npm i -g @anthropic-ai/claude-code</code>) or Codex (<code>brew install codex</code>), sign in once in a terminal, then
            <button type="button" className="linkish" onClick={() => void chat.refreshRunners()}> check again</button>.
          </div>
        ) : chat.messages.length === 0 ? (
          <div className="empty chat-empty">
            <strong>{chat.activeThreadId ? 'This chat is empty' : `New chat with ${runnerInfo?.label ?? 'the agent'}`}</strong>
            Each chat is its own session. The agent sees the project, this diagram and your selection, draws on the canvas while you watch, and leaves notes and versions behind. It reads the linked folder but never edits your code. Switch between Claude Code and Codex any time; the other one gets the conversation so far.
            <div className="suggestions">
              {SUGGESTIONS.map(s => <button key={s} type="button" onClick={() => { setDraft(s); inputRef.current?.focus(); }}>{s}</button>)}
            </div>
          </div>
        ) : (
          <ol className="chat-thread" aria-label="Conversation">
            {chat.messages.map(message => (
              <li key={message.id} className="chat-msg" data-role={message.role} data-status={message.status}>
                <div className="chat-meta">
                  <span className="who"><Icon name={message.role === 'user' ? 'user' : 'bot'} size={12} /> {message.role === 'user' ? 'You' : chat.runners.find(r => r.id === message.runner)?.label ?? message.runner}</span>
                  {message.role === 'assistant' && message.model && <span className="muted">{message.model}</span>}
                  <time dateTime={message.createdAt} title={new Date(message.createdAt).toLocaleString()}>{fmtWhen(message.createdAt)}</time>
                </div>
                {message.role === 'user' ? (
                  <>
                    <div className="chat-user-text">{message.text}</div>
                    {message.selectedIds.length > 0 && (
                      <div className="chips" style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 6 }}>
                        {message.selectedIds.map(id => <button key={id} type="button" className="chip" onClick={() => onFocusElement(id)}><Icon name="locate" size={11} /> {labelFor(id)}</button>)}
                      </div>
                    )}
                  </>
                ) : (
                  project && <AssistantBody message={message} now={now} projectId={project.id} />
                )}
              </li>
            ))}
          </ol>
        )}
      </div>

      <form className="composer" onSubmit={e => { e.preventDefault(); void submit(); }}>
        <div className="about">
          {selectedIds.length === 0
            ? <span>Select shapes to talk about them specifically.</span>
            : <><span>About</span>{selectedIds.slice(0, 6).map(id => <span key={id} className="chip">{labelFor(id)}</span>)}{selectedIds.length > 6 && <span>+{selectedIds.length - 6}</span>}</>}
        </div>
        <textarea
          ref={inputRef}
          className="textarea"
          placeholder={chat.runner ? `Ask ${runnerInfo?.label ?? 'the agent'}, or tell it what to draw…` : 'No agent CLI available'}
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); void submit(); } }}
          disabled={!chat.runner}
          aria-label="Message to the agent"
        />
        <div className="foot">
          <span className="hint">⌘↵ to send{chat.running && chat.runningThreadId && chat.runningThreadId !== chat.activeThreadId ? ' · an agent is busy in another chat' : ''}</span>
          {chat.running ? (
            <button type="button" className="btn btn-sm" onClick={() => void chat.cancel()}><Icon name="stop" size={12} /> Stop</button>
          ) : (
            <button type="submit" className={`btn btn-primary btn-sm ${sending ? 'is-busy' : ''}`} disabled={sending || !draft.trim() || !chat.runner}>
              <Icon name="send" size={14} /> Send
            </button>
          )}
        </div>
      </form>
    </>
  );
}
