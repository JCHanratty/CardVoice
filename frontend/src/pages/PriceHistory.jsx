import { useState, useEffect, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import axios from 'axios';
import { AreaChart, Area, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

const API = import.meta.env.VITE_API_URL || 'http://localhost:8000';

export default function PriceHistory() {
  const { cardId } = useParams();
  const [card, setCard] = useState(null);
  const [history, setHistory] = useState([]);
  const [snapshots, setSnapshots] = useState([]);
  const [sortField, setSortField] = useState('sold_date');
  const [sortDir, setSortDir] = useState('desc');
  const [filterCondition, setFilterCondition] = useState('all');

  useEffect(() => {
    Promise.all([
      axios.get(`${API}/api/cards/${cardId}/price-history`),
      axios.get(`${API}/api/cards/${cardId}/price-snapshots`),
      axios.get(`${API}/api/cards/${cardId}/tracked`),
    ]).then(([histResp, snapResp, trackResp]) => {
      setHistory(histResp.data);
      setSnapshots(snapResp.data);
      if (trackResp.data.data) {
        setCard(trackResp.data.data);
      }
    });
  }, [cardId]);

  const conditions = useMemo(() => {
    const set = new Set(history.map(h => h.condition).filter(Boolean));
    return ['all', ...Array.from(set)];
  }, [history]);

  const filtered = useMemo(() => {
    let items = history;
    if (filterCondition !== 'all') {
      items = items.filter(h => h.condition === filterCondition);
    }
    items = [...items].sort((a, b) => {
      const aVal = a[sortField] || '';
      const bVal = b[sortField] || '';
      if (sortField === 'price') return sortDir === 'asc' ? a.price - b.price : b.price - a.price;
      return sortDir === 'asc' ? String(aVal).localeCompare(String(bVal)) : String(bVal).localeCompare(String(aVal));
    });
    return items;
  }, [history, sortField, sortDir, filterCondition]);

  const toggleSort = (field) => {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortField(field); setSortDir('desc'); }
  };

  const sortIcon = (field) => sortField === field ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '';

  return (
    <div className="max-w-5xl mx-auto">
      <h1 className="text-2xl font-bold text-cv-text mb-2">
        Price History {card && <>— #{card.card_number} {card.player}</>}
      </h1>
      {card && (
        <div className="text-sm text-cv-muted mb-6">
          {card.set_year} {card.set_name} · Query: <span className="text-cv-text">{card.search_query}</span>
        </div>
      )}

      {snapshots.length > 1 && (
        <div className="bg-cv-panel rounded-xl p-5 border border-cv-border/50 mb-6">
          <div className="text-sm text-cv-muted mb-2">Price Over Time</div>
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={snapshots}>
                <XAxis dataKey="snapshot_date" tick={{ fontSize: 10, fill: '#6b7280' }} />
                <YAxis tick={{ fontSize: 10, fill: '#6b7280' }} tickFormatter={v => `$${v}`} width={50} />
                <Tooltip
                  contentStyle={{ background: '#1a1f2e', border: '1px solid #374151', borderRadius: 8 }}
                  labelStyle={{ color: '#9ca3af' }}
                  formatter={(val) => [`$${val.toFixed(2)}`, 'Median']}
                />
                <Area type="monotone" dataKey="median_price" stroke="#6366f1" fill="#6366f1" fillOpacity={0.15} strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      <div className="flex items-center gap-4 mb-4">
        <label className="text-sm text-cv-muted">Condition:</label>
        <select
          value={filterCondition}
          onChange={e => setFilterCondition(e.target.value)}
          className="bg-cv-dark border border-cv-border/50 rounded px-2 py-1 text-sm text-cv-text"
        >
          {conditions.map(c => <option key={c} value={c}>{c === 'all' ? 'All' : c}</option>)}
        </select>
        <span className="text-xs text-cv-muted">{filtered.length} listings</span>
      </div>

      <div className="bg-cv-panel rounded-xl border border-cv-border/50 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-cv-muted border-b border-cv-border/50 bg-cv-dark/50">
              <th className="text-left px-4 py-2 cursor-pointer hover:text-cv-text" onClick={() => toggleSort('sold_date')}>
                Date{sortIcon('sold_date')}
              </th>
              <th className="text-right px-4 py-2 cursor-pointer hover:text-cv-text" onClick={() => toggleSort('price')}>
                Price{sortIcon('price')}
              </th>
              <th className="text-left px-4 py-2 cursor-pointer hover:text-cv-text" onClick={() => toggleSort('condition')}>
                Condition{sortIcon('condition')}
              </th>
              <th className="text-left px-4 py-2">Listing</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(ph => (
              <tr key={ph.id} className="border-b border-cv-border/30 hover:bg-white/[0.02]">
                <td className="px-4 py-2 text-cv-text">{ph.sold_date || 'N/A'}</td>
                <td className="px-4 py-2 text-right text-green-400 font-mono">${ph.price.toFixed(2)}</td>
                <td className="px-4 py-2 text-cv-muted">{ph.condition || '—'}</td>
                <td className="px-4 py-2">
                  {ph.listing_url ? (
                    <a href={ph.listing_url} target="_blank" rel="noopener noreferrer" className="text-cyan-400 hover:underline truncate block max-w-xs">
                      {ph.listing_title || 'View on eBay'}
                    </a>
                  ) : (
                    <span className="text-cv-muted">{ph.listing_title || '—'}</span>
                  )}
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={4} className="text-center text-cv-muted py-8">No price data yet. Run a sync to fetch prices.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
