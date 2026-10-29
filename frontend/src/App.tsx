import { useEffect, type ReactElement } from 'react';
import { diagramPath } from './api';
import { navigate, useRoute } from './router';
import { WorkspaceProvider, useWorkspace } from './workspace';
import { CanvasPage } from './pages/CanvasPage';
import { ProjectPage } from './pages/ProjectPage';
import { ProjectsPage } from './pages/ProjectsPage';

function Toast(): ReactElement | null {
  const { toastState } = useWorkspace();
  if (!toastState) return null;
  return <div key={toastState.id} className="toast" data-kind={toastState.kind} role="status">{toastState.message}</div>;
}

// `/` lands straight on whatever is on the canvas.
function Home(): ReactElement {
  const { activeDiagramId, activeProjectId, connected } = useWorkspace();
  useEffect(() => {
    if (activeDiagramId && activeProjectId) navigate(diagramPath(activeProjectId, activeDiagramId), { replace: true });
  }, [activeDiagramId, activeProjectId]);
  return (
    <div className="app">
      <header className="topbar" />
      <div className="page"><p className="empty">{connected ? 'Opening the canvas…' : 'Connecting to the canvas server…'}</p></div>
    </div>
  );
}

function Routes(): ReactElement {
  const route = useRoute();
  switch (route.name) {
    case 'canvas': return <CanvasPage key={route.diagramId} projectId={route.projectId} diagramId={route.diagramId} />;
    case 'project': return <ProjectPage projectId={route.projectId} />;
    case 'projects': return <ProjectsPage />;
    default: return <Home />;
  }
}

export default function App(): ReactElement {
  return (
    <WorkspaceProvider>
      <Routes />
      <Toast />
    </WorkspaceProvider>
  );
}
