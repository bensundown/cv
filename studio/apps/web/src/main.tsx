import { createContext, StrictMode, useCallback, useContext, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, NavLink, Route, Routes } from 'react-router-dom';
import { api, type Me } from './api';
import { EquipmentPage } from './pages/Equipment';
import { ImportPreviewPage } from './pages/ImportPreview';
import { InventoryPage } from './pages/Inventory';
import { LoginPage, SetupPage } from './pages/Login';
import { NewProjectPage, ProjectsPage } from './pages/Projects';
import { ProjectWorkspace } from './pages/ProjectWorkspace';
import { VenueEditor } from './pages/VenueEditor';
import { VenuesPage } from './pages/Venues';
import './styles.css';

const MeCtx = createContext<{ me: Me | null; refresh: () => Promise<void> }>({ me: null, refresh: async () => undefined });
export const useMe = () => useContext(MeCtx);

function App() {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const [needsSetup, setNeedsSetup] = useState(false);
  const refresh = useCallback(async () => {
    try {
      setMe(await api.get<Me>('/me'));
    } catch {
      setMe(null);
      const s = await api.get<{ needsSetup: boolean }>('/setup/status').catch(() => ({ needsSetup: false }));
      setNeedsSetup(s.needsSetup);
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (me === undefined) return <div className="center-screen" />;
  if (!me) return needsSetup ? <SetupPage onDone={refresh} /> : <LoginPage onDone={refresh} />;

  return (
    <MeCtx.Provider value={{ me, refresh }}>
      <div className="shell">
        <header className="topbar">
          <img src="/brand/logo-horizontal-white.svg" alt="Sound Ninja" />
          <nav aria-label="Main">
            <NavLink to="/projects">Projects</NavLink>
            <NavLink to="/venues">Venues</NavLink>
            <NavLink to="/inventory">Inventory</NavLink>
          </nav>
          <div className="who">
            <span>
              {me.name} · <span className="mono">{me.role}</span>
            </span>
            <button
              className="btn sm"
              onClick={async () => {
                await api.post('/auth/logout');
                await refresh();
              }}
            >
              Sign out
            </button>
          </div>
        </header>
        <main className="main">
          <Routes>
            <Route path="/" element={<Navigate to="/projects" replace />} />
            <Route path="/projects" element={<ProjectsPage />} />
            <Route path="/projects/new" element={<NewProjectPage />} />
            <Route path="/projects/:id" element={<ProjectWorkspace />} />
            <Route path="/venues" element={<VenuesPage />} />
            <Route path="/venues/:id" element={<VenueEditor />} />
            <Route path="/inventory" element={<InventoryPage />} />
            <Route path="/inventory/imports/:id" element={<ImportPreviewPage />} />
            <Route path="/equipment/:id" element={<EquipmentPage />} />
            <Route path="*" element={<div className="page">Not found</div>} />
          </Routes>
        </main>
      </div>
    </MeCtx.Provider>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
