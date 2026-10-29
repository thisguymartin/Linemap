import { useState, type ReactElement } from 'react';
import { api, type ProjectDetail } from '../api';
import { Icon } from '../icons';
import { useWorkspace } from '../workspace';
import { FolderPicker } from './FolderPicker';

// The project's linked folder: where it lives, its git branch, and the
// controls to change, reveal or unlink it.
export function FolderRow({ project }: { project: ProjectDetail }): ReactElement {
  const { toast, loadProject } = useWorkspace();
  const [picking, setPicking] = useState(false);
  const [confirmUnlink, setConfirmUnlink] = useState(false);
  const folder = project.folder;

  const set = async (rootPath: string | null): Promise<void> => {
    try {
      await api.updateProject(project.id, { rootPath });
      await loadProject(project.id);
      setPicking(false);
      setConfirmUnlink(false);
      toast(rootPath ? 'Folder linked' : 'Folder unlinked');
    } catch (error) {
      toast((error as Error).message, 'error');
    }
  };

  const reveal = async (): Promise<void> => {
    try { await api.reveal(project.id); } catch (error) { toast((error as Error).message, 'error'); }
  };

  return (
    <div className="folder-row">
      <div className="folder-line">
        <Icon name={folder?.git?.isRepo ? 'branch' : 'folder'} />
        {folder?.rootPath ? (
          <>
            <span className="folder-path" title={folder.rootPath}>{folder.display}</span>
            {folder.git?.branch && <span className="pill pill-route">{folder.git.branch}</span>}
            {folder.git?.remote && <span className="small muted folder-remote" title={folder.git.remote}>{folder.git.remote.replace(/^https?:\/\/|\.git$/g, '').replace(/^git@/, '')}</span>}
            {!folder.exists && <span className="pill pill-warn">missing</span>}
            <span className="folder-actions">
              <button type="button" className="btn btn-sm" onClick={() => setPicking(p => !p)}>Change</button>
              <button type="button" className="btn btn-sm" onClick={() => void reveal()} disabled={!folder.exists}><Icon name="folder" size={12} /> Reveal</button>
              {confirmUnlink ? (
                <>
                  <button type="button" className="btn btn-sm btn-danger" onClick={() => void set(null)}>Unlink</button>
                  <button type="button" className="btn btn-sm btn-ghost" onClick={() => setConfirmUnlink(false)}>Keep</button>
                </>
              ) : (
                <button type="button" className="btn btn-sm btn-ghost btn-danger" onClick={() => setConfirmUnlink(true)}>Unlink</button>
              )}
            </span>
          </>
        ) : (
          <>
            <span className="muted">No folder linked. Link the repo these diagrams describe so agents can read it.</span>
            <span className="folder-actions"><button type="button" className="btn btn-sm" aria-pressed={picking} onClick={() => setPicking(p => !p)}><Icon name="folder" size={12} /> Link folder</button></span>
          </>
        )}
      </div>
      {picking && <FolderPicker initialPath={folder?.rootPath} onPick={path => set(path)} onCancel={() => setPicking(false)} pickLabel="Link this folder" />}
    </div>
  );
}
