import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useAuth } from "./context/AuthContext";
import Alerts from "./views/Alerts";
import BatchView from "./views/BatchView";
import CaseList from "./views/CaseList";
import Dashboard from "./views/Dashboard";
import Investigation from "./views/Investigation";
import Login from "./views/Login";
import NewTrace from "./views/NewTrace";
import VaspRegistry from "./views/VaspRegistry";
import Watchlist from "./views/Watchlist";
import Shell from "./components/Shell";

function RequireAuth({ children }: { children: JSX.Element }) {
  const { session } = useAuth();
  const location = useLocation();
  if (!session) return <Navigate to="/login" state={{ from: location }} replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        path="/"
        element={
          <RequireAuth>
            <Shell />
          </RequireAuth>
        }
      >
        <Route index element={<Dashboard />} />
        <Route path="trace" element={<NewTrace />} />
        <Route path="investigation/:traceId" element={<Investigation />} />
        <Route path="batch/:batchId" element={<BatchView />} />
        <Route path="watchlist" element={<Watchlist />} />
        <Route path="cases" element={<CaseList />} />
        <Route path="registry" element={<VaspRegistry />} />
        <Route path="alerts" element={<Alerts />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
