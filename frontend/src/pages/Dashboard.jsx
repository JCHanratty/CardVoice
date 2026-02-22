import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Mic, Plus, Clock, Zap, Target, Database, ChevronRight,
  TrendingUp, TrendingDown, BarChart3, ArrowUpRight, Layers,
  Trophy, Activity
} from 'lucide-react';
import axios from 'axios';
import { AreaChart, Area, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

const API = import.meta.env.VITE_API_URL || 'http://localhost:8000';

/* ── Formatting helpers ── */
function fmtNum(n) { return (n || 0).toLocaleString(); }
function fmtDollar(n) { return `$${(n || 0).toFixed(2)}`; }
function fmtDate(d) { return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); }
function fmtDateLong(d) { return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); }

/* ── Stat Tile ── */
function StatTile({ label, value, sub, icon: Icon, accent = 'cv-accent', delay = 0 }) {
  return (
    <div
      className="relative bg-cv-panel/70 rounded-xl border border-cv-border/40 p-4 group hover:border-cv-border/70 transition-all duration-300"
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className="flex items-start justify-between mb-2">
        <div className={`p-2 rounded-lg bg-${accent}/10`}>
          <Icon size={18} className={`text-${accent}`} />
        </div>
        {sub && <span className="text-[0.75rem] text-cv-muted font-mono">{sub}</span>}
      </div>
      <div className="text-2xl font-bold text-cv-text font-mono tracking-tight leading-none mb-1">{value}</div>
      <div className="text-[0.8rem] text-cv-muted">{label}</div>
    </div>
  );
}

/* ── Section Header ── */
function SectionHeader({ children, icon: Icon, right }) {
  return (
    <div className="flex items-center justify-between mb-3">
      <h3 className="text-sm font-semibold text-cv-muted uppercase tracking-widest font-display flex items-center gap-2">
        {Icon && <Icon size={14} className="text-cv-accent" />}
        {children}
      </h3>
      {right}
    </div>
  );
}

/* ── Panel wrapper ── */
function Panel({ children, className = '' }) {
  return (
    <div className={`bg-cv-panel/50 rounded-xl border border-cv-border/30 p-5 ${className}`}>
      {children}
    </div>
  );
}

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

  /* ── Derived data ── */
  const totalChecklist = sets.reduce((acc, s) => acc + (s.total_cards || 0), 0);
  const totalOwned = sets.reduce((acc, s) => acc + (s.owned_count || 0), 0);
  const totalCopies = sets.reduce((acc, s) => acc + (s.total_qty || 0), 0);
  const overallPct = totalChecklist > 0 ? Math.round((totalOwned / totalChecklist) * 100) : 0;
  const hasVoice = voiceStats && voiceStats.total_sessions > 0;
  const completedSets = sets.filter(s => s.total_cards >= 10 && s.owned_count >= s.total_cards);
  const activeSets = sets.filter(s => s.total_cards >= 10 && s.owned_count > 0 && s.owned_count < s.total_cards)
    .sort((a, b) => (b.owned_count / b.total_cards) - (a.owned_count / a.total_cards));
  const setsWithCards = sets.filter(s => s.owned_count > 0).length;
  const hasPortfolio = portfolio && (portfolio.totalValue > 0 || portfolio.timeline?.length > 0);

  const handleQuickVoice = () => {
    if (selectedSet) navigate(`/voice/${selectedSet}`);
    else navigate('/voice');
  };

  const greeting = (() => {
    const h = new Date().getHours();
    if (h < 12) return 'Good Morning';
    if (h < 17) return 'Good Afternoon';
    return 'Good Evening';
  })();

  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric'
  });

  return (
    <div className="w-full fade-in-up">

      {/* ═══ HEADER ═══ */}
      <div className="flex items-end justify-between mb-6">
        <div>
          <h1 className="text-2xl font-display font-bold text-cv-text tracking-tight">{greeting}</h1>
          <p className="text-sm text-cv-muted mt-0.5">{today}</p>
        </div>
        <div className="flex items-center gap-2">
          <Link to="/voice"
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold bg-gradient-to-r from-cv-accent to-cv-accent2 text-white hover:shadow-lg hover:shadow-cv-accent/25 transition-all">
            <Mic size={15} /> Voice Entry
          </Link>
          <Link to="/sets/add"
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold bg-cv-gold/10 border border-cv-gold/25 text-cv-gold hover:bg-cv-gold/20 transition-all">
            <Plus size={15} /> New Set
          </Link>
        </div>
      </div>

      {/* ═══ STAT TILES ═══ */}
      <div className={`grid gap-3 mb-6 ${hasVoice ? 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-6' : 'grid-cols-2 sm:grid-cols-4'}`}>
        <StatTile label="Total Sets" value={sets.length} sub={`${setsWithCards} active`} icon={Layers} accent="cv-accent" delay={0} />
        <StatTile label="Unique Cards" value={fmtNum(totalOwned)} sub={`${fmtNum(totalCopies)} total`} icon={Database} accent="cv-accent2" delay={50} />
        <StatTile label="Completion" value={`${overallPct}%`} sub={`${completedSets.length} done`} icon={Target} accent="cv-gold" delay={100} />
        {hasPortfolio && (
          <StatTile label="Portfolio" value={fmtDollar(portfolio.totalValue)} icon={TrendingUp} accent="cv-gold" delay={150} />
        )}
        {hasVoice && (
          <>
            <StatTile label="Voice Sessions" value={voiceStats.total_sessions} sub={`${Math.round(voiceStats.total_seconds / 60)}m total`} icon={Mic} accent="cv-accent" delay={200} />
            <StatTile label="Accuracy" value={`${voiceStats.lifetime_accuracy}%`} sub={`${voiceStats.avg_cards_per_min}/min`} icon={Activity} accent="cv-accent2" delay={250} />
          </>
        )}
      </div>

      {/* ═══ MAIN GRID ═══ */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">

        {/* ── Left Column: Portfolio Chart + Set Progress (2 cols) ── */}
        <div className="lg:col-span-2 space-y-4">

          {/* Portfolio Value Chart */}
          {hasPortfolio && (
            <Panel>
              <SectionHeader icon={BarChart3} right={
                <Link to="/value" className="text-[0.75rem] text-cv-accent hover:text-cv-accent/80 transition-colors flex items-center gap-1">
                  Full Report <ArrowUpRight size={12} />
                </Link>
              }>
                Portfolio Value
              </SectionHeader>
              <div className="flex items-baseline gap-4 mb-4">
                <span className="text-3xl font-bold text-cv-gold font-mono">{fmtDollar(portfolio.totalValue)}</span>
                <span className="text-xs text-cv-muted">estimated value across {setsWithCards} sets</span>
              </div>
              {portfolio.timeline?.length > 1 && (
                <div className="h-40 -mx-2">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={portfolio.timeline}>
                      <defs>
                        <linearGradient id="goldGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#D4A847" stopOpacity={0.3} />
                          <stop offset="100%" stopColor="#D4A847" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <XAxis dataKey="snapshot_date" tick={{ fontSize: 10, fill: '#78716C' }} tickLine={false} axisLine={false} />
                      <Tooltip
                        contentStyle={{ background: '#1E1E22', border: '1px solid #2A2A2E', borderRadius: 8, fontSize: 12 }}
                        labelStyle={{ color: '#78716C' }}
                        formatter={(val) => [fmtDollar(val), 'Value']}
                      />
                      <Area type="monotone" dataKey="total_value" stroke="#D4A847" fill="url(#goldGrad)" strokeWidth={2} dot={false} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              )}

              {/* Top Sets + Top Cards inline */}
              {(portfolio.topSets?.length > 0 || portfolio.topCards?.length > 0) && (
                <div className="grid grid-cols-2 gap-4 mt-4 pt-4 border-t border-cv-border/20">
                  {portfolio.topSets?.length > 0 && (
                    <div>
                      <h4 className="text-[0.75rem] text-cv-muted uppercase tracking-wider mb-2 font-semibold">Top Sets</h4>
                      {portfolio.topSets.map((s, i) => (
                        <div key={s.id} className="flex justify-between items-center py-1 text-sm">
                          <span className="text-cv-text truncate mr-2">
                            <span className="text-cv-muted font-mono text-[0.7rem] mr-1.5">{i + 1}</span>
                            {s.year} {s.name}
                          </span>
                          <span className="text-cv-gold font-mono text-[0.85rem] shrink-0">{fmtDollar(s.proportional_value)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {portfolio.topCards?.length > 0 && (
                    <div>
                      <h4 className="text-[0.75rem] text-cv-muted uppercase tracking-wider mb-2 font-semibold">Top Cards</h4>
                      {portfolio.topCards.map((c, i) => (
                        <div key={c.id} className="flex justify-between items-center py-1 text-sm">
                          <span className="text-cv-text truncate mr-2">
                            <span className="text-cv-muted font-mono text-[0.7rem] mr-1.5">{i + 1}</span>
                            #{c.card_number} {c.player}
                          </span>
                          <span className="text-cv-gold font-mono text-[0.85rem] shrink-0">{fmtDollar(c.median_price)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </Panel>
          )}

          {/* Set Progress */}
          {(completedSets.length > 0 || activeSets.length > 0) && (
            <Panel>
              <SectionHeader icon={Target} right={
                <Link to="/sets" className="text-[0.75rem] text-cv-accent hover:text-cv-accent/80 transition-colors flex items-center gap-1">
                  All Sets <ArrowUpRight size={12} />
                </Link>
              }>
                Set Progress
              </SectionHeader>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Completed */}
                {completedSets.length > 0 && (
                  <div>
                    <h4 className="text-[0.75rem] text-cv-gold uppercase tracking-wider mb-2 font-semibold flex items-center gap-1.5">
                      <Trophy size={12} /> Completed ({completedSets.length})
                    </h4>
                    <div className="space-y-1">
                      {completedSets.map(s => (
                        <Link key={s.id} to={`/sets/${s.id}`} className="flex justify-between items-center py-1.5 text-sm hover:bg-white/[0.03] rounded px-2 -mx-2 transition-colors">
                          <span className="text-cv-text truncate">{s.year} {s.name}</span>
                          <span className="text-cv-gold font-mono text-[0.8rem] shrink-0">{s.owned_count}/{s.total_cards}</span>
                        </Link>
                      ))}
                    </div>
                  </div>
                )}

                {/* In Progress */}
                {activeSets.length > 0 && (
                  <div>
                    <h4 className="text-[0.75rem] text-cv-accent uppercase tracking-wider mb-2 font-semibold flex items-center gap-1.5">
                      <Activity size={12} /> In Progress ({activeSets.length})
                    </h4>
                    <div className="space-y-2">
                      {activeSets.slice(0, 6).map(s => {
                        const pct = Math.round((s.owned_count / s.total_cards) * 100);
                        return (
                          <Link key={s.id} to={`/sets/${s.id}`} className="block hover:bg-white/[0.03] rounded px-2 py-1 -mx-2 transition-colors">
                            <div className="flex justify-between items-center text-sm mb-1">
                              <span className="text-cv-text truncate">{s.year} {s.name}</span>
                              <span className="text-cv-muted font-mono text-[0.75rem] shrink-0 ml-2">
                                {s.owned_count}/{s.total_cards} <span className="text-cv-accent">{pct}%</span>
                              </span>
                            </div>
                            <div className="w-full h-1 bg-cv-border/50 rounded-full overflow-hidden">
                              <div className="h-full bg-gradient-to-r from-cv-accent to-cv-gold rounded-full transition-all duration-500" style={{ width: `${pct}%` }} />
                            </div>
                          </Link>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </Panel>
          )}
        </div>

        {/* ── Right Column ── */}
        <div className="space-y-4">

          {/* Quick Voice Entry */}
          <Panel className="relative overflow-hidden">
            <div className="absolute -top-10 -right-10 w-28 h-28 bg-cv-accent/5 rounded-full blur-2xl pointer-events-none" />
            <SectionHeader icon={Mic}>Quick Voice</SectionHeader>
            {sets.length > 0 ? (
              <div className="space-y-2.5 relative">
                <select
                  value={selectedSet}
                  onChange={e => setSelectedSet(e.target.value)}
                  className="w-full bg-cv-dark border border-cv-border rounded-lg px-3 py-2.5 text-sm text-cv-text focus:border-cv-accent focus:outline-none"
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
                  className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold bg-gradient-to-r from-cv-accent to-cv-accent2 text-white hover:shadow-lg hover:shadow-cv-accent/25 transition-all"
                >
                  <Mic size={16} /> Start Recording
                </button>
              </div>
            ) : (
              <Link to="/sets/add"
                className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold bg-cv-gold/15 border border-cv-gold/30 text-cv-gold hover:bg-cv-gold/25 transition-all w-full">
                <Plus size={16} /> Add a Set to Begin
              </Link>
            )}
          </Panel>

          {/* Price Movers */}
          {priceChanges.length > 0 && (
            <Panel>
              <SectionHeader icon={TrendingUp}>Price Movers</SectionHeader>
              <div className="space-y-1.5">
                {priceChanges.slice(0, 6).map(c => {
                  const diff = c.current_price - c.previous_price;
                  const pct = ((diff / c.previous_price) * 100).toFixed(1);
                  const up = diff > 0;
                  return (
                    <div key={c.id} className="flex justify-between items-center py-1.5 text-sm border-b border-cv-border/15 last:border-0">
                      <div className="truncate mr-2">
                        <span className="text-cv-text">#{c.card_number} {c.player}</span>
                        <span className="text-cv-muted text-[0.75rem] block">{c.set_year} {c.set_name}</span>
                      </div>
                      <div className={`font-mono text-[0.8rem] shrink-0 flex items-center gap-1 ${up ? 'text-cv-gold' : 'text-red-400'}`}>
                        {up ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                        {up ? '+' : ''}{pct}%
                      </div>
                    </div>
                  );
                })}
              </div>
            </Panel>
          )}

          {/* Recently Added */}
          {recentSets.length > 0 && (
            <Panel>
              <SectionHeader icon={Database}>Recently Added</SectionHeader>
              <div className="space-y-1">
                {recentSets.map(set => (
                  <Link
                    key={set.id}
                    to={`/sets/${set.id}`}
                    className="flex items-center justify-between py-2 hover:bg-white/[0.03] rounded px-2 -mx-2 transition-colors group"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-8 h-8 rounded-md bg-cv-accent/10 flex items-center justify-center text-cv-accent font-mono text-[0.7rem] font-bold shrink-0">
                        {set.year ? String(set.year).slice(-2) : '\u2014'}
                      </div>
                      <div className="min-w-0">
                        <p className="text-cv-text text-sm font-medium truncate group-hover:text-cv-accent transition-colors">
                          {set.name}
                        </p>
                        <p className="text-cv-muted text-[0.75rem]">
                          {set.total_cards} cards · {set.owned_count} owned
                        </p>
                      </div>
                    </div>
                    <ChevronRight size={14} className="text-cv-muted group-hover:text-cv-accent transition-colors shrink-0" />
                  </Link>
                ))}
              </div>
            </Panel>
          )}
        </div>
      </div>

      {/* ═══ BOTTOM ROW ═══ */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">

        {/* Recent Sessions */}
        {recentSessions.length > 0 && (
          <Panel className="overflow-hidden">
            <SectionHeader icon={Clock}>Recent Sessions</SectionHeader>
            <div className="-mx-5 -mb-5">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-cv-border/30">
                    <th className="text-left px-5 py-2.5 text-[0.7rem] text-cv-muted uppercase tracking-wider font-semibold">Date</th>
                    <th className="text-left px-3 py-2.5 text-[0.7rem] text-cv-muted uppercase tracking-wider font-semibold">Set</th>
                    <th className="text-center px-3 py-2.5 text-[0.7rem] text-cv-muted uppercase tracking-wider font-semibold">Cards</th>
                    <th className="text-center px-3 py-2.5 text-[0.7rem] text-cv-muted uppercase tracking-wider font-semibold">Speed</th>
                    <th className="text-center px-5 py-2.5 text-[0.7rem] text-cv-muted uppercase tracking-wider font-semibold">Acc.</th>
                  </tr>
                </thead>
                <tbody>
                  {recentSessions.slice(0, 5).map(session => (
                    <tr key={session.id} className="border-b border-cv-border/15 hover:bg-white/[0.02] transition-colors">
                      <td className="px-5 py-2.5 text-cv-muted text-[0.85rem]">
                        {fmtDate(session.timestamp)}
                      </td>
                      <td className="px-3 py-2.5 text-cv-text font-medium text-[0.85rem] truncate max-w-[150px]">
                        {session.set_name || 'Unknown'}
                      </td>
                      <td className="px-3 py-2.5 text-center text-cv-accent font-mono font-semibold text-[0.85rem]">
                        {session.total_cards}
                      </td>
                      <td className="px-3 py-2.5 text-center text-cv-text font-mono text-[0.85rem]">
                        {session.cards_per_min}/m
                      </td>
                      <td className="px-5 py-2.5 text-center">
                        <span className={`inline-block px-2 py-0.5 rounded-full text-[0.75rem] font-mono font-bold ${
                          session.accuracy_pct >= 90 ? 'bg-cv-accent/15 text-cv-accent' :
                          session.accuracy_pct >= 70 ? 'bg-cv-gold/15 text-cv-gold' : 'bg-red-500/15 text-red-400'
                        }`}>
                          {session.accuracy_pct}%
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        )}

        {/* What's New */}
        {releases.length > 0 && (
          <Panel>
            <SectionHeader icon={Zap} right={
              appVersion && <span className="text-[0.7rem] font-mono text-cv-muted">v{appVersion}</span>
            }>
              What's New
            </SectionHeader>
            <div className="space-y-3">
              {releases.slice(0, 2).map(release => (
                <div key={release.id} className="pb-3 border-b border-cv-border/15 last:border-0 last:pb-0">
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="text-cv-gold font-mono text-[0.8rem] font-bold">{release.tag_name}</span>
                    <span className="text-cv-muted text-[0.7rem]">
                      {fmtDateLong(release.published_at)}
                    </span>
                  </div>
                  <p className="text-cv-text text-[0.85rem] leading-relaxed whitespace-pre-wrap">
                    {(release.body || 'No release notes.').slice(0, 200)}
                    {(release.body || '').length > 200 ? '...' : ''}
                  </p>
                </div>
              ))}
            </div>
          </Panel>
        )}
      </div>
    </div>
  );
}
