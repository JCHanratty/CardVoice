import React, { useState, useEffect } from 'react';
import { createBrowserRouter, RouterProvider, Link, useLocation, useParams, Outlet } from 'react-router-dom';
import { Mic, Database, HelpCircle, LayoutDashboard, ChevronRight } from 'lucide-react';
import axios from 'axios';
import Dashboard from './pages/Dashboard';
import VoiceEntry from './pages/VoiceEntry';
import SetManager from './pages/SetManager';
import SetDetail from './pages/SetDetail';
import HowTo from './pages/HowTo';
import AddSet from './pages/AddSet';
import Logo from './components/Logo';

const API = import.meta.env.VITE_API_URL || 'http://localhost:8000';

function NavLink({ to, icon: Icon, label }) {
  const location = useLocation();
  const active = to === '/'
    ? location.pathname === '/'
    : location.pathname === to || location.pathname.startsWith(to + '/');
  return (
    <Link
      to={to}
      className={`flex items-center gap-2.5 px-6 py-3 rounded-xl text-lg font-semibold transition-all duration-200
        ${active
          ? 'bg-cv-accent/15 text-cv-accent border border-cv-accent/30 shadow-[0_0_16px_rgba(0,212,170,0.15)]'
          : 'text-cv-muted hover:text-cv-text hover:bg-white/5'
        }`}
    >
      <Icon size={24} />
      <span>{label}</span>
    </Link>
  );
}

function Breadcrumbs() {
  const location = useLocation();
  const [setName, setSetName] = useState('');
  const [setYear, setSetYear] = useState(null);

  const path = location.pathname;
  // Extract setId from path manually since useParams won't work here (outside route context)
  const setIdMatch = path.match(/\/(sets|voice)\/(\d+)/);
  const setId = setIdMatch ? setIdMatch[2] : null;

  useEffect(() => {
    if (setId) {
      axios.get(`${API}/api/sets/${setId}`).then(r => {
        setSetName(r.data.name);
        setSetYear(r.data.year);
      }).catch(() => { setSetName(''); setSetYear(null); });
    } else {
      setSetName('');
      setSetYear(null);
    }
  }, [setId]);

  const crumbs = [{ label: 'Home', to: '/' }];

  if (path.startsWith('/voice')) {
    crumbs.push({ label: 'Voice Entry', to: '/voice' });
    if (setId) {
      const label = setYear ? `${setYear} ${setName}` : (setName || `Set #${setId}`);
      crumbs.push({ label, to: `/sets/${setId}` });
    }
  } else if (path.startsWith('/sets')) {
    crumbs.push({ label: 'My Sets', to: '/sets' });
    if (path === '/sets/add') {
      crumbs.push({ label: 'Add Set', to: '/sets/add' });
    } else if (setId) {
      const label = setYear ? `${setYear} ${setName}` : (setName || `Set #${setId}`);
      crumbs.push({ label, to: `/sets/${setId}` });
    }
  } else if (path.startsWith('/how-to')) {
    crumbs.push({ label: 'How To', to: '/how-to' });
  }

  if (crumbs.length <= 1) return null;

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-2 bg-cv-dark/50 border-b border-cv-border/30">
      <div className="flex items-center gap-1.5 text-sm">
        {crumbs.map((crumb, i) => (
          <React.Fragment key={crumb.to}>
            {i > 0 && <ChevronRight size={14} className="text-cv-muted/50 flex-shrink-0" />}
            {i === crumbs.length - 1 ? (
              <span className="text-cv-text font-medium">{crumb.label}</span>
            ) : (
              <Link to={crumb.to} className="text-cv-muted hover:text-cv-accent transition-colors">{crumb.label}</Link>
            )}
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}

function Layout() {
  return (
    <div className="min-h-screen bg-cv-dark flex flex-col">
      {/* Top Nav */}
      <header className="bg-cv-panel/80 backdrop-blur-md border-b border-cv-border/50 px-4 sm:px-6 lg:px-8 py-4 sticky top-0 z-40">
        <div className="flex items-center justify-between">
          <Link to="/" className="flex items-center gap-3 group">
            <Logo size={52} />
            <h1 className="text-3xl font-bold text-cv-text tracking-tight">
              Card<span className="bg-gradient-to-r from-cv-accent via-cv-red to-cv-accent2 bg-clip-text text-transparent">Voice</span>
            </h1>
          </Link>
          <nav className="flex items-center gap-2">
            <NavLink to="/" icon={LayoutDashboard} label="Home" />
            <NavLink to="/voice" icon={Mic} label="Voice Entry" />
            <NavLink to="/sets" icon={Database} label="My Sets" />
            <NavLink to="/how-to" icon={HelpCircle} label="How To" />
          </nav>
        </div>
      </header>
      {/* Animated accent bar */}
      <div className="accent-bar" />
      {/* Breadcrumbs */}
      <Breadcrumbs />

      {/* Main Content */}
      <main className="flex-1 px-4 sm:px-6 lg:px-8 py-6">
        <Outlet />
      </main>
    </div>
  );
}

const router = createBrowserRouter([
  {
    element: <Layout />,
    children: [
      { path: '/', element: <Dashboard /> },
      { path: '/voice', element: <VoiceEntry /> },
      { path: '/voice/:setId', element: <VoiceEntry /> },
      { path: '/sets', element: <SetManager /> },
      { path: '/sets/add', element: <AddSet /> },
      { path: '/sets/:setId', element: <SetDetail /> },
      { path: '/how-to', element: <HowTo /> },
    ],
  },
]);

export default function App() {
  return <RouterProvider router={router} />;
}
