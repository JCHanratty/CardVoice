import React, { useState, useEffect } from 'react';
import { createBrowserRouter, RouterProvider, Link, useLocation, useParams, Outlet } from 'react-router-dom';
import { Mic, Database, HelpCircle, LayoutDashboard, ChevronRight, ChevronLeft, Settings as SettingsIcon, Home, PanelLeftClose, PanelLeft, DollarSign } from 'lucide-react';
import axios from 'axios';
import Dashboard from './pages/Dashboard';
import VoiceEntry from './pages/VoiceEntry';
import SetManager from './pages/SetManager';
import SetDetail from './pages/SetDetail';
import HowTo from './pages/HowTo';
import AddSet from './pages/AddSet';
import Settings from './pages/Settings';
import PriceHistory from './pages/PriceHistory';
import LandingPage from './pages/LandingPage';
import ValueDashboard from './pages/ValueDashboard';
import Logo from './components/Logo';

const API = import.meta.env.VITE_API_URL || 'http://localhost:8000';

function NavLink({ to, icon: Icon, label, collapsed }) {
  const location = useLocation();
  const active = to === '/dashboard'
    ? location.pathname === '/dashboard'
    : location.pathname === to || location.pathname.startsWith(to + '/');
  return (
    <Link
      to={to}
      title={collapsed ? label : undefined}
      className={`flex items-center gap-3.5 px-3 py-3 rounded-xl text-base font-medium transition-all duration-200
        ${active
          ? 'bg-cv-accent/15 text-cv-accent border border-cv-accent/30 shadow-[0_0_16px_rgba(139,34,82,0.15)]'
          : 'text-cv-muted hover:text-cv-text hover:bg-white/5'
        }
        ${collapsed ? 'justify-center' : ''}
      `}
    >
      <Icon size={22} />
      {!collapsed && <span>{label}</span>}
    </Link>
  );
}

function Breadcrumbs() {
  const location = useLocation();
  const [setName, setSetName] = useState('');
  const [setYear, setSetYear] = useState(null);

  const path = location.pathname;
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

  const crumbs = [{ label: 'Dashboard', to: '/dashboard' }];

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
  } else if (path.startsWith('/value')) {
    crumbs.push({ label: 'Value Dashboard', to: '/value' });
  } else if (path.startsWith('/settings')) {
    crumbs.push({ label: 'Settings', to: '/settings' });
  }

  if (crumbs.length <= 1) return null;

  return (
    <div className="px-6 py-2 bg-cv-dark/50 border-b border-cv-border/30">
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
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="min-h-screen bg-cv-dark flex">
      {/* Sidebar */}
      <aside className={`sidebar-transition flex flex-col bg-cv-panel/80 backdrop-blur-md border-r border-cv-border/50 sticky top-0 h-screen z-40 ${collapsed ? 'w-[72px]' : 'w-[260px]'}`}>
        {/* Logo area */}
        <div className={`px-4 py-5 border-b border-cv-border/30 ${collapsed ? 'flex justify-center' : ''}`}>
          <Link to="/" className="flex items-center gap-3 group">
            <Logo size={collapsed ? 36 : 48} />
            {!collapsed && (
              <h1 className="text-2xl font-display font-bold text-cv-text tracking-tight">
                Card<span className="bg-gradient-to-r from-cv-accent via-cv-gold to-cv-accent2 bg-clip-text text-transparent">Voice</span>
              </h1>
            )}
          </Link>
        </div>

        {/* Nav links */}
        <nav className="flex-1 px-3 py-4 space-y-1.5 overflow-y-auto">
          <NavLink to="/dashboard" icon={LayoutDashboard} label="Dashboard" collapsed={collapsed} />
          <NavLink to="/voice" icon={Mic} label="Voice Entry" collapsed={collapsed} />
          <NavLink to="/sets" icon={Database} label="My Sets" collapsed={collapsed} />
          <NavLink to="/value" icon={DollarSign} label="Value" collapsed={collapsed} />
          <NavLink to="/how-to" icon={HelpCircle} label="How To" collapsed={collapsed} />
          <NavLink to="/settings" icon={SettingsIcon} label="Settings" collapsed={collapsed} />
        </nav>

        {/* Collapse toggle */}
        <div className="px-3 py-3 border-t border-cv-border/30">
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="flex items-center gap-2 w-full px-3 py-2 rounded-xl text-cv-muted hover:text-cv-text hover:bg-white/5 transition-all text-base"
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {collapsed ? <PanelLeft size={20} /> : <PanelLeftClose size={20} />}
            {!collapsed && <span>Collapse</span>}
          </button>
        </div>
      </aside>

      {/* Main content area */}
      <div className="flex-1 flex flex-col min-h-screen">
        {/* Accent bar */}
        <div className="accent-bar" />
        {/* Breadcrumbs */}
        <Breadcrumbs />

        {/* Main Content */}
        <main className="flex-1 px-6 lg:px-10 py-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

const router = createBrowserRouter([
  {
    path: '/',
    element: <LandingPage />,
  },
  {
    element: <Layout />,
    children: [
      { path: '/dashboard', element: <Dashboard /> },
      { path: '/voice', element: <VoiceEntry /> },
      { path: '/voice/:setId', element: <VoiceEntry /> },
      { path: '/sets', element: <SetManager /> },
      { path: '/sets/add', element: <AddSet /> },
      { path: '/sets/:setId', element: <SetDetail /> },
      { path: '/how-to', element: <HowTo /> },
      { path: '/value', element: <ValueDashboard /> },
      { path: '/settings', element: <Settings /> },
      { path: '/cards/:cardId/prices', element: <PriceHistory /> },
    ],
  },
]);

export default function App() {
  return <RouterProvider router={router} />;
}
