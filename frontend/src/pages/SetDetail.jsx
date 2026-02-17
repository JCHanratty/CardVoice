import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ArrowLeft, Trash2, Pencil, Check, X, Download, Search, Upload, Mic, ChevronUp, ChevronDown } from 'lucide-react';
import axios from 'axios';
import ChecklistWizardModal from '../components/ChecklistWizardModal';
import { AreaChart, Area, ResponsiveContainer } from 'recharts';

const API = import.meta.env.VITE_API_URL || 'http://localhost:8000';

export default function SetDetail() {
  const { setId } = useParams();
  const [setData, setSetData] = useState(null);
  const [cards, setCards] = useState([]);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all'); // all, have, need
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [loading, setLoading] = useState(true);

  // Set edit state
  const [editingSet, setEditingSet] = useState(false);
  const [setInfoForm, setSetInfoForm] = useState({ name: '', year: '', brand: '' });

  // Checklist wizard state
  const [showChecklist, setShowChecklist] = useState(false);

  // Set metadata (insert types + parallels from checklist import)
  const [metadata, setMetadata] = useState({ insertTypes: [], parallels: [] });
  const [activeInsertType, setActiveInsertType] = useState('');
  const [activeParallel, setActiveParallel] = useState('');

  const [trackedCards, setTrackedCards] = useState({});
  const [setPrice, setSetPrice] = useState(null);
  const [setSnapshots, setSetSnapshots] = useState([]);
  const [expandedCardId, setExpandedCardId] = useState(null);
  const [cardPriceHistory, setCardPriceHistory] = useState([]);
  const [cardSnapshots, setCardSnapshots] = useState([]);

  const loadSet = async () => {
    try {
      const res = await axios.get(`${API}/api/sets/${setId}`);
      setSetData(res.data);
      setCards(res.data.cards || []);
    } catch (err) {
      console.error('Failed to load set:', err);
    }
    setLoading(false);
  };

  const loadMetadata = async () => {
    try {
      const res = await axios.get(`${API}/api/sets/${setId}/metadata`);
      setMetadata(res.data);
      if (res.data.insertTypes.length > 0 && !activeInsertType) {
        const base = res.data.insertTypes.find(t => t.name === 'Base' || t.name === 'Base Set' || t.name.toLowerCase().includes('base'));
        setActiveInsertType(base ? base.name : res.data.insertTypes[0].name);
      }
    } catch (_) {}
  };

  useEffect(() => {
    loadSet();
    loadMetadata();

    axios.get(`${API}/api/tracked-cards`).then(r => {
      const map = {};
      r.data.filter(tc => tc.set_id === parseInt(setId)).forEach(tc => {
        map[tc.card_id] = tc;
      });
      setTrackedCards(map);
    }).catch(() => {});

    axios.get(`${API}/api/sets/${setId}/price-snapshots`).then(r => {
      setSetSnapshots(r.data);
      if (r.data.length > 0) setSetPrice(r.data[r.data.length - 1]);
    }).catch(() => {});
  }, [setId]);

  const deleteCard = async (cardId) => {
    if (!window.confirm('Delete this card?')) return;
    try {
      await axios.delete(`${API}/api/cards/${cardId}`);
      setCards(prev => prev.filter(c => c.id !== cardId));
    } catch (err) {
      alert('Delete failed');
    }
  };

  const startEdit = (card) => {
    setEditingId(card.id);
    setEditForm({
      card_number: card.card_number,
      player: card.player || '',
      team: card.team || '',
      rc_sp: card.rc_sp || '',
      insert_type: card.insert_type || '',
      parallel: card.parallel || '',
      qty: card.qty || 0,
    });
  };

  const saveEdit = async (cardId) => {
    try {
      const res = await axios.put(`${API}/api/cards/${cardId}`, editForm);
      setCards(prev => prev.map(c => c.id === cardId ? { ...c, ...res.data } : c));
      setEditingId(null);
    } catch (err) {
      alert('Update failed');
    }
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditForm({});
  };

  const toggleTrack = async (cardId) => {
    if (trackedCards[cardId]) {
      await axios.delete(`${API}/api/cards/${cardId}/track`);
      setTrackedCards(prev => { const next = { ...prev }; delete next[cardId]; return next; });
    } else {
      const resp = await axios.post(`${API}/api/cards/${cardId}/track`);
      setTrackedCards(prev => ({ ...prev, [cardId]: resp.data }));
    }
  };

  const expandTrackedCard = async (cardId) => {
    if (expandedCardId === cardId) { setExpandedCardId(null); return; }
    setExpandedCardId(cardId);
    const [histResp, snapResp] = await Promise.all([
      axios.get(`${API}/api/cards/${cardId}/price-history`),
      axios.get(`${API}/api/cards/${cardId}/price-snapshots`),
    ]);
    setCardPriceHistory(histResp.data);
    setCardSnapshots(snapResp.data);
  };

  const updateQty = async (cardId, newQty) => {
    const qty = Math.max(0, newQty);
    try {
      await axios.put(`${API}/api/cards/${cardId}`, { qty });
      setCards(prev => prev.map(c => c.id === cardId ? { ...c, qty } : c));
    } catch (err) {
      console.error('Qty update failed:', err);
    }
  };

  const startEditSet = () => {
    setSetInfoForm({ name: setData.name, year: setData.year || '', brand: setData.brand || '' });
    setEditingSet(true);
  };

  const saveSetEdit = async () => {
    try {
      const payload = {
        name: setInfoForm.name,
        year: setInfoForm.year ? Number(setInfoForm.year) : null,
        brand: setInfoForm.brand || null,
      };
      await axios.put(`${API}/api/sets/${setId}`, payload);
      setSetData(prev => ({ ...prev, ...payload }));
      setEditingSet(false);
    } catch (err) {
      alert(err.response?.data?.detail || 'Update failed');
    }
  };

  const hasMetadata = metadata.insertTypes.length > 0;

  const cardNumSort = (cn) => {
    const m = (cn || '').match(/(\d+)/);
    return m ? parseInt(m[1], 10) : 0;
  };

  const filtered = cards.filter(c => {
    if (hasMetadata && activeInsertType) {
      if ((c.insert_type || 'Base') !== activeInsertType) return false;
    }
    if (hasMetadata && activeParallel !== undefined) {
      if ((c.parallel || '') !== activeParallel) return false;
    }
    if (filter === 'have' && (!c.qty || c.qty === 0)) return false;
    if (filter === 'need' && c.qty > 0) return false;
    if (search) {
      const s = search.toLowerCase();
      return (
        (c.card_number || '').toLowerCase().includes(s) ||
        (c.player || '').toLowerCase().includes(s) ||
        (c.team || '').toLowerCase().includes(s) ||
        (c.insert_type || '').toLowerCase().includes(s) ||
        (c.parallel || '').toLowerCase().includes(s)
      );
    }
    return true;
  }).sort((a, b) => {
    const itA = (a.insert_type || 'Base').toLowerCase();
    const itB = (b.insert_type || 'Base').toLowerCase();
    if (itA !== itB) return itA.localeCompare(itB);
    const pA = (a.parallel || '').toLowerCase();
    const pB = (b.parallel || '').toLowerCase();
    if (pA !== pB) return pA.localeCompare(pB);
    return cardNumSort(b.card_number) - cardNumSort(a.card_number);
  });

  // Stats
  const totalCards = cards.length;
  const haveCount = cards.filter(c => c.qty > 0).length;
  const totalQty = cards.reduce((s, c) => s + (c.qty || 0), 0);
  const ownPct = totalCards > 0 ? Math.round((haveCount / totalCards) * 100) : 0;

  // Group stats
  const groupStats = {};
  filtered.forEach(c => {
    const key = `${c.insert_type || 'Base'}||${c.parallel || ''}`;
    if (!groupStats[key]) groupStats[key] = { cards: 0, qty: 0, have: 0 };
    groupStats[key].cards++;
    groupStats[key].qty += (c.qty || 0);
    if (c.qty > 0) groupStats[key].have++;
  });

  // Export CSV
  const csvField = (val) => {
    const s = String(val ?? '');
    return (s.includes(',') || s.includes('"') || s.includes('\n')) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const exportCSV = () => {
    let csv = 'Card #,Player,Team,RC/SP,Insert Type,Parallel,Qty\n';
    cards.forEach(c => {
      csv += `${csvField(c.card_number)},${csvField(c.player)},${csvField(c.team)},${csvField(c.rc_sp)},${csvField(c.insert_type)},${csvField(c.parallel)},${c.qty||0}\n`;
    });
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${setData?.name || 'set'}_export.csv`;
    a.click();
  };

  if (loading) return <div className="text-cv-muted text-center py-12">Loading...</div>;
  if (!setData) return <div className="text-cv-red text-center py-12">Set not found</div>;

  return (
    <div className="w-full">
      {/* Header Card */}
      <div className="bg-gradient-hero rounded-xl border border-cv-border/50 p-5 mb-4 relative overflow-hidden">
        <div className="absolute -top-16 -right-16 w-48 h-48 bg-cv-accent/5 rounded-full blur-3xl pointer-events-none" />
        <div className="relative flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link to="/sets" className="p-2 rounded-lg bg-white/5 border border-cv-border/50 text-cv-muted hover:text-cv-accent hover:border-cv-accent/30 transition-all">
              <ArrowLeft size={18} />
            </Link>
            {editingSet ? (
              <div className="flex items-center gap-2">
                <input type="text" value={setInfoForm.name} onChange={e => setSetInfoForm({ ...setInfoForm, name: e.target.value })}
                  placeholder="Set Name" autoFocus
                  className="bg-cv-dark border border-cv-accent/50 rounded-lg px-3 py-1.5 text-sm text-cv-text font-semibold focus:outline-none w-48" />
                <input type="number" value={setInfoForm.year} onChange={e => setSetInfoForm({ ...setInfoForm, year: e.target.value })}
                  placeholder="Year"
                  className="bg-cv-dark border border-cv-accent/50 rounded-lg px-3 py-1.5 text-sm text-cv-text font-mono focus:outline-none w-20" />
                <input type="text" value={setInfoForm.brand} onChange={e => setSetInfoForm({ ...setInfoForm, brand: e.target.value })}
                  placeholder="Brand"
                  className="bg-cv-dark border border-cv-accent/50 rounded-lg px-3 py-1.5 text-sm text-cv-text focus:outline-none w-28" />
                <button onClick={saveSetEdit} className="p-1.5 rounded-lg text-cv-accent hover:bg-cv-accent/20 transition-all"><Check size={16} /></button>
                <button onClick={() => setEditingSet(false)} className="p-1.5 rounded-lg text-cv-muted hover:bg-white/10 transition-all"><X size={16} /></button>
              </div>
            ) : (
              <div>
                <div className="flex items-center gap-2">
                  {setData.year && <span className="text-cv-yellow font-mono font-semibold text-sm">{setData.year}</span>}
                  <h2 className="text-xl font-bold text-cv-text">{setData.name}</h2>
                  {setData.brand && <span className="text-xs text-cv-muted bg-white/5 border border-cv-border/30 rounded px-1.5 py-0.5">{setData.brand}</span>}
                  <button onClick={startEditSet} className="p-1 rounded text-cv-muted hover:text-cv-accent hover:bg-cv-accent/10 transition-all" title="Edit set details"><Pencil size={13} /></button>
                </div>
                <div className="flex items-center gap-3 mt-1">
                  <span className="text-xs text-cv-muted">
                    <span className="text-cv-text font-mono font-bold">{totalCards}</span> cards
                  </span>
                  <span className="text-xs text-cv-muted">
                    <span className="text-cv-accent font-mono font-bold">{haveCount}</span> owned
                  </span>
                  <span className="text-xs text-cv-muted">
                    <span className="text-cv-yellow font-mono font-bold">{totalQty}</span> qty
                  </span>
                </div>
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Link to={`/voice/${setId}`}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-cv-accent/10 text-cv-accent hover:bg-cv-accent/20 transition-all">
              <Mic size={12} /> Voice Entry
            </Link>
            <button onClick={() => setShowChecklist(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-cv-accent2/10 border border-cv-accent2/20 text-cv-accent2 hover:bg-cv-accent2/20 transition-all">
              <Upload size={12} /> Import Checklist
            </button>
            <button onClick={exportCSV}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs bg-white/5 border border-cv-border/50 text-cv-text hover:bg-white/10 transition-all">
              <Download size={12} /> Export CSV
            </button>
          </div>
        </div>

        {/* Progress Bar */}
        {totalCards > 0 && (
          <div className="relative mt-4 flex items-center gap-3">
            <div className="flex-1 progress-bar">
              <div className="progress-bar-fill" style={{ width: `${ownPct}%` }} />
            </div>
            <span className="text-xs font-mono text-cv-accent font-bold">{ownPct}%</span>
          </div>
        )}
      </div>

      {/* Set Value Panel */}
      {(setPrice || Object.keys(trackedCards).length > 0) && (
        <div className="bg-cv-panel rounded-xl border border-cv-border/50 p-5 mb-4">
          <h3 className="text-lg font-semibold text-cv-text mb-3">Estimated Value</h3>
          <div className="flex items-end gap-8">
            <div>
              <div className="text-3xl font-bold text-green-400 font-mono">
                {setPrice ? `$${setPrice.median_price.toFixed(2)}` : 'No data yet'}
              </div>
              <div className="text-xs text-cv-muted mt-1">
                {setPrice ? `Set value as of ${setPrice.snapshot_date}` : 'Sync to get pricing'}
              </div>
            </div>
            {setSnapshots.length > 1 && (
              <div className="w-48 h-12">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={setSnapshots}>
                    <Area type="monotone" dataKey="median_price" stroke="#00d4aa" fill="#00d4aa" fillOpacity={0.15} strokeWidth={2} dot={false} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>

          {Object.keys(trackedCards).length > 0 && (
            <div className="mt-4 border-t border-cv-border/50 pt-3">
              <h4 className="text-sm font-medium text-cv-muted mb-2">Tracked Cards</h4>
              {Object.values(trackedCards).map(tc => (
                <div key={tc.card_id}>
                  <div
                    onClick={() => expandTrackedCard(tc.card_id)}
                    className="flex justify-between items-center py-1 text-sm cursor-pointer hover:bg-white/[0.03] rounded px-2"
                  >
                    <span className="text-cv-text">#{tc.card_number} {tc.player} {expandedCardId === tc.card_id ? '\u25BE' : '\u25B8'}</span>
                    <span className="text-green-400 font-mono">
                      {tc.median_price != null ? `$${tc.median_price.toFixed(2)}` : 'No data'}
                    </span>
                  </div>

                  {expandedCardId === tc.card_id && (
                    <div className="bg-cv-dark/50 rounded-lg p-4 mt-1 mb-2 ml-4 border border-cv-border/30">
                      {cardSnapshots.length > 1 && (
                        <div className="h-24 mb-3">
                          <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={cardSnapshots}>
                              <Area type="monotone" dataKey="median_price" stroke="#6366f1" fill="#6366f1" fillOpacity={0.15} strokeWidth={2} dot={false} />
                            </AreaChart>
                          </ResponsiveContainer>
                        </div>
                      )}
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="text-cv-muted border-b border-cv-border/30">
                            <th className="text-left py-1">Date</th>
                            <th className="text-right py-1">Price</th>
                            <th className="text-left py-1 pl-3">Condition</th>
                            <th className="text-left py-1 pl-3">Listing</th>
                          </tr>
                        </thead>
                        <tbody>
                          {cardPriceHistory.slice(0, 20).map(ph => (
                            <tr key={ph.id} className="border-b border-cv-border/20">
                              <td className="py-1 text-cv-muted">{ph.sold_date || 'N/A'}</td>
                              <td className="py-1 text-right text-green-400 font-mono">${ph.price.toFixed(2)}</td>
                              <td className="py-1 pl-3 text-cv-muted">{ph.condition || '\u2014'}</td>
                              <td className="py-1 pl-3">
                                {ph.listing_url ? (
                                  <a href={ph.listing_url} target="_blank" rel="noopener noreferrer" className="text-cyan-400 hover:underline truncate block max-w-[200px]">
                                    {ph.listing_title || 'View'}
                                  </a>
                                ) : '\u2014'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {cardPriceHistory.length === 0 && (
                        <div className="text-cv-muted text-center py-2">No price data yet. Run a sync to fetch prices.</div>
                      )}
                      <Link to={`/cards/${tc.card_id}/prices`} className="text-xs text-cyan-400 hover:underline mt-2 inline-block">
                        View Full Price History &rarr;
                      </Link>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Search + Filter */}
      <div className="flex gap-3 mb-4">
        <div className="flex-1 relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-cv-muted" />
          <input type="text" value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search by card #, player, team, insert..."
            className="w-full bg-cv-panel border border-cv-border/50 rounded-lg pl-9 pr-4 py-2 text-sm text-cv-text placeholder:text-cv-muted/50 focus:border-cv-accent focus:outline-none transition-colors" />
        </div>
        <div className="flex gap-1">
          {['all', 'have', 'need'].map(f => (
            <button key={f} onClick={() => setFilter(f)}
              className={`px-3 py-2 rounded-lg text-xs font-medium capitalize transition-all ${
                filter === f
                  ? f === 'have' ? 'bg-cv-accent/15 text-cv-accent border border-cv-accent/25'
                  : f === 'need' ? 'bg-cv-yellow/15 text-cv-yellow border border-cv-yellow/25'
                  : 'bg-cv-accent2/15 text-cv-accent2 border border-cv-accent2/25'
                  : 'bg-white/5 border border-cv-border/50 text-cv-muted hover:text-cv-text hover:bg-white/10'
              }`}>
              {f}
            </button>
          ))}
        </div>
      </div>

      {/* Metadata Filter Dropdowns */}
      {hasMetadata && (
        <div className="flex gap-3 mb-4">
          <div>
            <label className="text-xs text-cv-muted uppercase tracking-wider font-semibold block mb-1">Insert Type</label>
            <select value={activeInsertType} onChange={e => setActiveInsertType(e.target.value)}
              className="bg-cv-panel border border-cv-border/50 rounded-lg px-3 py-2 text-sm text-cv-text focus:border-cv-accent focus:outline-none min-w-[160px]">
              {metadata.insertTypes.map(t => {
                const prefix = t.section_type && t.section_type !== 'base'
                  ? `[${t.section_type === 'autograph' ? 'A' : t.section_type === 'relic' ? 'R' : 'I'}] ` : '';
                return (
                  <option key={t.name} value={t.name}>{prefix}{t.name}{t.card_count ? ` (${t.card_count})` : ''}</option>
                );
              })}
            </select>
          </div>
          <div>
            <label className="text-xs text-cv-muted uppercase tracking-wider font-semibold block mb-1">Parallel</label>
            <select value={activeParallel} onChange={e => setActiveParallel(e.target.value)}
              className="bg-cv-panel border border-cv-border/50 rounded-lg px-3 py-2 text-sm text-cv-text focus:border-cv-accent focus:outline-none min-w-[160px]">
              <option value="">Base</option>
              {metadata.parallels.map(p => (
                <option key={p.name} value={p.name}>
                  {p.name}{p.print_run ? ` /${p.print_run}` : ''}{p.exclusive ? ` (${p.exclusive})` : ''}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

      {/* Totals Summary */}
      {filtered.length > 0 && (
        <div className="bg-cv-panel rounded-xl border border-cv-border/50 p-3 mb-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-cv-muted uppercase tracking-wider font-semibold">Totals</span>
            <span className="text-sm text-cv-text font-bold">
              {filtered.length} cards · {filtered.filter(c => c.qty > 0).length} owned · <span className="text-cv-accent">{filtered.reduce((s, c) => s + (c.qty || 0), 0)} total qty</span>
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            {Object.entries(groupStats).map(([key, stats]) => {
              const [insertType, parallel] = key.split('||');
              return (
                <div key={key} className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-cv-dark/50 border border-cv-border/30 text-xs">
                  <span className="text-cv-accent font-semibold">{insertType}</span>
                  {parallel && <><span className="text-cv-muted">/</span><span className="text-cv-yellow">{parallel}</span></>}
                  {!parallel && <span className="text-cv-muted">-- base</span>}
                  <span className="text-cv-muted">·</span>
                  <span className="text-cv-text">{stats.cards} cards</span>
                  <span className="text-cv-muted">·</span>
                  <span className="text-cv-accent font-mono font-bold">{stats.qty} qty</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Card Table */}
      <div className="bg-cv-panel rounded-xl border border-cv-border/50 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-cv-dark/50 border-b border-cv-border/50">
              <th className="text-center px-2 py-2.5 text-xs text-cv-muted uppercase tracking-wider font-semibold w-8">{'\u2605'}</th>
              <th className="text-left px-3 py-2.5 text-xs text-cv-muted uppercase tracking-wider font-semibold">Card #</th>
              <th className="text-left px-3 py-2.5 text-xs text-cv-muted uppercase tracking-wider font-semibold">Player</th>
              <th className="text-left px-3 py-2.5 text-xs text-cv-muted uppercase tracking-wider font-semibold">Team</th>
              <th className="text-left px-3 py-2.5 text-xs text-cv-muted uppercase tracking-wider font-semibold">RC/SP</th>
              <th className="text-left px-3 py-2.5 text-xs text-cv-muted uppercase tracking-wider font-semibold">Insert Type</th>
              <th className="text-left px-3 py-2.5 text-xs text-cv-muted uppercase tracking-wider font-semibold">Parallel</th>
              <th className="text-center px-3 py-2.5 text-xs text-cv-muted uppercase tracking-wider font-semibold">Qty</th>
              <th className="text-center px-3 py-2.5 text-xs text-cv-muted uppercase tracking-wider font-semibold w-20">Actions</th>
              <th className="text-right px-3 py-2.5 text-xs text-cv-muted uppercase tracking-wider font-semibold">Price</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((card, idx) => {
              const prev = idx > 0 ? filtered[idx - 1] : null;
              const next = idx < filtered.length - 1 ? filtered[idx + 1] : null;
              const newInsert = !prev || (prev.insert_type || 'Base') !== (card.insert_type || 'Base');
              const newParallel = newInsert || (prev.parallel || '') !== (card.parallel || '');
              const lastInGroup = !next
                || (next.insert_type || 'Base') !== (card.insert_type || 'Base')
                || (next.parallel || '') !== (card.parallel || '');
              const groupKey = `${card.insert_type || 'Base'}||${card.parallel || ''}`;
              const stats = groupStats[groupKey] || { cards: 0, qty: 0, have: 0 };
              const groupHeader = newParallel ? (
                <tr key={`grp-${idx}`} className="bg-cv-accent/[0.03]">
                  <td colSpan="10" className="px-3 py-1.5 text-xs font-semibold">
                    <span className="text-cv-accent">{card.insert_type || 'Base'}</span>
                    {card.parallel && <><span className="text-cv-muted mx-1.5">/</span><span className="text-cv-yellow">{card.parallel}</span></>}
                    {!card.parallel && <span className="text-cv-muted ml-1.5">-- base</span>}
                  </td>
                </tr>
              ) : null;
              const groupFooter = lastInGroup ? (
                <tr key={`sub-${idx}`} className="bg-cv-dark/30 border-b-2 border-cv-border/50">
                  <td colSpan="5" className="px-3 py-1.5 text-xs text-cv-muted text-right font-semibold">
                    Subtotal: {stats.cards} cards · {stats.have} owned
                  </td>
                  <td className="px-3 py-1.5 text-xs text-cv-accent font-mono">{card.insert_type || 'Base'}</td>
                  <td className="px-3 py-1.5 text-xs text-cv-yellow font-mono">{card.parallel || '--'}</td>
                  <td className="px-3 py-1.5 text-xs text-cv-accent font-mono text-center font-bold">{stats.qty}</td>
                  <td></td>
                  <td></td>
                </tr>
              ) : null;
              return (<React.Fragment key={card.id}>
              {groupHeader}
              <tr className={`border-b border-cv-border/30 hover:bg-white/[0.02] transition-colors ${card.qty > 0 ? '' : ''}`}>
                {editingId === card.id ? (
                  <>
                    <td></td>
                    <td className="px-2 py-1">
                      <input type="text" value={editForm.card_number} onChange={e => setEditForm({...editForm, card_number: e.target.value})}
                        className="w-full bg-cv-dark border border-cv-accent/50 rounded px-2 py-1 text-sm text-cv-text font-mono focus:outline-none" />
                    </td>
                    <td className="px-2 py-1">
                      <input type="text" value={editForm.player} onChange={e => setEditForm({...editForm, player: e.target.value})}
                        className="w-full bg-cv-dark border border-cv-accent/50 rounded px-2 py-1 text-sm text-cv-text focus:outline-none" />
                    </td>
                    <td className="px-2 py-1">
                      <input type="text" value={editForm.team} onChange={e => setEditForm({...editForm, team: e.target.value})}
                        className="w-full bg-cv-dark border border-cv-accent/50 rounded px-2 py-1 text-sm text-cv-text focus:outline-none" />
                    </td>
                    <td className="px-2 py-1">
                      <input type="text" value={editForm.rc_sp} onChange={e => setEditForm({...editForm, rc_sp: e.target.value})}
                        className="w-full bg-cv-dark border border-cv-accent/50 rounded px-2 py-1 text-sm text-cv-text focus:outline-none" />
                    </td>
                    <td className="px-2 py-1">
                      <input type="text" value={editForm.insert_type} onChange={e => setEditForm({...editForm, insert_type: e.target.value})}
                        className="w-full bg-cv-dark border border-cv-accent/50 rounded px-2 py-1 text-sm text-cv-text focus:outline-none" />
                    </td>
                    <td className="px-2 py-1">
                      <input type="text" value={editForm.parallel} onChange={e => setEditForm({...editForm, parallel: e.target.value})}
                        className="w-full bg-cv-dark border border-cv-accent/50 rounded px-2 py-1 text-sm text-cv-text focus:outline-none" />
                    </td>
                    <td className="px-2 py-1">
                      <input type="number" value={editForm.qty} onChange={e => setEditForm({...editForm, qty: parseInt(e.target.value) || 0})}
                        className="w-16 bg-cv-dark border border-cv-accent/50 rounded px-2 py-1 text-sm text-cv-text text-center focus:outline-none" />
                    </td>
                    <td className="px-2 py-1 text-center">
                      <div className="flex items-center justify-center gap-1">
                        <button onClick={() => saveEdit(card.id)} className="p-1 rounded text-cv-accent hover:bg-cv-accent/20"><Check size={14} /></button>
                        <button onClick={cancelEdit} className="p-1 rounded text-cv-muted hover:bg-white/10"><X size={14} /></button>
                      </div>
                    </td>
                    <td></td>
                  </>
                ) : (
                  <>
                    <td className="px-2 py-2 text-center">
                      <button
                        onClick={() => toggleTrack(card.id)}
                        className={`hover:scale-110 transition-transform ${trackedCards[card.id] ? 'text-yellow-400' : 'text-gray-600'}`}
                        title={trackedCards[card.id] ? 'Stop tracking price' : 'Track price on eBay'}
                      >
                        {trackedCards[card.id] ? '\u2605' : '\u2606'}
                      </button>
                    </td>
                    <td className="px-3 py-2 text-cv-text font-mono">{card.card_number}</td>
                    <td className="px-3 py-2 text-cv-text">{card.player || '-'}</td>
                    <td className="px-3 py-2 text-cv-muted">{card.team || '-'}</td>
                    <td className="px-3 py-2">
                      {card.rc_sp ? (
                        <span className="inline-block px-1.5 py-0.5 rounded text-xs bg-cv-yellow/10 text-cv-yellow border border-cv-yellow/20">{card.rc_sp}</span>
                      ) : <span className="text-cv-muted">-</span>}
                    </td>
                    <td className="px-3 py-2 text-cv-text">{card.insert_type || '-'}</td>
                    <td className="px-3 py-2">
                      {card.parallel ? (
                        <span className="text-cv-yellow">{card.parallel}</span>
                      ) : <span className="text-cv-muted">-</span>}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center justify-center gap-0.5">
                        <button onClick={() => updateQty(card.id, (card.qty || 0) - 1)}
                          disabled={(card.qty || 0) <= 0}
                          className="p-0.5 rounded text-cv-muted hover:text-cv-red hover:bg-cv-red/10 transition-all disabled:opacity-20 disabled:pointer-events-none">
                          <ChevronDown size={14} />
                        </button>
                        <span className={`font-mono font-bold min-w-[24px] text-center ${card.qty > 0 ? 'text-cv-accent' : 'text-cv-muted/40'}`}>
                          {card.qty || 0}
                        </span>
                        <button onClick={() => updateQty(card.id, (card.qty || 0) + 1)}
                          className="p-0.5 rounded text-cv-muted hover:text-cv-accent hover:bg-cv-accent/10 transition-all">
                          <ChevronUp size={14} />
                        </button>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-center">
                      <div className="flex items-center justify-center gap-1">
                        <button onClick={() => startEdit(card)} className="p-1 rounded text-cv-muted hover:text-cv-accent hover:bg-cv-accent/10 transition-all"><Pencil size={13} /></button>
                        <button onClick={() => deleteCard(card.id)} className="p-1 rounded text-cv-muted hover:text-cv-red hover:bg-cv-red/10 transition-all"><Trash2 size={13} /></button>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right text-sm">
                      {trackedCards[card.id]?.median_price != null ? (
                        <span className="text-green-400 font-mono">${trackedCards[card.id].median_price.toFixed(2)}</span>
                      ) : trackedCards[card.id] ? (
                        <span className="text-cv-muted text-xs">No data</span>
                      ) : null}
                    </td>
                  </>
                )}
              </tr>
              {groupFooter}
              </React.Fragment>);
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan="10" className="text-center py-8 text-cv-muted">
                  {cards.length === 0 ? 'No cards in this set yet' : 'No cards match your search/filter'}
                </td>
              </tr>
            )}
          </tbody>
          {filtered.length > 0 && (
            <tfoot>
              <tr className="bg-cv-dark/50 border-t-2 border-cv-accent/20">
                <td colSpan="5" className="px-3 py-2.5 text-sm text-cv-text font-bold text-right">
                  Total: {filtered.length} cards · {filtered.filter(c => c.qty > 0).length} owned · {Object.keys(groupStats).length} group{Object.keys(groupStats).length !== 1 ? 's' : ''}
                </td>
                <td colSpan="2" className="px-3 py-2.5"></td>
                <td className="px-3 py-2.5 text-center text-sm text-cv-accent font-mono font-bold">
                  {filtered.reduce((s, c) => s + (c.qty || 0), 0)}
                </td>
                <td></td>
                <td></td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      <div className="text-xs text-cv-muted mt-2 text-right">
        Showing {filtered.length} of {totalCards} cards
      </div>

      {/* Checklist Wizard Modal */}
      <ChecklistWizardModal
        open={showChecklist}
        onOpenChange={setShowChecklist}
        setId={Number(setId)}
        setName={setData?.name}
        onComplete={() => { setShowChecklist(false); loadSet(); loadMetadata(); }}
      />
    </div>
  );
}
