import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AppShell } from './components/layout/AppShell';
import { Dashboard } from './pages/Dashboard';
import { DirectMigration } from './pages/DirectMigration';
import { ExportNDJSON } from './pages/ExportNDJSON';
import { ImportNDJSON } from './pages/ImportNDJSON';
import { ResourceMapping } from './pages/ResourceMapping';
import { FHIRExplorer } from './pages/FHIRExplorer';
import { Logs } from './pages/Logs';
import { Settings } from './pages/Settings';
import { Cleanup } from './pages/Cleanup';
import './index.css';

export default function App() {
  return (
    <BrowserRouter>
      <AppShell>
        <Routes>
          <Route path="/"          element={<Dashboard />} />
          <Route path="/migrate"   element={<DirectMigration />} />
          <Route path="/cleanup"   element={<Cleanup />} />
          <Route path="/export"    element={<ExportNDJSON />} />
          <Route path="/import"    element={<ImportNDJSON />} />
          <Route path="/mapping"   element={<ResourceMapping />} />
          <Route path="/explorer"  element={<FHIRExplorer />} />
          <Route path="/logs"      element={<Logs />} />
          <Route path="/settings"  element={<Settings />} />
        </Routes>
      </AppShell>
    </BrowserRouter>
  );
}
