import { useState } from 'react';
import axios from 'axios';
import { Shield, Search, Download, RefreshCw, ChevronRight, CheckCircle, XCircle } from 'lucide-react';

const API = import.meta.env.VITE_API_URL || 'http://localhost:8000';

export default function AdminPage() {
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(currentYear);
  const [sets, setSets] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Preview state
  const [selectedSet, setSelectedSet] = useState(null);
  const [preview, setPreview] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  // Import state
  const [importStatus, setImportStatus] = useState(null);
  const [importResult, setImportResult] = useState(null);

  // Search/filter
  const [searchQuery, setSearchQuery] = useState('');

  // Update state
  const [updateChecking, setUpdateChecking] = useState(false);
  const [updateMsg, setUpdateMsg] = useState('');

  const checkForUpdates = async () => {
    if (!window.electronAPI?.checkForUpdates) {
      setUpdateMsg('Updates only available in the desktop app');
      return;
    }
    setUpdateChecking(true);
    setUpdateMsg('');
    try {
      const result = await window.electronAPI.checkForUpdates();
      if (result.error) {
        setUpdateMsg(result.error);
      } else if (result.version) {
        setUpdateMsg(`Update v${result.version} found — downloading...`);
      } else {
        setUpdateMsg('You are on the latest version');
      }
    } catch (err) {
      setUpdateMsg(err.message || 'Failed to check for updates');
    }
    setUpdateChecking(false);
  };

  const browse = async () => {
    setLoading(true);
    setError('');
    setSets([]);
    setSelectedSet(null);
    setPreview(null);
    try {
      const res = await axios.post(`${API}/api/admin/tcdb/browse`, { year });
      setSets(res.data);
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    }
    setLoading(false);
  };

  const loadPreview = async (set) => {
    setSelectedSet(set);
    setPreviewLoading(true);
    setPreview(null);
    setImportResult(null);
    try {
      const res = await axios.post(`${API}/api/admin/tcdb/preview`, {
        setId: set.tcdb_id,
        year: set.year || year,
      });
      setPreview(res.data);
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    }
    setPreviewLoading(false);
  };

  const startImport = async () => {
    if (!selectedSet) return;
    setImportResult(null);
    try {
      await axios.post(`${API}/api/admin/tcdb/import`, {
        setId: selectedSet.tcdb_id,
        year: selectedSet.year || year,
      });
      // Start polling
      const interval = setInterval(async () => {
        try {
          const res = await axios.get(`${API}/api/admin/tcdb/status`);
          setImportStatus(res.data);
          if (!res.data.running && res.data.phase !== 'idle') {
            clearInterval(interval);
            if (res.data.phase === 'done') {
              setImportResult(res.data.result);
            } else if (res.data.phase === 'error') {
              setError(res.data.error || 'Import failed');
            }
          }
        } catch (e) {
          clearInterval(interval);
        }
      }, 2000);
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    }
  };

  const filteredSets = sets.filter(s =>
    s.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const isImporting = importStatus?.running;

  return (
    <div className="max-w-5xl mx-auto">
      <h1 className="text-2xl font-display font-bold text-cv-text mb-6 flex items-center gap-2">
        <Shield size={24} /> Admin
      </h1>

      {/* Check for Updates */}
      <div className="bg-cv-panel rounded-xl p-5 border border-cv-border/50 mb-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-display font-semibold text-cv-text">App Updates</h2>
            <p className="text-xs text-cv-muted mt-1">Check for new versions of CardVoice</p>
          </div>
          <button
            onClick={checkForUpdates}
            disabled={updateChecking}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium ${
              updateChecking
                ? 'bg-cv-border/50 text-cv-muted cursor-not-allowed'
                : 'bg-cv-accent/20 hover:bg-cv-accent/30 text-cv-accent'
            } transition-all`}
          >
            <RefreshCw size={16} className={updateChecking ? 'animate-spin' : ''} />
            {updateChecking ? 'Checking...' : 'Check for Updates'}
          </button>
        </div>
        {updateMsg && (
          <div className="mt-3 text-sm text-cv-muted">{updateMsg}</div>
        )}
      </div>

      {/* Browse Section */}
      <div className="bg-cv-panel rounded-xl p-5 border border-cv-border/50 mb-6">
        <h2 className="text-lg font-display font-semibold text-cv-text mb-4">Import from TCDB</h2>
        <p className="text-xs text-cv-muted mb-4">
          Browse baseball card sets on TCDB, preview the checklist, and import directly into CardVoice.
        </p>

        <div className="flex items-center gap-3 mb-4">
          <label className="text-sm text-cv-text">Year</label>
          <input
            type="number"
            value={year}
            onChange={e => setYear(parseInt(e.target.value) || currentYear)}
            className="w-24 bg-cv-dark border border-cv-border/50 rounded-lg px-3 py-2 text-sm text-cv-text focus:border-cv-accent focus:outline-none"
            min={1900}
            max={currentYear + 1}
          />
          <button
            onClick={browse}
            disabled={loading}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium ${
              loading
                ? 'bg-cv-border/50 text-cv-muted cursor-not-allowed'
                : 'bg-gradient-to-r from-cv-accent to-cv-accent2 text-white hover:shadow-lg hover:shadow-cv-accent/20'
            } transition-all`}
          >
            {loading ? <RefreshCw size={16} className="animate-spin" /> : <Search size={16} />}
            {loading ? 'Browsing...' : 'Browse Sets'}
          </button>
        </div>

        {/* Error display */}
        {error && (
          <div className="mb-4 p-3 rounded-lg bg-red-900/20 border border-red-500/30 text-red-400 text-sm flex items-center gap-2">
            <XCircle size={16} /> {error}
            <button onClick={() => setError('')} className="ml-auto text-red-400/50 hover:text-red-400">dismiss</button>
          </div>
        )}

        {/* Set list */}
        {sets.length > 0 && (
          <>
            <div className="mb-3">
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Filter sets..."
                className="w-full bg-cv-dark border border-cv-border/50 rounded-lg px-3 py-2 text-sm text-cv-text placeholder:text-cv-muted/50 focus:border-cv-accent focus:outline-none"
              />
            </div>
            <div className="text-xs text-cv-muted mb-2">{filteredSets.length} sets found</div>
            <div className="max-h-80 overflow-y-auto space-y-1">
              {filteredSets.map(s => (
                <button
                  key={s.tcdb_id}
                  onClick={() => loadPreview(s)}
                  className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-all flex items-center justify-between ${
                    selectedSet?.tcdb_id === s.tcdb_id
                      ? 'bg-cv-accent/15 text-cv-accent border border-cv-accent/30'
                      : 'text-cv-text hover:bg-white/5 border border-transparent'
                  }`}
                >
                  <span className="font-medium">{s.name}</span>
                  <ChevronRight size={14} className="text-cv-muted" />
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Preview Section */}
      {(previewLoading || preview) && (
        <div className="bg-cv-panel rounded-xl p-5 border border-cv-border/50 mb-6">
          <h2 className="text-lg font-display font-semibold text-cv-text mb-4">
            Preview: {selectedSet?.name}
          </h2>

          {previewLoading ? (
            <div className="flex items-center gap-2 text-cv-muted text-sm">
              <RefreshCw size={16} className="animate-spin" /> Loading preview...
            </div>
          ) : preview && (
            <>
              {/* Summary stats */}
              <div className="grid grid-cols-3 gap-4 mb-4">
                <div className="bg-cv-dark/50 rounded-lg p-3 border border-cv-border/30">
                  <div className="text-2xl font-bold text-cv-text font-mono">{preview.total_cards}</div>
                  <div className="text-xs text-cv-muted">Base Cards</div>
                </div>
                <div className="bg-cv-dark/50 rounded-lg p-3 border border-cv-border/30">
                  <div className="text-2xl font-bold text-cv-text font-mono">{preview.parallels?.length || 0}</div>
                  <div className="text-xs text-cv-muted">Parallels</div>
                </div>
                <div className="bg-cv-dark/50 rounded-lg p-3 border border-cv-border/30">
                  <div className="text-2xl font-bold text-cv-text font-mono">{preview.inserts?.length || 0}</div>
                  <div className="text-xs text-cv-muted">Inserts</div>
                </div>
              </div>

              {/* Parallels list */}
              {preview.parallels?.length > 0 && (
                <div className="mb-4">
                  <h3 className="text-sm font-semibold text-cv-muted uppercase tracking-widest mb-2">Parallels</h3>
                  <div className="flex flex-wrap gap-1.5">
                    {preview.parallels.map(p => (
                      <span key={p.tcdb_id} className="text-xs bg-cv-accent/10 text-cv-accent border border-cv-accent/20 rounded px-2 py-0.5">
                        {p.name}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Inserts list */}
              {preview.inserts?.length > 0 && (
                <div className="mb-4">
                  <h3 className="text-sm font-semibold text-cv-muted uppercase tracking-widest mb-2">Inserts</h3>
                  <div className="flex flex-wrap gap-1.5">
                    {preview.inserts.map(ins => (
                      <span key={ins.tcdb_id} className="text-xs bg-cv-gold/10 text-cv-gold border border-cv-gold/20 rounded px-2 py-0.5">
                        {ins.name}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Sample cards table */}
              {preview.base_cards?.length > 0 && (
                <div className="mb-4">
                  <h3 className="text-sm font-semibold text-cv-muted uppercase tracking-widest mb-2">
                    Base Cards (showing {Math.min(preview.base_cards.length, 20)})
                  </h3>
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-cv-muted border-b border-cv-border/20">
                        <th className="text-left py-1 font-semibold w-16">#</th>
                        <th className="text-left py-1 font-semibold">Player</th>
                        <th className="text-left py-1 font-semibold">Team</th>
                        <th className="text-left py-1 font-semibold w-16">Flags</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.base_cards.slice(0, 20).map((c, i) => (
                        <tr key={i} className="border-b border-cv-border/10">
                          <td className="py-1.5 text-cv-text font-mono">{c.card_number}</td>
                          <td className="py-1.5 text-cv-text">{c.player}</td>
                          <td className="py-1.5 text-cv-muted">{c.team}</td>
                          <td className="py-1.5">
                            {c.rc_sp?.map(f => (
                              <span key={f} className="text-[10px] bg-cv-gold/15 text-cv-gold rounded px-1 mr-1">{f}</span>
                            ))}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {preview.base_cards.length > 20 && (
                    <div className="text-xs text-cv-muted mt-1">...and {preview.base_cards.length - 20} more</div>
                  )}
                </div>
              )}

              {/* Import button */}
              <button
                onClick={startImport}
                disabled={isImporting}
                className={`flex items-center gap-2 px-6 py-2.5 rounded-lg text-sm font-medium ${
                  isImporting
                    ? 'bg-cv-border/50 text-cv-muted cursor-not-allowed'
                    : 'bg-gradient-to-r from-cv-accent to-cv-accent2 text-white hover:shadow-lg hover:shadow-cv-accent/20'
                } transition-all`}
              >
                {isImporting ? <RefreshCw size={16} className="animate-spin" /> : <Download size={16} />}
                {isImporting ? 'Importing...' : 'Import to CardVoice'}
              </button>
            </>
          )}
        </div>
      )}

      {/* Import Progress */}
      {isImporting && importStatus?.progress && (
        <div className="bg-cv-panel rounded-xl p-5 border border-cv-border/50 mb-6">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-cv-accent font-semibold uppercase tracking-wider">Import Progress</span>
            <span className="text-xs text-cv-muted font-mono">
              {importStatus.progress.current}/{importStatus.progress.total}
            </span>
          </div>
          {importStatus.progress.total > 0 && (
            <div className="w-full h-1.5 bg-cv-border/50 rounded-full mb-2 overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-cv-accent to-cv-gold rounded-full transition-all duration-500"
                style={{ width: `${Math.round((importStatus.progress.current / importStatus.progress.total) * 100)}%` }}
              />
            </div>
          )}
          <div className="text-xs text-cv-text mb-3">{importStatus.progress.currentItem}</div>
          {/* Live scraper log */}
          {importStatus.log?.length > 0 && (
            <div className="bg-cv-dark/80 rounded-lg border border-cv-border/30 p-3 max-h-40 overflow-y-auto font-mono text-[11px] leading-relaxed text-cv-muted">
              {importStatus.log.map((line, i) => (
                <div key={i} className={i === importStatus.log.length - 1 ? 'text-cv-text' : ''}>{line}</div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Import Result */}
      {importResult && (
        <div className="bg-cv-panel rounded-xl p-5 border border-green-500/30 mb-6">
          <div className="flex items-center gap-2 mb-3">
            <CheckCircle size={20} className="text-green-400" />
            <h3 className="text-lg font-display font-semibold text-cv-text">Import Complete</h3>
          </div>
          {importResult.merge && (
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="text-cv-muted">Sets added:</div>
              <div className="text-cv-text font-mono">{importResult.merge.sets?.added || 0}</div>
              <div className="text-cv-muted">Cards added:</div>
              <div className="text-cv-text font-mono">{importResult.merge.cards?.added || 0}</div>
              <div className="text-cv-muted">Cards updated:</div>
              <div className="text-cv-text font-mono">{importResult.merge.cards?.updated || 0}</div>
              <div className="text-cv-muted">Insert types:</div>
              <div className="text-cv-text font-mono">{importResult.merge.insertTypes?.added || 0}</div>
              <div className="text-cv-muted">Parallels:</div>
              <div className="text-cv-text font-mono">{importResult.merge.parallels?.added || 0}</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
