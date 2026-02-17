import { useState, useEffect } from 'react';
import axios from 'axios';
import { Settings as SettingsIcon, RefreshCw, Clock, ToggleLeft, ToggleRight } from 'lucide-react';

const API = import.meta.env.VITE_API_URL || 'http://localhost:8000';

export default function Settings() {
  const [status, setStatus] = useState(null);
  const [intervalHours, setIntervalHours] = useState(24);
  const [trackedCards, setTrackedCards] = useState([]);
  const [editingQuery, setEditingQuery] = useState(null);
  const [queryText, setQueryText] = useState('');

  const fetchStatus = () => {
    axios.get(`${API}/api/sync/status`).then(r => {
      setStatus(r.data);
      setIntervalHours(Math.round(r.data.intervalMs / 3600000));
    }).catch(() => {});
  };

  useEffect(() => {
    fetchStatus();
    axios.get(`${API}/api/tracked-cards`).then(r => setTrackedCards(r.data)).catch(() => {});
    const interval = setInterval(fetchStatus, 5000);
    return () => clearInterval(interval);
  }, []);

  const triggerSync = () => {
    axios.post(`${API}/api/sync/trigger`).then(fetchStatus);
  };

  const toggleEnabled = () => {
    axios.put(`${API}/api/sync/settings`, { enabled: !status.enabled }).then(r => setStatus(r.data));
  };

  const updateInterval = () => {
    axios.put(`${API}/api/sync/settings`, { intervalHours }).then(r => setStatus(r.data));
  };

  const saveQuery = (tcId) => {
    axios.put(`${API}/api/tracked-cards/${tcId}`, { search_query: queryText }).then(() => {
      setEditingQuery(null);
      axios.get(`${API}/api/tracked-cards`).then(r => setTrackedCards(r.data));
    });
  };

  if (!status) return <div className="text-cv-muted p-8">Loading...</div>;

  return (
    <div className="max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold text-cv-text mb-6 flex items-center gap-2">
        <SettingsIcon size={24} /> Settings
      </h1>

      {/* Sync Controls */}
      <div className="bg-cv-panel rounded-xl p-5 border border-cv-border/50 mb-6">
        <h2 className="text-lg font-semibold text-cv-text mb-4">Price Sync</h2>

        <div className="flex items-center justify-between mb-4">
          <div>
            <div className="text-sm text-cv-text">Auto-Sync</div>
            <div className="text-xs text-cv-muted">Automatically fetch prices on a schedule</div>
          </div>
          <button onClick={toggleEnabled} className="text-2xl">
            {status.enabled ? <ToggleRight className="text-cv-accent" size={32} /> : <ToggleLeft className="text-cv-muted" size={32} />}
          </button>
        </div>

        <div className="flex items-center gap-3 mb-4">
          <label className="text-sm text-cv-text">Sync every</label>
          <input
            type="number"
            value={intervalHours}
            onChange={e => setIntervalHours(parseInt(e.target.value) || 24)}
            className="w-20 bg-cv-dark border border-cv-border/50 rounded px-2 py-1 text-sm text-cv-text"
            min={1}
          />
          <span className="text-sm text-cv-muted">hours</span>
          <button onClick={updateInterval} className="text-xs bg-cv-border/50 hover:bg-cv-border text-cv-text px-3 py-1 rounded">
            Save
          </button>
        </div>

        <div className="flex items-center gap-4">
          <button
            onClick={triggerSync}
            disabled={status.running}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium ${
              status.running ? 'bg-cv-border/50 text-cv-muted cursor-not-allowed' : 'bg-cv-accent/20 hover:bg-cv-accent/30 text-cv-accent'
            }`}
          >
            <RefreshCw size={16} className={status.running ? 'animate-spin' : ''} />
            {status.running ? 'Syncing...' : 'Sync Now'}
          </button>
          <div className="text-xs text-cv-muted">
            {status.lastSyncTime ? `Last sync: ${new Date(status.lastSyncTime).toLocaleString()}` : 'Never synced'}
            {status.running && ` · ${status.queueLength} items in queue`}
          </div>
        </div>
      </div>

      {/* Tracked Cards & Query Editor */}
      <div className="bg-cv-panel rounded-xl p-5 border border-cv-border/50 mb-6">
        <h2 className="text-lg font-semibold text-cv-text mb-4">Tracked Cards ({trackedCards.length})</h2>
        {trackedCards.length === 0 ? (
          <div className="text-cv-muted text-sm">No cards tracked yet. Go to a set and click the star icon on cards you want to track.</div>
        ) : (
          <div className="space-y-2">
            {trackedCards.map(tc => (
              <div key={tc.id} className="border border-cv-border/30 rounded-lg p-3">
                <div className="flex justify-between items-center">
                  <div>
                    <span className="text-cv-text text-sm font-medium">#{tc.card_number} {tc.player}</span>
                    <span className="text-cv-muted text-xs ml-2">{tc.set_year} {tc.set_name}</span>
                  </div>
                  <span className="text-green-400 font-mono text-sm">
                    {tc.median_price != null ? `$${tc.median_price.toFixed(2)}` : 'No data'}
                  </span>
                </div>
                <div className="mt-2 flex items-center gap-2">
                  {editingQuery === tc.id ? (
                    <>
                      <input
                        value={queryText}
                        onChange={e => setQueryText(e.target.value)}
                        className="flex-1 bg-cv-dark border border-cv-border/50 rounded px-2 py-1 text-xs text-cv-text"
                      />
                      <button onClick={() => saveQuery(tc.id)} className="text-xs bg-cv-accent/20 hover:bg-cv-accent/30 text-cv-accent px-2 py-1 rounded">Save</button>
                      <button onClick={() => setEditingQuery(null)} className="text-xs text-cv-muted hover:text-cv-text">Cancel</button>
                    </>
                  ) : (
                    <>
                      <span className="text-xs text-cv-muted truncate flex-1">Query: {tc.search_query}</span>
                      <button
                        onClick={() => { setEditingQuery(tc.id); setQueryText(tc.search_query); }}
                        className="text-xs text-cyan-400 hover:text-cyan-300"
                      >Edit</button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Sync Log */}
      <div className="bg-cv-panel rounded-xl p-5 border border-cv-border/50">
        <h2 className="text-lg font-semibold text-cv-text mb-4 flex items-center gap-2">
          <Clock size={18} /> Sync Log
        </h2>
        <div className="max-h-80 overflow-y-auto space-y-1">
          {status.log.length === 0 ? (
            <div className="text-cv-muted text-sm">No sync activity yet.</div>
          ) : (
            status.log.map((entry, i) => (
              <div key={i} className={`text-xs py-1 px-2 rounded flex items-start gap-2 ${
                entry.type === 'error' ? 'text-red-400 bg-red-900/10' :
                entry.type === 'warn' ? 'text-yellow-400 bg-yellow-900/10' :
                entry.type === 'success' ? 'text-green-400 bg-green-900/10' :
                'text-cv-muted'
              }`}>
                <span className="text-cv-muted/50 whitespace-nowrap">{new Date(entry.timestamp).toLocaleTimeString()}</span>
                <span>{entry.message}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
