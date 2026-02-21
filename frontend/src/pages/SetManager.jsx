import React, { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Trash2, Upload, Mic, ExternalLink, Database, Loader2, ChevronDown, ChevronRight, LayoutGrid, List, MoreHorizontal } from 'lucide-react';
import axios from 'axios';

const API = import.meta.env.VITE_API_URL || 'http://localhost:8000';

export default function SetManager() {
  const [sets, setSets] = useState([]);
  const [importing, setImporting] = useState(false);
  const [migrating, setMigrating] = useState(false);
  const [collapsedYears, setCollapsedYears] = useState(null);
  const [viewMode, setViewMode] = useState('grid');
  const [showMoreMenu, setShowMoreMenu] = useState(false);

  useEffect(() => {
    loadSets();

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

  // Group sets by year, sorted descending
  const grouped = useMemo(() => {
    const map = {};
    sets.forEach(s => {
      const yr = s.year || 'Other';
      if (!map[yr]) map[yr] = [];
      map[yr].push(s);
    });
    // Sort years descending, "Other" last
    return Object.entries(map).sort((a, b) => {
      if (a[0] === 'Other') return 1;
      if (b[0] === 'Other') return -1;
      return Number(b[0]) - Number(a[0]);
    });
  }, [sets]);

  // Default all years to expanded on first load
  useEffect(() => {
    if (grouped.length > 0 && collapsedYears === null) {
      const all = {};
      grouped.forEach(([yr]) => { all[yr] = false; });
      setCollapsedYears(all);
    }
  }, [grouped, collapsedYears]);

  const toggleYear = (yr) => {
    setCollapsedYears(prev => ({ ...prev, [yr]: !prev[yr] }));
  };

  // Totals
  const totalCards = sets.reduce((a, s) => a + (s.total_cards || 0), 0);
  const totalOwned = sets.reduce((a, s) => a + (s.owned_count || 0), 0);

  return (
    <div className="w-full">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-display font-bold text-cv-text">My Sets</h2>
          <p className="text-sm text-cv-muted mt-1">
            {sets.length} set{sets.length !== 1 ? 's' : ''} · {totalCards.toLocaleString()} cards · {totalOwned.toLocaleString()} owned
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
          <div className="flex items-center bg-cv-panel border border-cv-border/50 rounded-lg overflow-hidden mr-1">
            <button
              onClick={() => setViewMode('grid')}
              className={`p-2 transition-colors ${viewMode === 'grid' ? 'bg-cv-accent/15 text-cv-accent' : 'text-cv-muted hover:text-cv-text'}`}
              title="Grid view"
            >
              <LayoutGrid size={16} />
            </button>
            <button
              onClick={() => setViewMode('list')}
              className={`p-2 transition-colors ${viewMode === 'list' ? 'bg-cv-accent/15 text-cv-accent' : 'text-cv-muted hover:text-cv-text'}`}
              title="List view"
            >
              <List size={16} />
            </button>
          </div>
          {/* Show prominent CardVision button only when no sets exist */}
          {sets.length === 0 && (
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
          {/* More menu with re-import option when sets exist */}
          {sets.length > 0 && (
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

      {/* Sets by Year */}
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
        <div className="space-y-6">
          {grouped.map(([year, yearSets]) => {
            const collapsed = collapsedYears ? !!collapsedYears[year] : false;
            const yearCards = yearSets.reduce((a, s) => a + (s.total_cards || 0), 0);
            const yearOwned = yearSets.reduce((a, s) => a + (s.owned_count || 0), 0);
            const pct = yearCards > 0 ? Math.round((yearOwned / yearCards) * 100) : 0;
            return (
              <div key={year}>
                {/* Year Header */}
                <button onClick={() => toggleYear(year)}
                  className="w-full mb-3 group text-left bg-cv-panel/60 rounded-xl border border-cv-border/30 px-4 py-3 hover:border-cv-accent/30 transition-all">
                  <div className="flex items-center gap-3">
                    {collapsed
                      ? <ChevronRight size={18} className="text-cv-muted group-hover:text-cv-accent transition-colors shrink-0" />
                      : <ChevronDown size={18} className="text-cv-muted group-hover:text-cv-accent transition-colors shrink-0" />
                    }
                    <span className="text-xl font-bold text-cv-text group-hover:text-cv-accent transition-colors">{year}</span>
                    <span className="text-xs text-cv-muted">
                      {yearSets.length} set{yearSets.length !== 1 ? 's' : ''} · {yearCards.toLocaleString()} cards · {yearOwned.toLocaleString()} owned
                    </span>
                    <div className="ml-auto flex items-center gap-2.5">
                      <div className="w-48 h-1.5 bg-cv-border/50 rounded-full overflow-hidden">
                        <div className="h-full bg-gradient-to-r from-cv-accent to-cv-gold rounded-full" style={{ width: `${pct}%` }} />
                      </div>
                      <span className="text-xs font-mono text-cv-accent">{pct}%</span>
                    </div>
                  </div>
                </button>

                {/* Year Sets Grid */}
                {!collapsed && viewMode === 'grid' && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                    {yearSets.map(s => {
                      const ownPct = s.total_cards > 0 ? Math.round(((s.owned_count || 0) / s.total_cards) * 100) : 0;
                      return (
                        <div key={s.id}
                          className="group bg-cv-panel rounded-xl border border-cv-border/70 p-4 hover:border-cv-accent/40 glow-burgundy transition-all duration-200 flex flex-col relative overflow-hidden">
                          {/* Subtle top accent line */}
                          <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-transparent via-cv-accent/40 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />

                          <div className="flex-1">
                            <div className="flex items-start justify-between">
                              <Link to={`/sets/${s.id}`} className="text-cv-text font-semibold hover:text-cv-accent transition-colors leading-tight">
                                {s.name}
                              </Link>
                              {s.brand && (
                                <span className="text-xs px-2 py-0.5 rounded-full bg-cv-accent2/10 text-cv-accent2 border border-cv-accent2/20 ml-2 shrink-0">
                                  {s.brand}
                                </span>
                              )}
                            </div>

                            {/* Stats Row */}
                            <div className="mt-3 flex items-center gap-4 text-xs">
                              <div>
                                <span className="text-cv-text font-mono font-bold text-base">{s.total_cards}</span>
                                <span className="text-cv-muted ml-1">cards</span>
                              </div>
                              {s.section_count > 0 && (
                                <div>
                                  <span className="text-cv-accent2 font-mono font-bold text-base">{s.section_count}</span>
                                  <span className="text-cv-muted ml-1">sections</span>
                                </div>
                              )}
                            </div>

                            {/* Owned Progress */}
                            {s.total_cards > 0 && (
                              <div className="mt-3">
                                <div className="flex items-center justify-between text-xs mb-1">
                                  <span className="text-cv-muted">
                                    <span className="text-cv-accent font-semibold">{s.owned_count || 0}</span>/{s.total_cards} owned
                                  </span>
                                  <span className="font-mono text-cv-accent font-bold">{ownPct}%</span>
                                </div>
                                <div className="progress-bar">
                                  <div className="progress-bar-fill" style={{ width: `${ownPct}%` }} />
                                </div>
                                {(s.total_qty > 0) && (
                                  <div className="text-xs text-cv-muted mt-1">
                                    <span className="text-cv-gold font-semibold font-mono">{s.total_qty}</span> total qty
                                  </div>
                                )}
                              </div>
                            )}
                          </div>

                          {/* Action Buttons */}
                          <div className="flex items-center justify-between mt-3 pt-3 border-t border-cv-border/50">
                            <div className="flex items-center gap-2">
                              <Link to={`/voice/${s.id}`}
                                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs bg-cv-accent/10 text-cv-accent hover:bg-cv-accent/20 transition-all font-medium">
                                <Mic size={12} /> Voice
                              </Link>
                              <Link to={`/sets/${s.id}`}
                                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs bg-white/5 border border-cv-border/50 text-cv-text hover:bg-white/10 transition-all">
                                <ExternalLink size={12} /> View
                              </Link>
                            </div>
                            <button onClick={() => deleteSet(s.id, s.name)}
                              className="p-1.5 rounded-lg text-cv-muted/40 hover:text-cv-red hover:bg-cv-red/10 transition-all">
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {!collapsed && viewMode === 'list' && (
                  <div className="bg-cv-panel rounded-xl border border-cv-border/50 overflow-hidden">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-cv-border/30">
                          <th className="text-left py-2.5 px-4 text-xs text-cv-muted uppercase font-semibold">Name</th>
                          <th className="text-left py-2.5 px-3 text-xs text-cv-muted uppercase font-semibold w-20">Brand</th>
                          <th className="text-center py-2.5 px-3 text-xs text-cv-muted uppercase font-semibold w-20">Cards</th>
                          <th className="text-left py-2.5 px-3 text-xs text-cv-muted uppercase font-semibold w-44">Progress</th>
                          <th className="text-center py-2.5 px-3 text-xs text-cv-muted uppercase font-semibold w-24">Owned</th>
                          <th className="w-24"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {yearSets.map(s => {
                          const ownPct = s.total_cards > 0 ? Math.round(((s.owned_count || 0) / s.total_cards) * 100) : 0;
                          return (
                            <tr key={s.id} className="group border-b border-cv-border/20 hover:bg-white/[0.03] transition-colors">
                              <td className="py-2.5 px-4">
                                <Link to={`/sets/${s.id}`} className="text-cv-text font-semibold hover:text-cv-accent transition-colors">
                                  {s.name}
                                </Link>
                              </td>
                              <td className="py-2.5 px-3">
                                {s.brand && (
                                  <span className="text-xs px-2 py-0.5 rounded-full bg-cv-accent2/10 text-cv-accent2 border border-cv-accent2/20">
                                    {s.brand}
                                  </span>
                                )}
                              </td>
                              <td className="py-2.5 px-3 text-center text-cv-muted font-mono">{s.total_cards}</td>
                              <td className="py-2.5 px-3">
                                <div className="flex items-center gap-2">
                                  <div className="flex-1 h-1.5 bg-cv-border/50 rounded-full overflow-hidden">
                                    <div className="h-full bg-gradient-to-r from-cv-accent to-cv-gold rounded-full" style={{ width: `${ownPct}%` }} />
                                  </div>
                                  <span className="text-xs font-mono text-cv-accent w-8 text-right">{ownPct}%</span>
                                </div>
                              </td>
                              <td className="py-2.5 px-3 text-center text-cv-muted font-mono">{s.owned_count || 0}/{s.total_cards}</td>
                              <td className="py-2.5 px-3">
                                <div className="flex items-center gap-1 justify-end">
                                  <Link to={`/voice/${s.id}`} className="p-1.5 rounded-lg text-cv-accent hover:bg-cv-accent/10 transition-all" title="Voice entry">
                                    <Mic size={14} />
                                  </Link>
                                  <Link to={`/sets/${s.id}`} className="p-1.5 rounded-lg text-cv-text hover:bg-white/10 transition-all" title="View set">
                                    <ExternalLink size={14} />
                                  </Link>
                                  <button onClick={() => deleteSet(s.id, s.name)}
                                    className="p-1.5 rounded-lg text-cv-muted/50 hover:text-cv-red hover:bg-cv-red/10 transition-all" title="Delete">
                                    <Trash2 size={14} />
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
