import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { RefreshCw, ChevronDown, ChevronRight, ArrowUpDown, TrendingUp, TrendingDown, Star } from 'lucide-react';
import axios from 'axios';
import { AreaChart, Area, ResponsiveContainer, Tooltip, XAxis, LineChart, Line } from 'recharts';

const API = import.meta.env.VITE_API_URL || 'http://localhost:8000';

export default function ValueDashboard() {
  const [portfolio, setPortfolio] = useState(null);
  const [priceChanges, setPriceChanges] = useState([]);
  const [trackedCards, setTrackedCards] = useState([]);
  const [sets, setSets] = useState([]);
  const [syncStatus, setSyncStatus] = useState(null);

  // Expandable set rows
  const [expandedSetId, setExpandedSetId] = useState(null);
  const [setValuations, setSetValuations] = useState({});
  const [setSparklines, setSetSparklines] = useState({});

  // Set table sort
  const [sortField, setSortField] = useState('value');
  const [sortDir, setSortDir] = useState('desc');

  const fetchAll = useCallback(() => {
    axios.get(`${API}/api/portfolio`).then(r => setPortfolio(r.data)).catch(() => {});
    axios.get(`${API}/api/portfolio/changes`).then(r => setPriceChanges(r.data)).catch(() => {});
    axios.get(`${API}/api/tracked-cards`).then(r => setTrackedCards(r.data)).catch(() => {});
    axios.get(`${API}/api/sets`).then(r => setSets(r.data)).catch(() => {});
    axios.get(`${API}/api/sync/status`).then(r => setSyncStatus(r.data)).catch(() => {});
  }, []);

  useEffect(() => {
    fetchAll();
    const interval = setInterval(() => {
      axios.get(`${API}/api/sync/status`).then(r => setSyncStatus(r.data)).catch(() => {});
    }, 5000);
    return () => clearInterval(interval);
  }, [fetchAll]);

  const triggerSync = () => {
    axios.post(`${API}/api/sync/trigger`).then(() => {
      axios.get(`${API}/api/sync/status`).then(r => setSyncStatus(r.data));
    });
  };

  const expandSet = async (setId) => {
    if (expandedSetId === setId) { setExpandedSetId(null); return; }
    setExpandedSetId(setId);
    if (!setValuations[setId]) {
      try {
        const [valRes, snapRes] = await Promise.all([
          axios.get(`${API}/api/sets/${setId}/valuation`),
          axios.get(`${API}/api/sets/${setId}/price-snapshots`),
        ]);
        setSetValuations(prev => ({ ...prev, [setId]: valRes.data }));
        setSetSparklines(prev => ({ ...prev, [setId]: snapRes.data }));
      } catch {}
    }
  };

  // Compute set values from portfolio data for sorting
  const setValueMap = {};
  if (portfolio) {
    for (const s of portfolio.topSets) setValueMap[s.id] = s.proportional_value;
  }

  // Filter to sets with sync_enabled or that have value
  const valueSets = sets.filter(s => s.sync_enabled || setValueMap[s.id] > 0);

  const sortedSets = [...valueSets].sort((a, b) => {
    const dir = sortDir === 'asc' ? 1 : -1;
    if (sortField === 'name') return dir * a.name.localeCompare(b.name);
    if (sortField === 'year') return dir * ((a.year || 0) - (b.year || 0));
    if (sortField === 'value') return dir * ((setValueMap[b.id] || 0) - (setValueMap[a.id] || 0));
    return 0;
  });

  const toggleSort = (field) => {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortField(field); setSortDir('desc'); }
  };

  const pricedSetsCount = portfolio ? portfolio.topSets.length : 0;

  return (
    <div className="w-full">
      {/* Header + Sync Widget */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-display font-bold text-cv-text">Value Dashboard</h1>
        {syncStatus && (
          <div className="flex items-center gap-3">
            {syncStatus.running && syncStatus.progress && (
              <div className="flex items-center gap-2">
                <div className="w-32 h-1.5 bg-cv-border/50 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-cv-accent to-cv-gold rounded-full transition-all duration-500"
                    style={{ width: `${syncStatus.progress.total > 0 ? Math.round((syncStatus.progress.current / syncStatus.progress.total) * 100) : 0}%` }}
                  />
                </div>
                <span className="text-xs text-cv-muted font-mono">{syncStatus.progress.current}/{syncStatus.progress.total}</span>
              </div>
            )}
            <span className="text-xs text-cv-muted">
              {syncStatus.lastSyncTime ? `Last: ${new Date(syncStatus.lastSyncTime).toLocaleDateString()}` : 'Never synced'}
            </span>
            <button
              onClick={triggerSync}
              disabled={syncStatus.running}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                syncStatus.running
                  ? 'bg-cv-border/50 text-cv-muted cursor-not-allowed'
                  : 'bg-cv-accent/20 hover:bg-cv-accent/30 text-cv-accent'
              }`}
            >
              <RefreshCw size={16} className={syncStatus.running ? 'animate-spin' : ''} />
              {syncStatus.running ? 'Syncing...' : 'Sync Now'}
            </button>
          </div>
        )}
      </div>

      {/* Portfolio Total + Timeline Chart */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 mb-6">
        <div className="bg-cv-panel rounded-xl p-6 border border-cv-border/50">
          <div className="text-sm text-cv-muted mb-1 uppercase tracking-wider font-semibold">Portfolio</div>
          <div className="text-4xl font-bold text-cv-gold font-mono mt-2">
            ${portfolio ? portfolio.totalValue.toFixed(2) : '0.00'}
          </div>
          <div className="text-xs text-cv-muted mt-2">{pricedSetsCount} sets priced</div>
        </div>

        {portfolio && portfolio.timeline.length > 1 && (
          <div className="bg-cv-panel rounded-xl p-5 border border-cv-border/50 lg:col-span-3">
            <div className="text-sm text-cv-muted mb-2 uppercase tracking-wider font-semibold">Value Over Time</div>
            <div className="h-36">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={portfolio.timeline}>
                  <XAxis dataKey="snapshot_date" tick={{ fontSize: 10, fill: '#78716C' }} />
                  <Tooltip
                    contentStyle={{ background: '#1E1E22', border: '1px solid #2A2A2E', borderRadius: 8 }}
                    labelStyle={{ color: '#78716C' }}
                    formatter={(val) => [`$${Number(val).toFixed(2)}`, 'Value']}
                  />
                  <Area type="monotone" dataKey="total_value" stroke="#D4A847" fill="#D4A847" fillOpacity={0.15} strokeWidth={2} dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
      </div>

      {/* Top Sets + Top Cards */}
      {portfolio && (portfolio.topSets.length > 0 || portfolio.topCards.length > 0) && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
          {portfolio.topSets.length > 0 && (
            <div className="bg-cv-panel rounded-xl p-5 border border-cv-border/50">
              <h3 className="text-sm font-semibold text-cv-muted uppercase tracking-wider mb-3">Top Sets by Value</h3>
              {portfolio.topSets.map((s, i) => (
                <Link key={s.id} to={`/sets/${s.id}`}
                  className="flex justify-between items-center py-2 text-sm border-b border-cv-border/30 last:border-0 hover:bg-white/[0.02] px-1 -mx-1 rounded transition-colors">
                  <span className="text-cv-text">
                    <span className="text-cv-muted mr-2">{i + 1}.</span>
                    {s.year} {s.name}
                  </span>
                  <span className="text-cv-gold font-mono font-semibold">${s.proportional_value.toFixed(2)}</span>
                </Link>
              ))}
            </div>
          )}

          {portfolio.topCards.length > 0 && (
            <div className="bg-cv-panel rounded-xl p-5 border border-cv-border/50">
              <h3 className="text-sm font-semibold text-cv-muted uppercase tracking-wider mb-3">Top Cards by Value</h3>
              {portfolio.topCards.map((c, i) => (
                <Link key={c.id} to={`/cards/${c.id}/prices`}
                  className="flex justify-between items-center py-2 text-sm border-b border-cv-border/30 last:border-0 hover:bg-white/[0.02] px-1 -mx-1 rounded transition-colors">
                  <span className="text-cv-text">
                    <span className="text-cv-muted mr-2">{i + 1}.</span>
                    #{c.card_number} {c.player}
                    <span className="text-cv-muted ml-1">({c.set_year} {c.set_name})</span>
                  </span>
                  <span className="text-cv-gold font-mono font-semibold">${c.median_price.toFixed(2)}</span>
                </Link>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Price Movers */}
      {priceChanges.length > 0 && (
        <div className="bg-cv-panel rounded-xl p-5 border border-cv-border/50 mb-6">
          <h3 className="text-sm font-semibold text-cv-muted uppercase tracking-wider mb-3">Price Movers</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-cv-border/30">
                  <th className="text-left py-2 px-2 text-xs text-cv-muted uppercase font-semibold">Card</th>
                  <th className="text-left py-2 px-2 text-xs text-cv-muted uppercase font-semibold">Set</th>
                  <th className="text-right py-2 px-2 text-xs text-cv-muted uppercase font-semibold">Previous</th>
                  <th className="text-right py-2 px-2 text-xs text-cv-muted uppercase font-semibold">Current</th>
                  <th className="text-right py-2 px-2 text-xs text-cv-muted uppercase font-semibold">Change</th>
                </tr>
              </thead>
              <tbody>
                {priceChanges.map(c => {
                  const diff = c.current_price - c.previous_price;
                  const pct = ((diff / c.previous_price) * 100).toFixed(1);
                  const up = diff > 0;
                  return (
                    <tr key={c.id} className="border-b border-cv-border/20 hover:bg-white/[0.02] transition-colors">
                      <td className="py-2 px-2 text-cv-text font-medium">#{c.card_number} {c.player}</td>
                      <td className="py-2 px-2 text-cv-muted">{c.set_year} {c.set_name}</td>
                      <td className="py-2 px-2 text-right text-cv-muted font-mono">${c.previous_price.toFixed(2)}</td>
                      <td className="py-2 px-2 text-right text-cv-text font-mono">${c.current_price.toFixed(2)}</td>
                      <td className={`py-2 px-2 text-right font-mono font-semibold ${up ? 'text-cv-gold' : 'text-red-400'}`}>
                        {up ? <TrendingUp size={14} className="inline mr-1" /> : <TrendingDown size={14} className="inline mr-1" />}
                        {up ? '+' : ''}{pct}%
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Set Values Table */}
      {sortedSets.length > 0 && (
        <div className="bg-cv-panel rounded-xl border border-cv-border/50 mb-6 overflow-hidden">
          <div className="px-5 py-4 border-b border-cv-border/30">
            <h3 className="text-sm font-semibold text-cv-muted uppercase tracking-wider">Set Values</h3>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-cv-border/30">
                <th className="w-8"></th>
                <SortHeader label="Set" field="name" current={sortField} dir={sortDir} onSort={toggleSort} />
                <SortHeader label="Year" field="year" current={sortField} dir={sortDir} onSort={toggleSort} align="center" />
                <th className="text-center py-2.5 px-3 text-xs text-cv-muted uppercase font-semibold">Owned</th>
                <th className="text-center py-2.5 px-3 text-xs text-cv-muted uppercase font-semibold">Trend</th>
                <SortHeader label="Value" field="value" current={sortField} dir={sortDir} onSort={toggleSort} align="right" />
              </tr>
            </thead>
            <tbody>
              {sortedSets.map(s => {
                const val = setValueMap[s.id] || 0;
                const isExpanded = expandedSetId === s.id;
                const valuation = setValuations[s.id];
                const sparkline = setSparklines[s.id];
                return (
                  <SetValueRow
                    key={s.id}
                    set={s}
                    value={val}
                    isExpanded={isExpanded}
                    valuation={valuation}
                    sparkline={sparkline}
                    onToggle={() => expandSet(s.id)}
                  />
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Tracked Cards */}
      {trackedCards.length > 0 && (
        <div className="bg-cv-panel rounded-xl border border-cv-border/50 overflow-hidden">
          <div className="px-5 py-4 border-b border-cv-border/30">
            <h3 className="text-sm font-semibold text-cv-muted uppercase tracking-wider flex items-center gap-2">
              <Star size={14} className="text-cv-gold" /> Tracked Cards
            </h3>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-cv-border/30">
                <th className="text-left py-2.5 px-4 text-xs text-cv-muted uppercase font-semibold">Card</th>
                <th className="text-left py-2.5 px-3 text-xs text-cv-muted uppercase font-semibold">Set</th>
                <th className="text-left py-2.5 px-3 text-xs text-cv-muted uppercase font-semibold">Insert / Parallel</th>
                <th className="text-right py-2.5 px-4 text-xs text-cv-muted uppercase font-semibold">Price</th>
              </tr>
            </thead>
            <tbody>
              {trackedCards.map(tc => (
                <tr key={tc.id} className="border-b border-cv-border/20 hover:bg-white/[0.02] transition-colors">
                  <td className="py-2.5 px-4">
                    <Link to={`/cards/${tc.card_id}/prices`} className="text-cv-text font-medium hover:text-cv-accent transition-colors">
                      #{tc.card_number} {tc.player}
                    </Link>
                  </td>
                  <td className="py-2.5 px-3 text-cv-muted">{tc.set_year} {tc.set_name}</td>
                  <td className="py-2.5 px-3 text-cv-muted">
                    {tc.insert_type !== 'Base' && <span className="text-cv-accent2">{tc.insert_type}</span>}
                    {tc.parallel && <span className="ml-1 text-cv-muted">/ {tc.parallel}</span>}
                    {tc.insert_type === 'Base' && !tc.parallel && <span className="text-cv-muted/50">Base</span>}
                  </td>
                  <td className="py-2.5 px-4 text-right">
                    {tc.median_price != null ? (
                      <span className="text-cv-gold font-mono font-semibold">${tc.median_price.toFixed(2)}</span>
                    ) : (
                      <span className="text-cv-muted/50 text-xs">No data</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Empty state */}
      {!portfolio && (
        <div className="bg-cv-panel rounded-xl border border-cv-border/50 p-12 text-center">
          <div className="text-cv-muted text-lg mb-2">Loading portfolio data...</div>
        </div>
      )}
      {portfolio && portfolio.totalValue === 0 && trackedCards.length === 0 && (
        <div className="bg-cv-panel rounded-xl border border-cv-border/50 p-12 text-center">
          <div className="text-cv-muted text-lg mb-2">No pricing data yet</div>
          <p className="text-cv-muted/70 text-sm">
            Enable sync for your sets in <Link to="/settings" className="text-cv-gold hover:underline">Settings</Link> and run a sync to start tracking values.
          </p>
        </div>
      )}
    </div>
  );
}

function SortHeader({ label, field, current, dir, onSort, align = 'left' }) {
  const active = current === field;
  const textAlign = align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left';
  return (
    <th
      className={`${textAlign} py-2.5 px-3 text-xs uppercase font-semibold cursor-pointer select-none transition-colors ${active ? 'text-cv-accent' : 'text-cv-muted hover:text-cv-text'}`}
      onClick={() => onSort(field)}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        <ArrowUpDown size={12} className={active ? 'opacity-100' : 'opacity-40'} />
      </span>
    </th>
  );
}

function SetValueRow({ set, value, isExpanded, valuation, sparkline, onToggle }) {
  const ownPct = set.total_cards > 0 ? Math.round(((set.owned_count || 0) / set.total_cards) * 100) : 0;

  return (
    <>
      <tr
        className={`border-b border-cv-border/20 hover:bg-white/[0.02] transition-colors cursor-pointer ${isExpanded ? 'bg-white/[0.02]' : ''}`}
        onClick={onToggle}
      >
        <td className="py-2.5 px-3 text-center">
          {isExpanded
            ? <ChevronDown size={14} className="text-cv-muted inline" />
            : <ChevronRight size={14} className="text-cv-muted inline" />}
        </td>
        <td className="py-2.5 px-3 text-cv-text font-medium">{set.name}</td>
        <td className="py-2.5 px-3 text-center text-cv-muted font-mono">{set.year || '—'}</td>
        <td className="py-2.5 px-3 text-center">
          <span className="text-cv-text font-mono">{set.owned_count || 0}</span>
          <span className="text-cv-muted">/{set.total_cards}</span>
          <span className="text-cv-accent ml-1 text-xs">{ownPct}%</span>
        </td>
        <td className="py-2.5 px-3">
          {sparkline && sparkline.length > 1 ? (
            <div className="h-6 w-20 mx-auto">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={sparkline}>
                  <Line type="monotone" dataKey="median_price" stroke="#D4A847" strokeWidth={1.5} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : isExpanded && !sparkline ? (
            <span className="text-cv-muted/50 text-xs">Loading...</span>
          ) : (
            <span className="text-cv-muted/50 text-xs block text-center">—</span>
          )}
        </td>
        <td className="py-2.5 px-3 text-right">
          {value > 0 ? (
            <span className="text-cv-gold font-mono font-semibold">${value.toFixed(2)}</span>
          ) : (
            <span className="text-cv-muted/50 text-xs">—</span>
          )}
        </td>
      </tr>
      {isExpanded && valuation && (
        <tr>
          <td colSpan={6} className="bg-cv-dark/40 border-b border-cv-border/20">
            <div className="px-6 py-3">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-cv-muted border-b border-cv-border/20">
                    <th className="text-left py-1.5 font-semibold">Insert Type</th>
                    <th className="text-center py-1.5 font-semibold">Owned/Total</th>
                    <th className="text-center py-1.5 font-semibold">Mode</th>
                    <th className="text-center py-1.5 font-semibold">Enabled</th>
                    <th className="text-right py-1.5 font-semibold">Value</th>
                  </tr>
                </thead>
                <tbody>
                  {valuation.insertTypes.map(it => (
                    <tr key={it.id || it.name} className="border-b border-cv-border/10">
                      <td className="py-1.5 text-cv-text">{it.name}</td>
                      <td className="py-1.5 text-center font-mono">
                        <span className={it.isComplete ? 'text-cv-accent' : 'text-cv-text'}>{it.ownedCount}</span>
                        <span className="text-cv-muted">/{it.cardCount}</span>
                      </td>
                      <td className="py-1.5 text-center text-cv-muted capitalize">{(it.pricingMode || 'full_set').replace('_', ' ')}</td>
                      <td className="py-1.5 text-center">
                        {it.pricingEnabled
                          ? <span className="text-cv-accent text-xs">On</span>
                          : <span className="text-cv-muted/50 text-xs">Off</span>}
                      </td>
                      <td className="py-1.5 text-right font-mono">
                        {it.value > 0 ? (
                          <span className="text-cv-gold">${it.value.toFixed(2)}</span>
                        ) : (
                          <span className="text-cv-muted/50">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-cv-border/30">
                    <td colSpan={4} className="py-1.5 text-cv-muted font-semibold">Total</td>
                    <td className="py-1.5 text-right font-mono text-cv-gold font-semibold">${valuation.totalValue.toFixed(2)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </td>
        </tr>
      )}
      {isExpanded && !valuation && (
        <tr>
          <td colSpan={6} className="bg-cv-dark/40 border-b border-cv-border/20 px-6 py-3 text-cv-muted text-xs">
            Loading valuation...
          </td>
        </tr>
      )}
    </>
  );
}
