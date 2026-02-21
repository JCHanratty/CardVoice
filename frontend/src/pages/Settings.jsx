import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';
import { Settings as SettingsIcon, RefreshCw, Clock, ToggleLeft, ToggleRight, ChevronDown, ChevronRight } from 'lucide-react';

const API = import.meta.env.VITE_API_URL || 'http://localhost:8000';

export default function Settings() {
  const [status, setStatus] = useState(null);
  const [intervalHours, setIntervalHours] = useState(24);
  const [trackedCards, setTrackedCards] = useState([]);
  const [editingQuery, setEditingQuery] = useState(null);
  const [queryText, setQueryText] = useState('');
  const [sets, setSets] = useState([]);
  const [expandedSetId, setExpandedSetId] = useState(null);
  const [setMetadata, setSetMetadata] = useState({});
  const [ebayAppId, setEbayAppId] = useState('');
  const [ebayCertId, setEbayCertId] = useState('');
  const [ebayStatus, setEbayStatus] = useState(null); // null, 'saving', 'testing', 'valid', 'invalid'
  const [ebayError, setEbayError] = useState('');
  const [ebayConfigured, setEbayConfigured] = useState(false);
  const [analyticsEnabled, setAnalyticsEnabled] = useState(true);

  const fetchStatus = () => {
    axios.get(`${API}/api/sync/status`).then(r => {
      setStatus(r.data);
      setIntervalHours(Math.round(r.data.intervalMs / 3600000));
    }).catch(() => {});
  };

  const fetchSets = () => {
    axios.get(`${API}/api/sets`).then(r => setSets(r.data)).catch(() => {});
  };

  useEffect(() => {
    fetchStatus();
    fetchSets();
    axios.get(`${API}/api/tracked-cards`).then(r => setTrackedCards(r.data)).catch(() => {});
    axios.get(`${API}/api/settings/ebay`).then(r => {
      setEbayConfigured(r.data.configured);
      if (r.data.configured) {
        setEbayAppId(r.data.app_id);
        setEbayCertId(r.data.cert_id);
      }
    }).catch(() => {});
    axios.get(`${API}/api/settings/analytics`).then(r => {
      setAnalyticsEnabled(r.data.enabled);
    }).catch(() => {});
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

  const toggleSetSync = (setId, currentVal) => {
    axios.put(`${API}/api/sets/${setId}/sync-settings`, { sync_enabled: currentVal ? 0 : 1 }).then(() => {
      fetchSets();
    });
  };

  const expandSet = async (setId) => {
    if (expandedSetId === setId) { setExpandedSetId(null); return; }
    setExpandedSetId(setId);
    if (!setMetadata[setId]) {
      const res = await axios.get(`${API}/api/sets/${setId}/metadata`);
      setSetMetadata(prev => ({ ...prev, [setId]: res.data }));
    }
  };

  const toggleInsertPricing = async (itId, enabled, setId) => {
    await axios.put(`${API}/api/insert-types/${itId}/pricing`, { pricing_enabled: enabled ? 1 : 0 });
    const res = await axios.get(`${API}/api/sets/${setId}/metadata`);
    setSetMetadata(prev => ({ ...prev, [setId]: res.data }));
  };

  const switchInsertMode = async (itId, mode, setId) => {
    await axios.put(`${API}/api/insert-types/${itId}/pricing`, { pricing_mode: mode });
    const res = await axios.get(`${API}/api/sets/${setId}/metadata`);
    setSetMetadata(prev => ({ ...prev, [setId]: res.data }));
  };

  const saveEbayCredentials = async () => {
    setEbayStatus('saving');
    try {
      await axios.put(`${API}/api/settings/ebay`, { app_id: ebayAppId, cert_id: ebayCertId });
      setEbayStatus('testing');
      const testRes = await axios.post(`${API}/api/settings/ebay/test`);
      if (testRes.data.valid) {
        setEbayStatus('valid');
        setEbayConfigured(true);
        setEbayError('');
      } else {
        setEbayStatus('invalid');
        setEbayError(testRes.data.error || 'Invalid credentials');
      }
    } catch (err) {
      setEbayStatus('invalid');
      setEbayError(err.response?.data?.detail || err.message);
    }
  };

  const toggleAnalytics = () => {
    const newVal = !analyticsEnabled;
    setAnalyticsEnabled(newVal);
    axios.put(`${API}/api/settings/analytics`, { enabled: newVal });
  };

  if (!status) return <div className="text-cv-muted p-8">Loading...</div>;

  return (
    <div className="max-w-4xl mx-auto">
      <h1 className="text-2xl font-display font-bold text-cv-text mb-6 flex items-center gap-2">
        <SettingsIcon size={24} /> Settings
      </h1>

      {/* Sync Controls */}
      <div className="bg-cv-panel rounded-xl p-5 border border-cv-border/50 mb-6">
        <h2 className="text-lg font-display font-semibold text-cv-text mb-4">Price Sync</h2>
        <p className="text-xs text-cv-muted mb-3">
          Quick sync and value overview on the <Link to="/value" className="text-cv-gold hover:underline">Value Dashboard</Link>.
        </p>

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
          </div>
        </div>

        {/* Live sync progress */}
        {status.running && status.progress && (
          <div className="mt-4 bg-cv-dark/50 rounded-lg p-3 border border-cv-accent/20">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-cv-accent font-semibold uppercase tracking-wider">Sync Progress</span>
              <span className="text-xs text-cv-muted font-mono">
                {status.progress.current}/{status.progress.total} calls
              </span>
            </div>
            {status.progress.total > 0 && (
              <div className="w-full h-1.5 bg-cv-border/50 rounded-full mb-2 overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-cv-accent to-cv-gold rounded-full transition-all duration-500"
                  style={{ width: `${Math.round((status.progress.current / status.progress.total) * 100)}%` }}
                />
              </div>
            )}
            <div className="text-xs text-cv-text truncate">
              {status.progress.currentItem}
            </div>
          </div>
        )}
      </div>

      {/* Set Sync Controls */}
      <div className="bg-cv-panel rounded-xl p-5 border border-cv-border/50 mb-6">
        <h2 className="text-lg font-display font-semibold text-cv-text mb-4">Set Sync Controls</h2>
        <p className="text-xs text-cv-muted mb-3">Control which sets are included in price sync and configure per-insert-type pricing.</p>
        <div className="space-y-1">
          {sets.map(s => {
            const isExpanded = expandedSetId === s.id;
            const meta = setMetadata[s.id];
            return (
              <div key={s.id} className="border border-cv-border/30 rounded-lg overflow-hidden">
                <div className="flex items-center justify-between p-3 hover:bg-white/[0.02]">
                  <div className="flex items-center gap-2 flex-1 cursor-pointer" onClick={() => expandSet(s.id)}>
                    {isExpanded ? <ChevronDown size={14} className="text-cv-muted" /> : <ChevronRight size={14} className="text-cv-muted" />}
                    <span className="text-cv-text text-sm font-medium">{s.year} {s.name}</span>
                    <span className="text-xs text-cv-muted">{s.owned_count}/{s.total_cards} owned</span>
                    {s.section_count > 0 && (
                      <span className="text-[10px] bg-cv-accent2/10 text-cv-accent2 border border-cv-accent2/20 rounded px-1.5 py-0.5">
                        {s.section_count} insert types
                      </span>
                    )}
                  </div>
                  <button onClick={() => toggleSetSync(s.id, s.sync_enabled)}>
                    {s.sync_enabled ? <ToggleRight className="text-cv-accent" size={24} /> : <ToggleLeft className="text-cv-muted" size={24} />}
                  </button>
                </div>

                {isExpanded && meta && meta.insertTypes.length > 0 && (
                  <div className="border-t border-cv-border/30 bg-cv-dark/30 p-3">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-cv-muted border-b border-cv-border/20">
                          <th className="text-left py-1 font-semibold">Insert Type</th>
                          <th className="text-center py-1 font-semibold">Owned</th>
                          <th className="text-center py-1 font-semibold">Mode</th>
                          <th className="text-center py-1 font-semibold">API Calls</th>
                          <th className="text-center py-1 font-semibold">Enabled</th>
                        </tr>
                      </thead>
                      <tbody>
                        {meta.insertTypes.map(it => (
                          <tr key={it.id} className="border-b border-cv-border/10">
                            <td className="py-1.5 text-cv-text">{it.name}</td>
                            <td className="py-1.5 text-center font-mono">
                              <span className={it.owned_count > 0 && it.owned_count === it.card_count ? 'text-cv-accent' : 'text-cv-text'}>{it.owned_count || 0}</span>
                              <span className="text-cv-muted">/{it.card_count || '?'}</span>
                            </td>
                            <td className="py-1.5 text-center">
                              <select
                                value={it.pricing_mode || 'full_set'}
                                onChange={e => switchInsertMode(it.id, e.target.value, s.id)}
                                className="bg-cv-dark border border-cv-border/50 rounded px-1.5 py-0.5 text-xs text-cv-text"
                              >
                                <option value="full_set">Full Set</option>
                                <option value="per_card">Per Card</option>
                              </select>
                            </td>
                            <td className="py-1.5 text-center text-cv-muted font-mono">
                              {(it.pricing_mode || 'full_set') === 'per_card' ? (it.card_count || '?') : '1'}
                            </td>
                            <td className="py-1.5 text-center">
                              <button onClick={() => toggleInsertPricing(it.id, !it.pricing_enabled, s.id)}>
                                {it.pricing_enabled
                                  ? <ToggleRight className="text-cv-accent" size={18} />
                                  : <ToggleLeft className="text-cv-muted" size={18} />
                                }
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {isExpanded && meta && meta.insertTypes.length === 0 && (
                  <div className="border-t border-cv-border/30 bg-cv-dark/30 p-3">
                    <div className="text-xs text-cv-muted">No insert type metadata. Uses legacy whole-set pricing.</div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* eBay API Credentials */}
      <div className="bg-cv-panel rounded-xl p-5 border border-cv-border/50 mb-6">
        <h2 className="text-lg font-display font-semibold text-cv-text mb-2">Price Tracking Setup</h2>
        <p className="text-xs text-cv-muted mb-4">
          Enter your eBay Developer API credentials to enable price tracking.
          See <a href="#/how-to" className="text-cv-gold hover:underline">How To</a> for setup instructions.
        </p>

        <div className="space-y-3">
          <div>
            <label className="text-sm text-cv-text block mb-1">eBay App ID (Client ID)</label>
            <input
              type="text"
              value={ebayAppId}
              onChange={e => setEbayAppId(e.target.value)}
              placeholder="YourApp-Baseball-PRD-..."
              className="w-full bg-cv-dark border border-cv-border/50 rounded-lg px-3 py-2 text-sm text-cv-text placeholder:text-cv-muted/50 focus:border-cv-accent focus:outline-none"
            />
          </div>
          <div>
            <label className="text-sm text-cv-text block mb-1">eBay Cert ID (Client Secret)</label>
            <input
              type="password"
              value={ebayCertId}
              onChange={e => setEbayCertId(e.target.value)}
              placeholder="PRD-..."
              className="w-full bg-cv-dark border border-cv-border/50 rounded-lg px-3 py-2 text-sm text-cv-text placeholder:text-cv-muted/50 focus:border-cv-accent focus:outline-none"
            />
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={saveEbayCredentials}
              disabled={!ebayAppId || !ebayCertId || ebayStatus === 'saving' || ebayStatus === 'testing'}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-cv-accent/20 hover:bg-cv-accent/30 text-cv-accent disabled:opacity-50 transition-all"
            >
              {ebayStatus === 'saving' || ebayStatus === 'testing' ? (
                <><RefreshCw size={14} className="animate-spin" /> Testing...</>
              ) : 'Save & Test'}
            </button>
            {ebayStatus === 'valid' && (
              <span className="text-sm text-green-400 flex items-center gap-1">Credentials valid</span>
            )}
            {ebayStatus === 'invalid' && (
              <span className="text-sm text-red-400">{ebayError || 'Invalid credentials'}</span>
            )}
            {ebayConfigured && !ebayStatus && (
              <span className="text-xs text-cv-muted">Credentials configured</span>
            )}
          </div>
        </div>
      </div>

      {/* Analytics */}
      <div className="bg-cv-panel rounded-xl p-5 border border-cv-border/50 mb-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-display font-semibold text-cv-text">Anonymous Usage Stats</h2>
            <p className="text-xs text-cv-muted mt-1">
              Sends app version, OS, and card/set counts once per day. No personal data is collected.
            </p>
          </div>
          <button onClick={toggleAnalytics} className="ml-4 flex-shrink-0">
            <div className={`w-12 h-6 rounded-full transition-colors flex items-center px-0.5 ${analyticsEnabled ? 'bg-cv-accent' : 'bg-cv-border'}`}>
              <div className={`w-5 h-5 rounded-full bg-white shadow transition-transform ${analyticsEnabled ? 'translate-x-6' : 'translate-x-0'}`} />
            </div>
          </button>
        </div>
      </div>

      {/* Tracked Cards & Query Editor */}
      <div className="bg-cv-panel rounded-xl p-5 border border-cv-border/50 mb-6">
        <h2 className="text-lg font-display font-semibold text-cv-text mb-4">Tracked Cards ({trackedCards.length})</h2>
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
                  <span className="text-cv-gold font-mono text-sm">
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
                        className="text-xs text-cv-gold hover:text-cv-gold/80"
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
      <div className="bg-cv-panel rounded-xl p-5 border border-cv-border/50 mb-6">
        <h2 className="text-lg font-display font-semibold text-cv-text mb-4 flex items-center gap-2">
          <Clock size={18} /> Sync Log
        </h2>
        <div className="max-h-80 overflow-y-auto space-y-1">
          {status.log.length === 0 ? (
            <div className="text-cv-muted text-sm">No sync activity yet.</div>
          ) : (
            status.log.map((entry, i) => (
              <div key={i} className={`text-xs py-1 px-2 rounded flex items-start gap-2 ${
                entry.type === 'error' ? 'text-red-400 bg-red-900/10' :
                entry.type === 'warn' ? 'text-cv-gold bg-yellow-900/10' :
                entry.type === 'success' ? 'text-cv-gold bg-green-900/10' :
                'text-cv-muted'
              }`}>
                <span className="text-cv-muted/50 whitespace-nowrap">{new Date(entry.timestamp).toLocaleTimeString()}</span>
                <span>{entry.message}</span>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Support */}
      <div className="bg-cv-panel rounded-xl p-5 border border-cv-border/50">
        <h2 className="text-lg font-display font-semibold text-cv-text mb-2">Support CardVoice</h2>
        <p className="text-sm text-cv-muted mb-3">
          CardVoice is free and open source. If you find it useful, consider supporting development.
        </p>
        <a
          href="https://buymeacoffee.com/jchanratty"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-cv-gold/15 text-cv-gold border border-cv-gold/25 hover:bg-cv-gold/25 transition-all"
        >
          &#9829; Buy Me a Coffee
        </a>
      </div>
    </div>
  );
}
