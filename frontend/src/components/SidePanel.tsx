import type { ReactElement } from 'react';
import type { DiagramMeta, Link, Note, ProjectDetail } from '../api';
import { VersionsTab } from './VersionsTab';
import { NotesTab } from './NotesTab';
import { ContextTab, type SelectedElementInfo } from './ContextTab';
import { ChatTab } from './ChatTab';
import type { ChatController } from '../chat';

export type PanelTab = 'chat' | 'versions' | 'notes' | 'context';

interface Props {
  open: boolean;
  tab: PanelTab;
  onTab: (tab: PanelTab) => void;
  project: ProjectDetail | null;
  diagram: DiagramMeta | null;
  diagramId: string;
  elementCount: number;
  selected: SelectedElementInfo[];
  links: Link[];
  labelFor: (elementId: string) => string;
  onFocusElement: (elementId: string) => void;
  onClearCanvas: () => void;
  canClear: boolean;
  openNotes: Note[];
  onOpenNotes: () => void;
  saveFocusTick: number;
  counts: { versions: number; notes: number; newNotes: boolean };
  chat: ChatController;
  chatNew: boolean;
}

export function SidePanel(props: Props): ReactElement {
  const { open, tab, onTab, project, diagram, diagramId, elementCount, selected, links, labelFor, onFocusElement, onClearCanvas, canClear, openNotes, onOpenNotes, saveFocusTick, counts, chat, chatNew } = props;
  const tabs: Array<{ id: PanelTab; label: string; count?: number; isNew?: boolean; busy?: boolean }> = [
    { id: 'chat', label: 'Chat', busy: chat.running, isNew: chatNew },
    { id: 'versions', label: 'Versions', count: counts.versions },
    { id: 'notes', label: 'Notes', count: counts.notes, isNew: counts.newNotes },
    { id: 'context', label: 'Context', count: selected.length || undefined }
  ];
  return (
    <aside className="panel" data-open={open ? 'true' : 'false'} aria-label="Diagram panel" aria-hidden={!open}>
      <div className="tabs" role="tablist">
        {tabs.map(t => (
          <button key={t.id} type="button" role="tab" className="tab" aria-selected={tab === t.id} id={`tab-${t.id}`} aria-controls={`tabpanel-${t.id}`} onClick={() => onTab(t.id)} tabIndex={open ? 0 : -1}>
            {t.label}
            {t.count !== undefined && t.count > 0 && <span className="count" data-new={t.isNew ? 'true' : 'false'}>{t.count}</span>}
            {t.busy && <span className="tab-busy" aria-label="agent working" />}
            {!t.busy && t.count === undefined && t.isNew && <span className="tab-new" aria-label="new reply" />}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`tabpanel-${tab}`} aria-labelledby={`tab-${tab}`} style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
        {tab === 'chat' && (
          <ChatTab chat={chat} project={project} diagramId={diagramId} selectedIds={selected.map(s => s.id)} labelFor={labelFor} onFocusElement={onFocusElement} />
        )}
        {tab === 'versions' && (
          <div className="panel-body scroll">
            <VersionsTab diagramId={diagramId} elementCount={elementCount} focusTick={saveFocusTick} />
          </div>
        )}
        {tab === 'notes' && project && (
          <NotesTab projectId={project.id} diagramId={diagramId} selectedIds={selected.map(s => s.id)} labelFor={labelFor} onFocusElement={onFocusElement} />
        )}
        {tab === 'context' && (
          <ContextTab project={project} diagram={diagram} selected={selected} links={links} labelFor={labelFor} onFocusElement={onFocusElement} onClearCanvas={onClearCanvas} canClear={canClear} openNotes={openNotes} onOpenNotes={onOpenNotes} />
        )}
      </div>
    </aside>
  );
}
