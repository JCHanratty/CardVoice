import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Mic, Plus, Clock, Zap, Target, Database, ChevronRight } from 'lucide-react';
import axios from 'axios';
import { AreaChart, Area, ResponsiveContainer, Tooltip, XAxis } from 'recharts';
import Logo from '../components/Logo';

/* ── Custom SVG Icons ── */
function IconChecklist({ size = 48, className = '' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" className={className}>
      <defs>
        <linearGradient id="ic-cl-g" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#A0325E" />
          <stop offset="100%" stopColor="#C75080" />
        </linearGradient>
      </defs>
      <rect x="10" y="4" width="28" height="40" rx="4" fill="#2A1520" stroke="url(#ic-cl-g)" strokeWidth="2" />
      <rect x="14" y="10" width="20" height="2" rx="1" fill="#A0325E" opacity="0.4" />
      <rect x="14" y="16" width="14" height="2" rx="1" fill="#A0325E" opacity="0.3" />
      <path d="M16 24l2 2 4-4" stroke="#A0325E" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="24" y="23" width="10" height="2" rx="1" fill="#C75080" opacity="0.5" />
      <path d="M16 31l2 2 4-4" stroke="#A0325E" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="24" y="30" width="8" height="2" rx="1" fill="#C75080" opacity="0.5" />
      <path d="M16 38l2 2 4-4" stroke="#C75080" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" opacity="0.4" />
    </svg>
  );
}

function IconVoiceWave({ size = 48, className = '' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" className={className}>
      <defs>
        <linearGradient id="ic-vw-g" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#8B2252" />
          <stop offset="100%" stopColor="#A0325E" />
        </linearGradient>
      </defs>
      <rect x="20" y="10" width="8" height="16" rx="4" fill="url(#ic-vw-g)" />
      <path d="M16 24c0 5 3.5 8 8 8s8-3 8-8" stroke="#8B2252" strokeWidth="2" strokeLinecap="round" fill="none" />
      <line x1="24" y1="32" x2="24" y2="38" stroke="#8B2252" strokeWidth="2" strokeLinecap="round" />
      <line x1="20" y1="38" x2="28" y2="38" stroke="#8B2252" strokeWidth="2" strokeLinecap="round" />
      <path d="M10 18c0 0-2 6 0 12" stroke="#8B2252" strokeWidth="1.5" strokeLinecap="round" fill="none" opacity="0.5" />
      <path d="M6 14c0 0-3 10 0 20" stroke="#8B2252" strokeWidth="1.5" strokeLinecap="round" fill="none" opacity="0.25" />
      <path d="M38 18c0 0 2 6 0 12" stroke="#8B2252" strokeWidth="1.5" strokeLinecap="round" fill="none" opacity="0.5" />
      <path d="M42 14c0 0 3 10 0 20" stroke="#8B2252" strokeWidth="1.5" strokeLinecap="round" fill="none" opacity="0.25" />
    </svg>
  );
}

function IconCollection({ size = 48, className = '' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" className={className}>
      <defs>
        <linearGradient id="ic-co-g" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#D4A847" />
          <stop offset="100%" stopColor="#F0D78C" />
        </linearGradient>
      </defs>
      <rect x="6" y="14" width="16" height="22" rx="2" fill="#2A2418" stroke="#D4A847" strokeWidth="1.5" opacity="0.6" />
      <rect x="12" y="10" width="16" height="22" rx="2" fill="#2A2418" stroke="#D4A847" strokeWidth="1.5" opacity="0.8" />
      <rect x="18" y="6" width="16" height="22" rx="2" fill="#2A2418" stroke="url(#ic-co-g)" strokeWidth="2" />
      <circle cx="26" cy="15" r="4" fill="none" stroke="#F0D78C" strokeWidth="1.5" />
      <rect x="21" y="21" width="10" height="1.5" rx="0.75" fill="#D4A847" opacity="0.5" />
      <path d="M24 34l3 5h8l-5.5-4 2-6.5L24 34z" fill="url(#ic-co-g)" opacity="0.9" />
      <path d="M24 34l-3 5h-8l5.5-4-2-6.5L24 34z" fill="url(#ic-co-g)" opacity="0.7" />
    </svg>
  );
}

function IconCardStack({ size = 40, className = '' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" fill="none" className={className}>
      <defs>
        <linearGradient id="ic-cs-g" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#8B2252" />
          <stop offset="100%" stopColor="#D4A847" />
        </linearGradient>
      </defs>
      <rect x="8" y="10" width="18" height="24" rx="2.5" fill="#2A1520" stroke="#8B2252" strokeWidth="1.5" opacity="0.5" transform="rotate(-6 17 22)" />
      <rect x="10" y="8" width="18" height="24" rx="2.5" fill="#2A1520" stroke="#8B2252" strokeWidth="1.5" opacity="0.75" transform="rotate(0 19 20)" />
      <rect x="14" y="6" width="18" height="24" rx="2.5" fill="#1E1520" stroke="url(#ic-cs-g)" strokeWidth="2" transform="rotate(6 23 18)" />
    </svg>
  );
}

function IconCardGrid({ size = 40, className = '' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" fill="none" className={className}>
      <defs>
        <linearGradient id="ic-cg-g" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#A0325E" />
          <stop offset="100%" stopColor="#C75080" />
        </linearGradient>
      </defs>
      <rect x="4" y="4" width="14" height="14" rx="3" fill="#2A1520" stroke="url(#ic-cg-g)" strokeWidth="1.5" />
      <rect x="22" y="4" width="14" height="14" rx="3" fill="#2A1520" stroke="url(#ic-cg-g)" strokeWidth="1.5" />
      <rect x="4" y="22" width="14" height="14" rx="3" fill="#2A1520" stroke="url(#ic-cg-g)" strokeWidth="1.5" />
      <rect x="22" y="22" width="14" height="14" rx="3" fill="#2A1520" stroke="url(#ic-cg-g)" strokeWidth="1.5" opacity="0.4" />
      <path d="M27 27l4 4m0-4l-4 4" stroke="#A0325E" strokeWidth="1.5" strokeLinecap="round" opacity="0.6" />
    </svg>
  );
}

function IconTrophy({ size = 40, className = '' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" fill="none" className={className}>
      <defs>
        <linearGradient id="ic-tr-g" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#D4A847" />
          <stop offset="100%" stopColor="#F0D78C" />
        </linearGradient>
      </defs>
      <path d="M12 8h16v10c0 5-3.5 9-8 9s-8-4-8-9V8z" fill="#2A2418" stroke="url(#ic-tr-g)" strokeWidth="2" />
      <path d="M12 12H8c0 0-1 7 4 8" stroke="#D4A847" strokeWidth="1.5" strokeLinecap="round" fill="none" opacity="0.6" />
      <path d="M28 12h4c0 0 1 7-4 8" stroke="#D4A847" strokeWidth="1.5" strokeLinecap="round" fill="none" opacity="0.6" />
      <line x1="20" y1="27" x2="20" y2="32" stroke="#D4A847" strokeWidth="2" strokeLinecap="round" />
      <rect x="14" y="32" width="12" height="3" rx="1.5" fill="url(#ic-tr-g)" />
      <circle cx="20" cy="16" r="3" fill="none" stroke="#F0D78C" strokeWidth="1.5" />
    </svg>
  );
}

const API = import.meta.env.VITE_API_URL || 'http://localhost:8000';

export default function Dashboard() {
  const [sets, setSets] = useState([]);
  const [selectedSet, setSelectedSet] = useState('');
  const navigate = useNavigate();

  const [voiceStats, setVoiceStats] = useState(null);
  const [recentSessions, setRecentSessions] = useState([]);
  const [portfolio, setPortfolio] = useState(null);
  const [priceChanges, setPriceChanges] = useState([]);
  const [recentSets, setRecentSets] = useState([]);
  const [releases, setReleases] = useState([]);
  const [appVersion, setAppVersion] = useState(null);

  useEffect(() => {
    axios.get(`${API}/api/sets`).then(r => setSets(r.data)).catch(() => {});
    axios.get(`${API}/api/voice-sessions/stats`).then(r => setVoiceStats(r.data)).catch(() => {});
    axios.get(`${API}/api/voice-sessions/recent`).then(r => setRecentSessions(r.data)).catch(() => {});
    axios.get(`${API}/api/portfolio`).then(r => setPortfolio(r.data)).catch(() => {});
    axios.get(`${API}/api/portfolio/changes`).then(r => setPriceChanges(r.data)).catch(() => {});
    axios.get(`${API}/api/sets/recent?limit=5`).then(r => setRecentSets(r.data)).catch(() => {});

    fetch('https://api.github.com/repos/JCHanratty/CardVoice/releases?per_page=3')
      .then(r => r.json())
      .then(data => { if (Array.isArray(data)) setReleases(data); })
      .catch(() => {});

    if (window.electronAPI?.getAppVersion) {
      window.electronAPI.getAppVersion().then(v => setAppVersion(v)).catch(() => {});
    }
  }, []);

  const totalChecklist = sets.reduce((acc, s) => acc + (s.total_cards || 0), 0);
  const totalOwned = sets.reduce((acc, s) => acc + (s.owned_count || 0), 0);
  const totalCopies = sets.reduce((acc, s) => acc + (s.total_qty || 0), 0);
  const overallPct = totalChecklist > 0 ? Math.round((totalOwned / totalChecklist) * 100) : 0;
  const hasVoice = voiceStats && voiceStats.total_sessions > 0;

  // Sets with real checklists (10+ cards) that are 100% complete
  const completedSets = sets.filter(s => s.total_cards >= 10 && s.owned_count >= s.total_cards);
  // Sets actively being worked on (10+ cards, some ownership but not complete)
  const activeSets = sets.filter(s => s.total_cards >= 10 && s.owned_count > 0 && s.owned_count < s.total_cards)
    .sort((a, b) => (b.owned_count / b.total_cards) - (a.owned_count / a.total_cards));
  const setsWithCards = sets.filter(s => s.owned_count > 0).length;

  const handleQuickVoice = () => {
    if (selectedSet) navigate(`/voice/${selectedSet}`);
    else navigate('/voice');
  };

  return (
    <div className="w-full">

      {/* ═══ HERO ═══ */}
      <div className="relative rounded-2xl overflow-hidden mb-8">
        {/* Background layers */}
        <div className="absolute inset-0 bg-gradient-to-br from-cv-dark via-cv-panel to-cv-dark" />
        <div className="absolute inset-0 hero-grid opacity-[0.03]" />
        <div className="absolute -top-32 -right-32 w-96 h-96 bg-cv-accent/8 rounded-full blur-[100px] pointer-events-none" />
        <div className="absolute -bottom-24 -left-24 w-80 h-80 bg-cv-gold/8 rounded-full blur-[100px] pointer-events-none" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-64 h-64 bg-cv-accent/3 rounded-full blur-[80px] pointer-events-none" />
        <div className="absolute -top-16 left-1/4 w-48 h-48 bg-cv-accent2/6 rounded-full blur-[80px] pointer-events-none" />

        <div className="relative px-8 py-12 sm:px-12 sm:py-16 flex flex-col items-center text-center">
          {/* Logo */}
          <div className="mb-6 relative">
            <div className="absolute inset-0 blur-2xl bg-cv-accent/15 rounded-full scale-150 pointer-events-none" />
            <Logo size={100} className="relative" />
          </div>

          {/* Title */}
          <h1 className="text-4xl sm:text-5xl font-display font-bold text-cv-text tracking-tight mb-3">
            Card<span className="text-gold-shimmer">Voice</span>
          </h1>

          {/* Tagline */}
          <p className="text-cv-muted text-lg max-w-xl mb-8 leading-relaxed">
            The hands-free way to manage your sports card collection.
            Speak your cards, parse checklists, track what you own.
          </p>

          {/* CTA Buttons */}
          <div className="flex flex-wrap items-center justify-center gap-3">
            <Link to="/voice"
              className="flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-semibold bg-gradient-to-r from-cv-accent to-cv-accent2 text-white hover:shadow-lg hover:shadow-cv-accent/25 transition-all">
              <Mic size={18} /> Start Voice Entry
            </Link>
            <Link to="/sets/add"
              className="flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-semibold bg-cv-gold/15 border border-cv-gold/30 text-cv-gold hover:bg-cv-gold/25 transition-all">
              <Plus size={18} /> Add a Set
            </Link>
            <Link to="/sets"
              className="flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-semibold bg-white/5 border border-cv-border/50 text-cv-text hover:bg-white/10 transition-all">
              <Database size={18} /> My Collection
            </Link>
          </div>
        </div>
      </div>

      {/* ═══ HOW IT WORKS ═══ */}
      <div className="mb-10">
        <h2 className="text-sm font-semibold text-cv-muted uppercase tracking-widest mb-6 text-center font-display">How It Works</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-0 relative">
          {/* Connecting lines (hidden on mobile) */}
          <div className="hidden sm:block absolute top-[52px] left-[calc(33.33%-20px)] w-[calc(33.33%+40px)] h-[2px] bg-gradient-to-r from-cv-accent2/30 via-cv-accent/30 to-cv-gold/30 z-0" />

          {/* Import */}
          <div className="relative z-10 flex flex-col items-center text-center px-6 py-5 group">
            <div className="w-[104px] h-[104px] rounded-2xl bg-cv-accent2/5 border border-cv-accent2/15 flex items-center justify-center mb-4 group-hover:border-cv-accent2/40 group-hover:bg-cv-accent2/10 group-hover:shadow-[0_0_30px_rgba(160,50,94,0.12)] transition-all duration-300">
              <IconChecklist size={56} />
            </div>
            <h3 className="text-cv-text font-display font-bold text-base mb-1.5">Import Checklists</h3>
            <p className="text-xs text-cv-muted leading-relaxed max-w-[200px]">Paste a Beckett checklist. Sections, parallels & card counts are detected automatically.</p>
          </div>

          {/* Voice */}
          <div className="relative z-10 flex flex-col items-center text-center px-6 py-5 group">
            <div className="w-[104px] h-[104px] rounded-2xl bg-cv-accent/5 border border-cv-accent/15 flex items-center justify-center mb-4 group-hover:border-cv-accent/40 group-hover:bg-cv-accent/10 group-hover:shadow-[0_0_30px_rgba(139,34,82,0.12)] transition-all duration-300">
              <IconVoiceWave size={56} />
            </div>
            <h3 className="text-cv-text font-display font-bold text-base mb-1.5">Speak Your Cards</h3>
            <p className="text-xs text-cv-muted leading-relaxed max-w-[200px]">Say card numbers out loud. Voice recognition logs them instantly — no typing needed.</p>
          </div>

          {/* Track */}
          <div className="relative z-10 flex flex-col items-center text-center px-6 py-5 group">
            <div className="w-[104px] h-[104px] rounded-2xl bg-cv-gold/5 border border-cv-gold/15 flex items-center justify-center mb-4 group-hover:border-cv-gold/40 group-hover:bg-cv-gold/10 group-hover:shadow-[0_0_30px_rgba(212,168,71,0.12)] transition-all duration-300">
              <IconCollection size={56} />
            </div>
            <h3 className="text-cv-text font-display font-bold text-base mb-1.5">Track Progress</h3>
            <p className="text-xs text-cv-muted leading-relaxed max-w-[200px]">See what you have, what you need, and track completion across every set you own.</p>
          </div>
        </div>
      </div>

      {/* ═══ YOUR COLLECTION ═══ */}
      <div className="mb-8">
        <h2 className="text-sm font-semibold text-cv-muted uppercase tracking-widest mb-4 text-center font-display">Your Collection</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
          {/* Sets Card */}
          <div className="relative bg-gradient-card-burgundy rounded-2xl border border-cv-accent/20 p-6 glow-burgundy transition-all overflow-hidden group">
            <div className="absolute -top-8 -right-8 w-28 h-28 bg-cv-accent/8 rounded-full blur-2xl pointer-events-none group-hover:bg-cv-accent/15 transition-all" />
            <div className="relative">
              <div className="flex items-center justify-between mb-4">
                <IconCardStack size={44} />
                <Link to="/sets" className="text-xs text-cv-accent hover:text-cv-accent/80 font-medium transition-colors">View All →</Link>
              </div>
              <div className="text-4xl font-extrabold text-cv-text font-mono tracking-tight">{sets.length}</div>
              <div className="text-sm text-cv-muted mt-1 font-medium">Total Sets</div>
              <div className="text-xs text-cv-muted/70 mt-0.5">{setsWithCards} with cards</div>
            </div>
          </div>

          {/* Cards Owned Card */}
          <div className="relative bg-gradient-card-rose rounded-2xl border border-cv-accent2/20 p-6 glow-rose transition-all overflow-hidden group">
            <div className="absolute -top-8 -right-8 w-28 h-28 bg-cv-accent2/8 rounded-full blur-2xl pointer-events-none group-hover:bg-cv-accent2/15 transition-all" />
            <div className="relative">
              <div className="flex items-center justify-between mb-4">
                <IconCardGrid size={44} />
                <span className="text-xs text-cv-accent2 font-medium">{totalOwned.toLocaleString()} unique</span>
              </div>
              <div className="text-4xl font-extrabold text-cv-text font-mono tracking-tight">{totalCopies.toLocaleString()}</div>
              <div className="text-sm text-cv-muted mt-1 font-medium">Cards Owned</div>
              <div className="text-xs text-cv-muted/70 mt-0.5">{totalChecklist.toLocaleString()} in checklists</div>
            </div>
          </div>

          {/* Completion Card */}
          <div className="relative bg-gradient-card-gold rounded-2xl border border-cv-gold/20 p-6 glow-gold transition-all overflow-hidden group">
            <div className="absolute -top-8 -right-8 w-28 h-28 bg-cv-gold/8 rounded-full blur-2xl pointer-events-none group-hover:bg-cv-gold/15 transition-all" />
            <div className="relative">
              <div className="flex items-center justify-between mb-4">
                <IconTrophy size={44} />
                <span className="text-xs text-cv-gold font-medium">{completedSets.length} complete</span>
              </div>
              <div className="text-4xl font-extrabold text-cv-text font-mono tracking-tight">{overallPct}%</div>
              <div className="text-sm text-cv-muted mt-1 font-medium mb-3">Overall Completion</div>
              {totalChecklist > 0 && (
                <div className="progress-bar !h-2 !rounded">
                  <div className="progress-bar-fill !rounded" style={{ width: `${overallPct}%` }} />
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Voice Stats Row */}
        {hasVoice && (
          <div className="grid grid-cols-3 gap-4">
            <div className="bg-cv-panel/60 rounded-xl border border-cv-border/30 p-5">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-cv-accent/10">
                  <Clock size={22} className="text-cv-accent" />
                </div>
                <div>
                  <div className="text-2xl font-bold text-cv-text font-mono">{Math.round(voiceStats.total_seconds / 60)}m</div>
                  <div className="text-sm text-cv-muted">Time Logging</div>
                </div>
              </div>
            </div>
            <div className="bg-cv-panel/60 rounded-xl border border-cv-border/30 p-5">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-cv-gold/10">
                  <Zap size={22} className="text-cv-gold" />
                </div>
                <div>
                  <div className="text-2xl font-bold text-cv-text font-mono">{voiceStats.avg_cards_per_min}</div>
                  <div className="text-sm text-cv-muted">Cards/Min</div>
                </div>
              </div>
            </div>
            <div className="bg-cv-panel/60 rounded-xl border border-cv-border/30 p-5">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-cv-accent2/10">
                  <Target size={22} className="text-cv-accent2" />
                </div>
                <div>
                  <div className="text-2xl font-bold text-cv-text font-mono">{voiceStats.lifetime_accuracy}%</div>
                  <div className="text-sm text-cv-muted">Accuracy</div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ═══ RECENTLY ADDED SETS ═══ */}
      {recentSets.length > 0 && (
        <div className="mb-8">
          <h2 className="text-xl font-display font-bold text-cv-text mb-4 flex items-center gap-2">
            <Database size={20} className="text-cv-accent" />
            Recently Added Sets
          </h2>
          <div className="grid gap-3">
            {recentSets.map(set => (
              <Link
                key={set.id}
                to={`/sets/${set.id}`}
                className="flex items-center justify-between p-4 rounded-xl bg-cv-panel/60 border border-cv-border/40 hover:border-cv-accent/40 transition-all group"
              >
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-lg bg-cv-accent/10 flex items-center justify-center text-cv-accent font-mono text-sm font-bold">
                    {set.year ? String(set.year).slice(-2) : '\u2014'}
                  </div>
                  <div>
                    <p className="text-cv-text font-medium group-hover:text-cv-accent transition-colors">
                      {set.year ? `${set.year} ` : ''}{set.name}
                    </p>
                    <p className="text-cv-muted text-sm">
                      {set.brand || 'Unknown'} · {set.total_cards} cards · {set.owned_count} owned
                    </p>
                  </div>
                </div>
                <ChevronRight size={18} className="text-cv-muted group-hover:text-cv-accent transition-colors" />
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* ═══ SET PROGRESS ═══ */}
      {(completedSets.length > 0 || activeSets.length > 0) && (
        <div className="mb-8">
          <h2 className="text-sm font-semibold text-cv-muted uppercase tracking-widest mb-4 text-center font-display">Set Progress</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Completed Sets */}
            {completedSets.length > 0 && (
              <div className="bg-cv-panel/60 rounded-xl border border-cv-border/30 p-5">
                <h3 className="text-sm font-semibold text-cv-text mb-3 flex items-center gap-2">
                  <span className="text-cv-gold">&#10003;</span> Completed Sets
                  <span className="text-xs text-cv-muted font-normal ml-auto">{completedSets.length}</span>
                </h3>
                <div className="space-y-2">
                  {completedSets.map(s => (
                    <Link key={s.id} to={`/sets/${s.id}`} className="flex justify-between items-center py-1.5 text-sm hover:bg-white/[0.03] rounded px-2 -mx-2 transition-colors">
                      <span className="text-cv-text">{s.year} {s.name}</span>
                      <span className="text-cv-gold font-mono text-xs">{s.owned_count}/{s.total_cards}</span>
                    </Link>
                  ))}
                </div>
              </div>
            )}

            {/* In Progress Sets */}
            {activeSets.length > 0 && (
              <div className="bg-cv-panel/60 rounded-xl border border-cv-border/30 p-5">
                <h3 className="text-sm font-semibold text-cv-text mb-3 flex items-center gap-2">
                  In Progress
                  <span className="text-xs text-cv-muted font-normal ml-auto">{activeSets.length}</span>
                </h3>
                <div className="space-y-2.5">
                  {activeSets.slice(0, 8).map(s => {
                    const pct = Math.round((s.owned_count / s.total_cards) * 100);
                    return (
                      <Link key={s.id} to={`/sets/${s.id}`} className="block hover:bg-white/[0.03] rounded px-2 py-1.5 -mx-2 transition-colors">
                        <div className="flex justify-between items-center text-sm mb-1">
                          <span className="text-cv-text">{s.year} {s.name}</span>
                          <span className="text-cv-muted font-mono text-xs">{s.owned_count}/{s.total_cards} <span className="text-cv-accent">{pct}%</span></span>
                        </div>
                        <div className="w-full h-1 bg-cv-border/50 rounded-full overflow-hidden">
                          <div className="h-full bg-gradient-to-r from-cv-accent to-cv-gold rounded-full" style={{ width: `${pct}%` }} />
                        </div>
                      </Link>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ═══ PORTFOLIO VALUE ═══ */}
      {portfolio && (portfolio.totalValue > 0 || portfolio.timeline.length > 0) && (
        <div className="mt-10">
          <h2 className="text-2xl font-display font-bold text-cv-text mb-4">Portfolio Value</h2>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="bg-cv-panel rounded-xl p-5 border border-cv-border/50">
              <div className="text-sm text-cv-muted mb-1">Total Estimated Value</div>
              <div className="text-3xl font-bold text-cv-gold font-mono">
                ${portfolio.totalValue.toFixed(2)}
              </div>
              <div className="mt-3 text-xs text-cv-muted">
                Proportional value based on ownership
              </div>
            </div>

            {portfolio.timeline.length > 1 && (
              <div className="bg-cv-panel rounded-xl p-5 border border-cv-border/50 col-span-2">
                <div className="text-sm text-cv-muted mb-2">Value Over Time</div>
                <div className="h-32">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={portfolio.timeline}>
                      <XAxis dataKey="snapshot_date" tick={{ fontSize: 10, fill: '#78716C' }} />
                      <Tooltip
                        contentStyle={{ background: '#1E1E22', border: '1px solid #2A2A2E', borderRadius: 8 }}
                        labelStyle={{ color: '#78716C' }}
                        formatter={(val) => [`$${val.toFixed(2)}`, 'Value']}
                      />
                      <Area type="monotone" dataKey="total_value" stroke="#D4A847" fill="#D4A847" fillOpacity={0.15} strokeWidth={2} dot={false} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
            {portfolio.topSets.length > 0 && (
              <div className="bg-cv-panel rounded-xl p-5 border border-cv-border/50">
                <h3 className="text-sm font-semibold text-cv-text mb-3">Top Sets by Value</h3>
                {portfolio.topSets.map((s, i) => (
                  <div key={s.id} className="flex justify-between items-center py-1.5 text-sm border-b border-cv-border/30 last:border-0">
                    <span className="text-cv-text">{i + 1}. {s.year} {s.name}</span>
                    <span className="text-cv-gold font-mono">${s.proportional_value.toFixed(2)}</span>
                  </div>
                ))}
              </div>
            )}

            {portfolio.topCards.length > 0 && (
              <div className="bg-cv-panel rounded-xl p-5 border border-cv-border/50">
                <h3 className="text-sm font-semibold text-cv-text mb-3">Top Tracked Cards</h3>
                {portfolio.topCards.map((c, i) => (
                  <div key={c.id} className="flex justify-between items-center py-1.5 text-sm border-b border-cv-border/30 last:border-0">
                    <span className="text-cv-text">{i + 1}. #{c.card_number} {c.player} <span className="text-cv-muted">({c.set_year} {c.set_name})</span></span>
                    <span className="text-cv-gold font-mono">${c.median_price.toFixed(2)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {priceChanges.length > 0 && (
            <div className="bg-cv-panel rounded-xl p-5 border border-cv-border/50 mt-4">
              <h3 className="text-sm font-semibold text-cv-text mb-3">Recent Price Changes</h3>
              {priceChanges.map(c => {
                const diff = c.current_price - c.previous_price;
                const pct = ((diff / c.previous_price) * 100).toFixed(1);
                const up = diff > 0;
                return (
                  <div key={c.id} className="flex justify-between items-center py-1.5 text-sm border-b border-cv-border/30 last:border-0">
                    <span className="text-cv-text">#{c.card_number} {c.player} <span className="text-cv-muted">({c.set_year} {c.set_name})</span></span>
                    <span className={`font-mono ${up ? 'text-cv-gold' : 'text-red-400'}`}>
                      {up ? '\u2191' : '\u2193'} {up ? '+' : ''}{pct}% (${c.current_price.toFixed(2)})
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ═══ QUICK START ═══ */}
      <div className="mb-8">
        <div className="relative bg-cv-panel/50 rounded-2xl border border-cv-border/30 p-6 overflow-hidden">
          <div className="absolute -top-16 -right-16 w-48 h-48 bg-cv-accent/5 rounded-full blur-3xl pointer-events-none" />
          <div className="absolute -bottom-12 -left-12 w-36 h-36 bg-cv-gold/5 rounded-full blur-3xl pointer-events-none" />
          <div className="relative flex items-center gap-6">
            <div className="flex items-center gap-4 flex-1">
              <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-cv-accent/20 to-cv-gold/20 flex items-center justify-center shrink-0">
                <Mic size={28} className="text-cv-accent" />
              </div>
              <div>
                <h3 className="text-lg font-display font-bold text-cv-text">Quick Voice Entry</h3>
                <p className="text-sm text-cv-muted">Select a set and start speaking card numbers</p>
              </div>
            </div>
            {sets.length > 0 ? (
              <div className="flex items-center gap-3">
                <select
                  value={selectedSet}
                  onChange={e => setSelectedSet(e.target.value)}
                  className="bg-cv-dark border border-cv-border rounded-xl px-4 py-2.5 text-sm text-cv-text focus:border-cv-accent focus:outline-none min-w-[220px]"
                >
                  <option value="">Select a set...</option>
                  {Object.entries(sets.reduce((groups, s) => {
                    const yr = s.year || 'No Year';
                    if (!groups[yr]) groups[yr] = [];
                    groups[yr].push(s);
                    return groups;
                  }, {})).map(([year, yearSets]) => (
                    <optgroup key={year} label={`── ${year} ──`}>
                      {yearSets.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </optgroup>
                  ))}
                </select>
                <button
                  onClick={handleQuickVoice}
                  className="flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-semibold bg-gradient-to-r from-cv-accent to-cv-accent2 text-white hover:shadow-lg hover:shadow-cv-accent/25 transition-all whitespace-nowrap"
                >
                  <Mic size={18} /> Start Recording
                </button>
              </div>
            ) : (
              <Link to="/sets/add"
                className="flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-semibold bg-cv-gold/15 border border-cv-gold/30 text-cv-gold hover:bg-cv-gold/25 transition-all whitespace-nowrap">
                <Plus size={18} /> Add a Set to Begin
              </Link>
            )}
          </div>
        </div>
      </div>

      {/* ═══ RECENT ACTIVITY ═══ */}
      {recentSessions.length > 0 && (
        <div className="mb-8">
          <h2 className="text-xs font-semibold text-cv-muted uppercase tracking-widest mb-3 font-display">Recent Sessions</h2>
          <div className="bg-cv-panel/50 rounded-xl border border-cv-border/30 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-cv-border/30">
                  <th className="text-left px-4 py-3 text-xs text-cv-muted uppercase tracking-wider font-semibold">Date</th>
                  <th className="text-left px-4 py-3 text-xs text-cv-muted uppercase tracking-wider font-semibold">Set</th>
                  <th className="text-center px-4 py-3 text-xs text-cv-muted uppercase tracking-wider font-semibold">Cards</th>
                  <th className="text-center px-4 py-3 text-xs text-cv-muted uppercase tracking-wider font-semibold">Speed</th>
                  <th className="text-center px-4 py-3 text-xs text-cv-muted uppercase tracking-wider font-semibold">Accuracy</th>
                </tr>
              </thead>
              <tbody>
                {recentSessions.map(session => (
                  <tr key={session.id} className="border-b border-cv-border/20 hover:bg-white/[0.02] transition-colors">
                    <td className="px-4 py-3 text-cv-muted">
                      {new Date(session.timestamp).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3 text-cv-text font-medium">
                      {session.set_name || 'Unknown Set'}
                    </td>
                    <td className="px-4 py-3 text-center text-cv-accent font-mono font-semibold">
                      {session.total_cards}
                    </td>
                    <td className="px-4 py-3 text-center text-cv-text font-mono">
                      {session.cards_per_min}/min
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-mono font-bold ${
                        session.accuracy_pct >= 90 ? 'bg-cv-accent/15 text-cv-accent' :
                        session.accuracy_pct >= 70 ? 'bg-cv-gold/15 text-cv-gold' : 'bg-cv-red/15 text-cv-red'
                      }`}>
                        {session.accuracy_pct}%
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ═══ RELEASE NOTES ═══ */}
      {releases.length > 0 && (
        <div className="mb-8">
          <h2 className="text-xl font-display font-bold text-cv-text mb-4 flex items-center gap-2">
            <Zap size={20} className="text-cv-gold" />
            What's New
            {appVersion && (
              <span className="text-xs font-mono text-cv-muted ml-auto">
                Current: v{appVersion}
              </span>
            )}
          </h2>
          <div className="space-y-3">
            {releases.map(release => (
              <div key={release.id} className="p-4 rounded-xl bg-cv-panel/60 border border-cv-border/40">
                <div className="flex items-center gap-3 mb-2">
                  <span className="text-cv-gold font-mono text-sm font-bold">{release.tag_name}</span>
                  <span className="text-cv-muted text-xs">
                    {new Date(release.published_at).toLocaleDateString()}
                  </span>
                </div>
                <p className="text-cv-text text-sm leading-relaxed whitespace-pre-wrap">
                  {(release.body || 'No release notes.').slice(0, 300)}
                  {(release.body || '').length > 300 ? '...' : ''}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
