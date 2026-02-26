import React, { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Trash2, Upload, Mic, ExternalLink, Database, Loader2, ChevronDown, ChevronRight, MoreHorizontal } from 'lucide-react';
import axios from 'axios';

const API = import.meta.env.VITE_API_URL || 'http://localhost:8000';

export default function SetManager() {
  const [sets, setSets] = useState([]);
  const [importing, setImporting] = useState(false);
  const [migrating, setMigrating] = useState(false);
  const [collapsedYears, setCollapsedYears] = useState(null);
  const [showEmpty, setShowEmpty] = useState(false);
  const [expandedSets, setExpandedSets] = useState({});
  const [activeMenu, setActiveMenu] = useState(null);
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [hasCardVision, setHasCardVision] = useState(false);

  useEffect(() => {
    loadSets();
    axios.get(`${API}/api/cardvision-status`).then(r => setHasCardVision(r.data.exists)).catch(() => {});

    // Listen for Electron menu actions
    const handleImportCSV = () => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.csv,.txt';
      input.onchange = handleFileImport;
      input.click();
    };
    const handleImportCV = () => migrateFromCardVision();

    window.addEventListener('menu-import-csv', handleImportCSV);
    window.addEventListener('menu-import-cardvision', handleImportCV);
    return () => {
      window.removeEventListener('menu-import-csv', handleImportCSV);
      window.removeEventListener('menu-import-cardvision', handleImportCV);
    };
  }, []);

  // Persist collapsedYears to localStorage
  useEffect(() => {
    const saved = localStorage.getItem('cv-collapsed-years');
    if (saved) try { setCollapsedYears(JSON.parse(saved)); } catch {}
  }, []);
  useEffect(() => {
    if (collapsedYears) localStorage.setItem('cv-collapsed-years', JSON.stringify(collapsedYears));
  }, [collapsedYears]);

  // Close overflow menu on outside click
  useEffect(() => {
    if (!activeMenu) return;
    const handler = () => setActiveMenu(null);
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, [activeMenu]);

  const loadSets = () => {
    axios.get(`${API}/api/sets`).then(r => setSets(r.data)).catch(console.error);
  };

  const deleteSet = async (id, name) => {
    if (!window.confirm(`Delete "${name}" and all its cards?`)) return;
    try {
      await axios.delete(`${API}/api/sets/${id}`);
      loadSets();
    } catch (err) {
      alert('Delete failed');
    }
  };

  const handleFileImport = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setImporting(true);

    try {
      const text = await file.text();
      const lines = text.split('\n').filter(l => l.trim());
      const headers = lines[0].split(',').map(h => h.trim().toLowerCase());

      const setName = file.name.replace(/\.(csv|txt)$/i, '');
      const res = await axios.post(`${API}/api/sets`, {
        name: setName, year: null, brand: '', sport: 'Baseball'
      });
      const setId = res.data.id;

      const cards = lines.slice(1).map(line => {
        const cols = line.split(',').map(c => c.trim());
        return {
          card_number: cols[headers.indexOf('card #')] || cols[0] || '',
          player: cols[headers.indexOf('player')] || cols[1] || '',
          team: cols[headers.indexOf('team')] || cols[2] || '',
          rc_sp: cols[headers.indexOf('rc/sp')] || cols[3] || '',
          insert_type: cols[headers.indexOf('insert type')] || cols[4] || 'Base',
          parallel: cols[headers.indexOf('parallel')] || cols[5] || '',
          qty: parseInt(cols[headers.indexOf('qty')] || cols[6]) || 0,
        };
      }).filter(c => c.card_number && c.player);

      if (cards.length > 0) {
        await axios.post(`${API}/api/sets/${setId}/cards`, { cards });
      }

      loadSets();
      alert(`Imported ${cards.length} cards into "${setName}"`);
    } catch (err) {
      alert('Import failed: ' + (err.message || 'Unknown error'));
    }
    setImporting(false);
    e.target.value = '';
  };

  const migrateFromCardVision = async () => {
    if (!window.confirm('Import sets, checklists & owned cards from CardVision (CNNSCAN)?\n\nThis will:\n1. Remove old empty migration data\n2. Import all sets & checklists from CardVision\n3. Import your owned card quantities\n\nA backup is created automatically.')) return;
    setMigrating(true);
    try {
      const res = await axios.post(`${API}/api/migrate-from-cardvision`);
      const d = res.data;
      const parts = [];
      if (d.cleaned.sets > 0) {
        parts.push(`Cleaned up: ${d.cleaned.sets} old sets (${d.cleaned.cards} cards)`);
      }
      if (d.imported.sets > 0) {
        parts.push(`Imported: ${d.imported.sets} sets, ${d.imported.cards} checklist cards`);
      }
      if (d.imported.sections > 0) {
        parts.push(`Sections: ${d.imported.sections} insert types, ${d.imported.parallels} parallels`);
      }
      if (d.imported.owned > 0) {
        parts.push(`Owned cards: ${d.imported.owned} cards with quantities`);
      }
      if (d.skipped.length > 0) {
        parts.push(`Skipped (already exist): ${d.skipped.slice(0, 5).join(', ')}${d.skipped.length > 5 ? ` +${d.skipped.length - 5} more` : ''}`);
      }
      if (parts.length === 0) {
        alert('No new data to import — all sets already exist in CardVoice.');
      } else {
        alert('Migration complete!\n\n' + parts.join('\n'));
      }
      loadSets();
    } catch (err) {
      alert('Migration failed: ' + (err.response?.data?.detail || err.message));
    }
    setMigrating(false);
  };

  // Group sets into Year > Brand > Set tree
  const grouped = useMemo(() => {
    const visible = showEmpty ? sets : sets.filter(s => s.total_cards > 0 || s.owned_count > 0);
    const tree = {};
    visible.forEach(s => {
      const yr = s.year || 'Other';
      const br = s.brand || 'Unknown';
      if (!tree[yr]) tree[yr] = {};
      if (!tree[yr][br]) tree[yr][br] = [];
      tree[yr][br].push(s);
    });
    return Object.entries(tree)
      .sort((a, b) => {
        if (a[0] === 'Other') return 1;
        if (b[0] === 'Other') return -1;
        return Number(b[0]) - Number(a[0]);
      })
      .map(([yr, brands]) => ({
        year: yr,
        brands: Object.entries(brands)
          .sort((a, b) => a[0].localeCompare(b[0]))
          .map(([brand, sets]) => ({ brand, sets })),
      }));
  }, [sets, showEmpty]);

  // Default all years to expanded on first load
  useEffect(() => {
    if (grouped.length > 0 && collapsedYears === null) {
      const all = {};
      grouped.forEach(g => { all[g.year] = false; });
      setCollapsedYears(all);
    }
  }, [grouped, collapsedYears]);

  const toggleYear = (yr) => {
    setCollapsedYears(prev => ({ ...prev, [yr]: !prev[yr] }));
  };

  // Totals
  const totalSets = sets.length;
  const totalTracked = sets.reduce((a, s) => a + (s.tracked_total || 0), 0);
  const totalOwned = sets.reduce((a, s) => a + (s.owned_count || 0), 0);

  return (
    <div className="w-full">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-display font-bold text-cv-text">My Sets</h2>
          <p className="text-sm text-cv-muted mt-1">
            {totalSets} set{totalSets !== 1 ? 's' : ''} · {totalTracked.toLocaleString()} tracked · {totalOwned.toLocaleString()} owned
            <span className="mx-2 text-cv-border">|</span>
            <a
              href="https://github.com/JCHanratty/CardVoice/issues/new?template=set-request.yml"
              target="_blank"
              rel="noopener noreferrer"
              className="text-cv-gold hover:underline"
            >
              Request a Set
            </a>
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Show empty toggle */}
          <label className="flex items-center gap-1.5 text-xs text-cv-muted cursor-pointer select-none mr-2">
            <input
              type="checkbox"
              checked={showEmpty}
              onChange={(e) => setShowEmpty(e.target.checked)}
              className="rounded border-cv-border bg-cv-dark text-cv-accent focus:ring-cv-accent/30 w-3.5 h-3.5"
            />
            Show empty
          </label>
          {/* Show prominent CardVision button only when no sets exist and CardVision is installed */}
          {hasCardVision && sets.length === 0 && (
            <button onClick={migrateFromCardVision} disabled={migrating}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm bg-cv-gold/10 border border-cv-gold/30 text-cv-gold hover:bg-cv-gold/20 disabled:opacity-50 transition-all">
              {migrating ? <Loader2 size={14} className="animate-spin" /> : <Database size={14} />}
              {migrating ? 'Migrating...' : 'Import from CardVision'}
            </button>
          )}
          <label className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm bg-white/5 border border-cv-border text-cv-text hover:bg-white/10 cursor-pointer transition-all">
            <Upload size={14} />
            Import CSV
            <input type="file" accept=".csv,.txt" onChange={handleFileImport} className="hidden" />
          </label>
          <Link to="/sets/add"
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-gradient-to-r from-cv-accent to-cv-accent2 text-white hover:shadow-lg hover:shadow-cv-accent/20 transition-all">
            <Plus size={14} /> New Set
          </Link>
          {/* More menu with re-import option when sets exist and CardVision is installed */}
          {hasCardVision && sets.length > 0 && (
            <div className="relative">
              <button
                onClick={() => setShowMoreMenu(!showMoreMenu)}
                className="p-2 rounded-lg bg-white/5 border border-cv-border/50 text-cv-muted hover:text-cv-text hover:bg-white/10 transition-all"
                title="More actions"
              >
                <MoreHorizontal size={16} />
              </button>
              {showMoreMenu && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowMoreMenu(false)} />
                  <div className="absolute right-0 top-full mt-1 z-50 bg-cv-panel border border-cv-border/50 rounded-lg shadow-xl min-w-[200px] py-1">
                    <button
                      onClick={() => { setShowMoreMenu(false); migrateFromCardVision(); }}
                      disabled={migrating}
                      className="w-full flex items-center gap-2 px-3 py-2 text-sm text-cv-gold hover:bg-cv-gold/10 transition-all text-left disabled:opacity-50"
                    >
                      {migrating ? <Loader2 size={14} className="animate-spin" /> : <Database size={14} />}
                      {migrating ? 'Migrating...' : 'Re-import from CardVision'}
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Sets Tree */}
      {sets.length === 0 ? (
        <div className="bg-cv-panel rounded-xl border border-cv-border p-12 text-center">
          <Database size={48} className="text-cv-muted/50 mx-auto mb-4" />
          <p className="text-cv-muted text-lg">No sets yet</p>
          <p className="text-cv-muted/70 text-sm mt-1">Create a new set or import from CSV to get started</p>
          <Link to="/sets/add" className="inline-flex items-center gap-2 mt-4 px-5 py-2.5 rounded-lg text-sm font-medium bg-cv-accent text-cv-dark hover:bg-cv-accent/90 transition-all">
            <Plus size={16} /> Create Your First Set
          </Link>
        </div>
      ) : (
        <div className="space-y-4">
          {grouped.map(({ year, brands }) => {
            const collapsed = collapsedYears ? !!collapsedYears[year] : false;
            const yearSets = brands.flatMap(b => b.sets);
            const yearTracked = yearSets.reduce((a, s) => a + (s.tracked_total || 0), 0);
            const yearOwned = yearSets.reduce((a, s) => a + (s.owned_count || 0), 0);
            const pct = yearTracked > 0 ? Math.round((yearOwned / yearTracked) * 100) : 0;

            return (
              <div key={year}>
                {/* Year Header */}
                <button onClick={() => toggleYear(year)}
                  className="w-full mb-2 group text-left bg-cv-panel/60 rounded-xl border border-cv-border/30 px-4 py-3 hover:border-cv-accent/30 transition-all">
                  <div className="flex items-center gap-3">
                    {collapsed
                      ? <ChevronRight size={18} className="text-cv-muted group-hover:text-cv-accent transition-colors shrink-0" />
                      : <ChevronDown size={18} className="text-cv-muted group-hover:text-cv-accent transition-colors shrink-0" />
                    }
                    <span className="text-xl font-bold text-cv-text group-hover:text-cv-accent transition-colors">{year}</span>
                    <span className="text-xs text-cv-muted">
                      {yearSets.length} set{yearSets.length !== 1 ? 's' : ''}
                    </span>
                    <div className="ml-auto flex items-center gap-2.5">
                      <div className="w-48 h-1.5 bg-cv-border/50 rounded-full overflow-hidden">
                        <div className="h-full bg-gradient-to-r from-cv-accent to-cv-gold rounded-full transition-all" style={{ width: `${pct}%` }} />
                      </div>
                      <span className="text-xs font-mono text-cv-accent">{pct}%</span>
                      <span className="text-xs text-cv-muted font-mono">{yearOwned}/{yearTracked}</span>
                    </div>
                  </div>
                </button>

                {/* Brands within year */}
                {!collapsed && brands.map(({ brand, sets: brandSets }) => (
                  <div key={brand} className="ml-4 mb-3">
                    {/* Brand heading - only show if multiple brands in year */}
                    {brands.length > 1 && (
                      <div className="px-3 py-1.5 text-xs font-semibold text-cv-muted uppercase tracking-wider">
                        {brand}
                      </div>
                    )}

                    {/* Sets within brand */}
                    {brandSets.map(s => {
                      const setPct = s.tracked_total > 0 ? Math.round((s.owned_count / s.tracked_total) * 100) : 0;
                      const isEmpty = s.total_cards === 0 && s.owned_count === 0;
                      const isExpanded = !!expandedSets[s.id];

                      return (
                        <div key={s.id} className={`ml-2 ${isEmpty ? 'opacity-40' : ''}`}>
                          {/* Set row */}
                          <div className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-white/[0.03] transition-colors group">
                            {/* Expand chevron for tracked inserts */}
                            <button onClick={() => setExpandedSets(prev => ({ ...prev, [s.id]: !prev[s.id] }))}
                              className="text-cv-muted hover:text-cv-text transition-colors p-0.5 shrink-0">
                              {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                            </button>

                            {/* Set name */}
                            <Link to={`/sets/${s.id}`} className="flex-1 min-w-0 text-sm font-medium text-cv-text hover:text-cv-accent transition-colors truncate">
                              {s.name}
                            </Link>

                            {/* Progress bar */}
                            <div className="flex items-center gap-2 shrink-0">
                              <div className="w-32 h-1.5 bg-cv-dark/50 rounded-full overflow-hidden">
                                <div className="h-full bg-cv-accent rounded-full transition-all" style={{ width: `${setPct}%` }} />
                              </div>
                              <span className="text-xs text-cv-muted font-mono w-10 text-right">{setPct}%</span>
                              <span className="text-xs text-cv-muted font-mono w-20 text-right">{s.owned_count}/{s.tracked_total}</span>
                            </div>

                            {/* Overflow menu */}
                            <div className="relative shrink-0">
                              <button onClick={(e) => { e.stopPropagation(); setActiveMenu(activeMenu === s.id ? null : s.id); }}
                                className="p-1 rounded text-cv-muted/30 hover:text-cv-muted hover:bg-white/5 transition-all opacity-0 group-hover:opacity-100">
                                <MoreHorizontal size={14} />
                              </button>
                              {activeMenu === s.id && (
                                <div className="absolute right-0 top-full mt-1 bg-cv-panel border border-cv-border/50 rounded-lg shadow-lg z-20 py-1 w-36">
                                  <Link to={`/voice/${s.id}`} onClick={() => setActiveMenu(null)}
                                    className="flex items-center gap-2 px-3 py-1.5 text-xs text-cv-text hover:bg-white/5">
                                    <Mic size={12} /> Voice Entry
                                  </Link>
                                  <Link to={`/sets/${s.id}`} onClick={() => setActiveMenu(null)}
                                    className="flex items-center gap-2 px-3 py-1.5 text-xs text-cv-text hover:bg-white/5">
                                    <ExternalLink size={12} /> View Set
                                  </Link>
                                  <button onClick={() => { deleteSet(s.id, s.name); setActiveMenu(null); }}
                                    className="flex items-center gap-2 px-3 py-1.5 text-xs text-cv-red hover:bg-cv-red/10 w-full text-left">
                                    <Trash2 size={12} /> Delete
                                  </button>
                                </div>
                              )}
                            </div>
                          </div>

                          {/* Info line */}
                          <div className="ml-9 -mt-1 mb-1 text-[11px] text-cv-muted">
                            {s.insert_count} inserts · {s.parallel_count} parallels · {(s.total_all_cards || 0).toLocaleString()} total cards
                          </div>

                          {/* Expanded: tracked inserts */}
                          {isExpanded && (
                            <div className="ml-9 mb-2 space-y-1">
                              {(s.tracked_inserts || []).map(ti => {
                                const tiPct = ti.card_count > 0 ? Math.round((ti.owned_count / ti.card_count) * 100) : 0;
                                return (
                                  <div key={ti.id} className="flex items-center gap-2 px-3 py-1 rounded bg-white/[0.02]">
                                    <span className="text-xs text-cv-text flex-1 truncate">{ti.name}</span>
                                    <div className="w-24 h-1 bg-cv-dark/50 rounded-full overflow-hidden">
                                      <div className="h-full bg-cv-accent/60 rounded-full" style={{ width: `${tiPct}%` }} />
                                    </div>
                                    <span className="text-[11px] text-cv-muted font-mono w-8 text-right">{tiPct}%</span>
                                    <span className="text-[11px] text-cv-muted font-mono">{ti.owned_count}/{ti.card_count}</span>
                                  </div>
                                );
                              })}
                              {(s.tracked_inserts || []).length === 0 && (
                                <div className="px-3 py-1 text-xs text-cv-muted italic">No tracked inserts</div>
                              )}
                              <Link to={`/sets/${s.id}`}
                                className="block px-3 py-1 text-xs text-cv-accent hover:text-cv-accent/80 transition-colors font-medium">
                                View All Inserts &rarr;
                              </Link>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
