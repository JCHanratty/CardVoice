import { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { Shield, Search, Download, RefreshCw, ChevronRight, CheckCircle, XCircle, Upload, Play, Square, Trash2, Eye, SkipForward, ExternalLink } from 'lucide-react';
import ScrapePreviewModal from '../components/ScrapePreviewModal';

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
  const [updateDownloaded, setUpdateDownloaded] = useState(false);

  const [showImportModal, setShowImportModal] = useState(false);
  const logEndRef = useRef(null);

  // TCDB cookie & collection import state
  const [tcdbCookie, setTcdbCookie] = useState('');
  const [tcdbCookieStatus, setTcdbCookieStatus] = useState('');
  const [tcdbMember, setTcdbMember] = useState('');
  const [collectionImporting, setCollectionImporting] = useState(false);
  const [collectionStatus, setCollectionStatus] = useState('');
  const [collectionResult, setCollectionResult] = useState(null);
  const [backfillRunning, setBackfillRunning] = useState(false);
  const [backfillStatus, setBackfillStatus] = useState('');
  const [showBackfillModal, setShowBackfillModal] = useState(false);
  const [backfillProgress, setBackfillProgress] = useState(null);
  const [backfillLog, setBackfillLog] = useState([]);
  const [backfillPhase, setBackfillPhase] = useState('');
  const [backfillStartedAt, setBackfillStartedAt] = useState(null);
  const [backfillResult, setBackfillResult] = useState(null);
  const backfillLogEndRef = useRef(null);

  // Scrape queue state
  const [scrapeQueue, setScrapeQueue] = useState([]);
  const [scrapeStatus, setScrapeStatus] = useState({ running: false, total: 0, completed: 0, errors: 0, needsReview: 0 });
  const [scrapeFilter, setScrapeFilter] = useState('all');
  const [showQueueLoad, setShowQueueLoad] = useState(false);
  const [queueJsonInput, setQueueJsonInput] = useState('');
  const [showPreviewModal, setShowPreviewModal] = useState(false);
  const [previewItem, setPreviewItem] = useState(null);
  const [previewData, setPreviewData] = useState(null);
  const [assignInputs, setAssignInputs] = useState({});

  const checkForUpdates = async () => {
    if (!window.electronAPI?.checkForUpdates) {
      setUpdateMsg('Updates only available in the desktop app');
      return;
    }
    setUpdateChecking(true);
    setUpdateMsg('');

    // Listen for download events so the Admin page can show real status
    window.electronAPI.onUpdateNotAvailable?.(() => {
      setUpdateMsg('You are on the latest version');
      setUpdateChecking(false);
    });
    window.electronAPI.onDownloadProgress?.((progress) => {
      setUpdateMsg(`Downloading update... ${progress.percent}%`);
    });
    window.electronAPI.onUpdateDownloaded?.((info) => {
      setUpdateMsg(`v${info.version} ready — restart to install`);
      setUpdateChecking(false);
      setUpdateDownloaded(true);
    });
    window.electronAPI.onUpdateError?.((err) => {
      setUpdateMsg(`Update error: ${err.message}`);
      setUpdateChecking(false);
    });

    try {
      const result = await window.electronAPI.checkForUpdates();
      if (result.error) {
        setUpdateMsg(result.error);
        setUpdateChecking(false);
      } else if (result.version) {
        setUpdateMsg(`Update v${result.version} found — downloading...`);
      }
      // Don't set "latest version" here — wait for the update-not-available event
    } catch (err) {
      setUpdateMsg(err.message || 'Failed to check for updates');
      setUpdateChecking(false);
    }
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
    setImportStatus(null);
    setError('');
    setShowImportModal(true);
    try {
      await axios.post(`${API}/api/admin/tcdb/import`, {
        setId: selectedSet.tcdb_id,
        year: selectedSet.year || year,
      });
      const interval = setInterval(async () => {
        try {
          const res = await axios.get(`${API}/api/admin/tcdb/status`);
          setImportStatus(res.data);
          if (!res.data.running && res.data.phase !== 'idle') {
            clearInterval(interval);
            if (res.data.phase === 'done') {
              setImportResult(res.data.result);
            }
          }
        } catch (e) {
          clearInterval(interval);
        }
      }, 1000);
    } catch (err) {
      setError(err.response?.data?.error || err.message);
      setShowImportModal(false);
    }
  };

  const cancelImport = async () => {
    try {
      await axios.post(`${API}/api/admin/tcdb/cancel`);
    } catch (e) {
      // ignore
    }
  };

  const saveTcdbCookie = async () => {
    try {
      await axios.put(`${API}/api/settings/tcdb-cookie`, { cookie: tcdbCookie });
      setTcdbCookieStatus('Cookie saved!');
      setTcdbCookie('');
      setTimeout(() => setTcdbCookieStatus(''), 3000);
    } catch (err) {
      setTcdbCookieStatus('Failed to save');
    }
  };

  const [showCollectionModal, setShowCollectionModal] = useState(false);
  const [collectionLog, setCollectionLog] = useState([]);
  const collectionLogEndRef = useRef(null);
  const [collectionProgress, setCollectionProgress] = useState(null);
  const [collectionPhase, setCollectionPhase] = useState('');
  const [collectionStartedAt, setCollectionStartedAt] = useState(null);
  const [showJsonImport, setShowJsonImport] = useState(false);
  const [jsonImportData, setJsonImportData] = useState('');
  const [jsonImportStatus, setJsonImportStatus] = useState('');

  const startCollectionImport = async () => {
    setCollectionImporting(true);
    setCollectionStatus('Starting collection import...');
    setCollectionResult(null);
    setCollectionLog([]);
    setCollectionProgress(null);
    setCollectionPhase('starting');
    setCollectionStartedAt(Date.now());
    setShowCollectionModal(true);
    try {
      await axios.post(`${API}/api/admin/tcdb/collection/import`, { member: tcdbMember });
      // Poll status
      const interval = setInterval(async () => {
        try {
          const res = await axios.get(`${API}/api/admin/tcdb/status`);
          const s = res.data;
          setCollectionLog(s.log || []);
          setCollectionProgress(s.progress);
          setCollectionPhase(s.phase || 'idle');
          if (!s.running && s.phase !== 'idle') {
            clearInterval(interval);
            setCollectionImporting(false);
            if (s.phase === 'done') {
              setCollectionResult(s.result?.import || s.result);
              setCollectionStatus('Done!');
            } else if (s.phase === 'error') {
              setCollectionStatus(`Error: ${s.error}`);
            }
          }
        } catch (e) {
          clearInterval(interval);
          setCollectionImporting(false);
        }
      }, 1000);
    } catch (err) {
      setCollectionStatus(`Error: ${err.response?.data?.error || err.message}`);
      setCollectionImporting(false);
    }
  };

  const cancelCollection = async () => {
    try {
      await axios.post(`${API}/api/admin/tcdb/cancel`);
    } catch (e) { /* ignore */ }
  };

  const submitJsonImport = async (jsonString) => {
    const data = jsonString || jsonImportData;
    setJsonImportStatus('Importing...');
    try {
      const parsed = JSON.parse(data);
      const res = await axios.post(`${API}/api/admin/tcdb/collection/import-json`, { data: parsed });
      setCollectionResult(res.data);
      setJsonImportStatus('Import complete!');
      setJsonImportData('');
    } catch (err) {
      if (err instanceof SyntaxError) {
        setJsonImportStatus('Invalid JSON. Please check the format.');
      } else {
        setJsonImportStatus(`Error: ${err.response?.data?.error || err.message}`);
      }
    }
  };

  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const content = ev.target.result;
      setJsonImportData(content);
      submitJsonImport(content);
    };
    reader.readAsText(file);
    e.target.value = ''; // reset input
  };

  const startBackfill = async () => {
    setBackfillRunning(true);
    setBackfillStatus('Starting checklist backfill...');
    setBackfillResult(null);
    setBackfillLog([]);
    setBackfillProgress(null);
    setBackfillPhase('starting');
    setBackfillStartedAt(Date.now());
    setShowBackfillModal(true);
    try {
      await axios.post(`${API}/api/admin/tcdb/backfill`);
      const interval = setInterval(async () => {
        try {
          const res = await axios.get(`${API}/api/admin/tcdb/status`);
          const s = res.data;
          setBackfillLog(s.log || []);
          setBackfillProgress(s.progress);
          setBackfillPhase(s.phase || 'idle');
          if (!s.running && s.phase !== 'idle') {
            clearInterval(interval);
            setBackfillRunning(false);
            if (s.phase === 'done') {
              setBackfillResult(s.result);
              setBackfillStatus('Done!');
            } else if (s.phase === 'error') {
              setBackfillStatus(`Error: ${s.error}`);
            }
          }
        } catch (e) {
          clearInterval(interval);
          setBackfillRunning(false);
        }
      }, 1000);
    } catch (err) {
      setBackfillStatus(`Error: ${err.response?.data?.error || err.message}`);
      setBackfillRunning(false);
    }
  };

  const cancelBackfill = async () => {
    try {
      await axios.post(`${API}/api/admin/tcdb/cancel`);
    } catch (e) { /* ignore */ }
  };

  // --- Scrape queue functions ---
  const loadScrapeQueue = async () => {
    try {
      const res = await axios.get(`${API}/api/admin/tcdb/scrape-queue`);
      setScrapeQueue(res.data.items || res.data || []);
      if (res.data.status) setScrapeStatus(res.data.status);
    } catch (e) { /* ignore */ }
  };

  const submitQueueJson = async () => {
    try {
      const parsed = JSON.parse(queueJsonInput);
      await axios.post(`${API}/api/admin/tcdb/scrape-queue`, { items: Array.isArray(parsed) ? parsed : parsed.items || [parsed] });
      setQueueJsonInput('');
      setShowQueueLoad(false);
      loadScrapeQueue();
    } catch (err) {
      if (err instanceof SyntaxError) {
        alert('Invalid JSON');
      } else {
        alert(err.response?.data?.error || err.message);
      }
    }
  };

  const startScraping = async () => {
    try {
      await axios.post(`${API}/api/admin/tcdb/scrape-queue/start`);
      setScrapeStatus(prev => ({ ...prev, running: true }));
    } catch (err) {
      alert(err.response?.data?.error || err.message);
    }
  };

  const stopScraping = async () => {
    try {
      await axios.post(`${API}/api/admin/tcdb/scrape-queue/stop`);
      setScrapeStatus(prev => ({ ...prev, running: false }));
    } catch (err) { /* ignore */ }
  };

  const pollScrapeStatus = async () => {
    try {
      const res = await axios.get(`${API}/api/admin/tcdb/scrape-queue/status`);
      setScrapeStatus(res.data);
    } catch (e) { /* ignore */ }
  };

  const openPreview = async (queueItem) => {
    setPreviewItem(queueItem);
    setShowPreviewModal(true);
    setPreviewData(null);
    try {
      const res = await axios.get(`${API}/api/admin/tcdb/scrape-queue/${queueItem.id}/preview`);
      setPreviewData(res.data);
    } catch (err) {
      alert(err.response?.data?.error || err.message);
      setShowPreviewModal(false);
    }
  };

  const importQueueItem = async (id) => {
    try {
      await axios.post(`${API}/api/admin/tcdb/scrape-queue/${id}/import`);
      loadScrapeQueue();
      setShowPreviewModal(false);
      setPreviewItem(null);
      setPreviewData(null);
    } catch (err) {
      alert(err.response?.data?.error || err.message);
    }
  };

  const skipQueueItem = async (id) => {
    try {
      await axios.post(`${API}/api/admin/tcdb/scrape-queue/${id}/skip`);
      loadScrapeQueue();
      setShowPreviewModal(false);
      setPreviewItem(null);
      setPreviewData(null);
    } catch (err) { /* ignore */ }
  };

  const rescrapeQueueItem = async (id) => {
    try {
      await axios.post(`${API}/api/admin/tcdb/scrape-queue/${id}/rescrape`);
      loadScrapeQueue();
      setShowPreviewModal(false);
      setPreviewItem(null);
      setPreviewData(null);
    } catch (err) { /* ignore */ }
  };

  const deleteQueueItem = async (id) => {
    try {
      await axios.delete(`${API}/api/admin/tcdb/scrape-queue/${id}`);
      loadScrapeQueue();
    } catch (err) { /* ignore */ }
  };

  const assignSetId = async (id, tcdbSetId) => {
    try {
      await axios.put(`${API}/api/admin/tcdb/scrape-queue/${id}/assign`, { tcdb_set_id: tcdbSetId });
      loadScrapeQueue();
    } catch (err) {
      alert(err.response?.data?.error || err.message);
    }
  };

  const importAllScraped = async () => {
    try {
      await axios.post(`${API}/api/admin/tcdb/scrape-queue/import-all`);
      loadScrapeQueue();
    } catch (err) {
      alert(err.response?.data?.error || err.message);
    }
  };

  const clearQueue = async () => {
    if (!window.confirm('Clear the entire scrape queue? This cannot be undone.')) return;
    try {
      await axios.delete(`${API}/api/admin/tcdb/scrape-queue`);
      setScrapeQueue([]);
      setScrapeStatus({ running: false, total: 0, completed: 0, errors: 0, needsReview: 0 });
    } catch (err) { /* ignore */ }
  };

  const handlePreviewEdit = async (operations) => {
    if (!previewItem) return;
    try {
      await axios.put(`${API}/api/admin/tcdb/scrape-queue/${previewItem.id}/edit`, { operations });
      // Refresh preview data
      const res = await axios.get(`${API}/api/admin/tcdb/scrape-queue/${previewItem.id}/preview`);
      setPreviewData(res.data);
      loadScrapeQueue();
    } catch (err) {
      alert(err.response?.data?.error || err.message);
    }
  };

  const formatElapsed = (startedAt) => {
    if (!startedAt) return '0:00';
    const seconds = Math.floor((Date.now() - startedAt) / 1000);
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  useEffect(() => {
    if (logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [importStatus?.log]);

  useEffect(() => {
    if (collectionLogEndRef.current) {
      collectionLogEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [collectionLog]);

  useEffect(() => {
    if (backfillLogEndRef.current) {
      backfillLogEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [backfillLog]);

  // Load scrape queue on mount
  useEffect(() => {
    loadScrapeQueue();
  }, []);

  // Poll scrape status when running
  useEffect(() => {
    if (!scrapeStatus.running) return;
    const interval = setInterval(() => {
      pollScrapeStatus();
      loadScrapeQueue();
    }, 2000);
    return () => clearInterval(interval);
  }, [scrapeStatus.running]);

  // Scrape queue filter helpers
  const filteredQueue = scrapeFilter === 'all'
    ? scrapeQueue
    : scrapeQueue.filter(q => q.status === scrapeFilter);

  const queueCounts = {
    all: scrapeQueue.length,
    pending: scrapeQueue.filter(q => q.status === 'pending').length,
    needs_review: scrapeQueue.filter(q => q.status === 'needs_review').length,
    scraped: scrapeQueue.filter(q => q.status === 'scraped').length,
    imported: scrapeQueue.filter(q => q.status === 'imported').length,
    error: scrapeQueue.filter(q => q.status === 'error').length,
  };

  const statusBadge = (status) => {
    const map = {
      pending: 'bg-gray-600/20 text-gray-400',
      searching: 'bg-blue-600/20 text-blue-400 animate-pulse',
      scraping: 'bg-blue-600/20 text-blue-400 animate-pulse',
      needs_review: 'bg-yellow-600/20 text-yellow-400',
      scraped: 'bg-indigo-600/20 text-indigo-400',
      imported: 'bg-green-600/20 text-green-400',
      error: 'bg-red-600/20 text-red-400',
      skipped: 'bg-gray-600/20 text-gray-500',
    };
    return map[status] || 'bg-gray-600/20 text-gray-400';
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
          <div className="mt-3 flex items-center gap-3">
            <span className="text-sm text-cv-muted">{updateMsg}</span>
            {updateDownloaded && (
              <button
                onClick={() => window.electronAPI?.quitAndInstall()}
                className="px-4 py-1.5 rounded-lg text-sm font-medium bg-gradient-to-r from-cv-accent to-cv-accent2 text-white hover:shadow-lg hover:shadow-cv-accent/20 transition-all"
              >
                Install & Restart
              </button>
            )}
          </div>
        )}
      </div>

      {/* TCDB Session Cookie */}
      <div className="bg-cv-panel rounded-xl border border-cv-border p-4 mb-4">
        <h3 className="text-sm font-semibold text-cv-text mb-3">TCDB Authentication</h3>
        <p className="text-xs text-cv-muted mb-3">
          Log into tcdb.com in your browser, then copy your session cookie and paste it here.
          This allows CardVoice to import your collection.
        </p>
        <div className="flex gap-2">
          <input type="text" value={tcdbCookie} onChange={e => setTcdbCookie(e.target.value)}
            placeholder="CFID=123456;CFTOKEN=abcdef..."
            className="flex-1 bg-cv-dark border border-cv-border rounded-lg px-3 py-2 text-sm text-cv-text font-mono focus:border-cv-accent focus:outline-none" />
          <button onClick={saveTcdbCookie}
            className="px-4 py-2 rounded-lg text-sm bg-cv-accent text-white font-medium hover:bg-cv-accent/80">Save</button>
        </div>
        {tcdbCookieStatus && <p className="text-xs text-cv-accent mt-2">{tcdbCookieStatus}</p>}
      </div>

      {/* Collection Import */}
      <div className="bg-cv-panel rounded-xl border border-cv-border p-4 mb-4">
        <h3 className="text-sm font-semibold text-cv-text mb-3">Import TCDB Collection</h3>
        <p className="text-xs text-cv-muted mb-3">
          Import your entire TCDB collection into CardVoice. Chrome will open and you can log into TCDB — the scraper reads all your collection pages automatically. Or paste JSON data directly.
        </p>
        <div className="flex gap-2 items-end">
          <div className="flex-1">
            <label className="text-xs text-cv-muted block mb-1">TCDB Username</label>
            <input type="text" value={tcdbMember} onChange={e => setTcdbMember(e.target.value)}
              placeholder="Jhanratty"
              className="w-full bg-cv-dark border border-cv-border rounded-lg px-3 py-2 text-sm text-cv-text focus:border-cv-accent focus:outline-none" />
          </div>
          <button onClick={startCollectionImport} disabled={!tcdbMember || collectionImporting}
            className="px-4 py-2 rounded-lg text-sm bg-gradient-to-r from-cv-accent to-cv-accent2 text-white font-medium disabled:opacity-50 hover:opacity-90">
            {collectionImporting ? 'Importing...' : 'Import My Collection'}
          </button>
          <button onClick={() => setShowJsonImport(!showJsonImport)}
            className="px-4 py-2 rounded-lg text-sm bg-cv-accent/20 text-cv-accent font-medium hover:bg-cv-accent/30">
            Paste JSON
          </button>
        </div>
        {showJsonImport && (
          <div className="mt-3 bg-cv-dark rounded-lg p-3 border border-cv-border">
            <label className="text-xs text-cv-muted block mb-1">Paste JSON from browser console scraper, or upload a JSON file</label>
            <textarea value={jsonImportData} onChange={e => setJsonImportData(e.target.value)}
              placeholder='{"total_cards": 100, "total_sets": 5, "sets": [...]}'
              rows={6}
              className="w-full bg-cv-dark border border-cv-border rounded-lg px-3 py-2 text-xs text-cv-text font-mono focus:border-cv-accent focus:outline-none resize-y" />
            <div className="flex items-center gap-2 mt-2">
              <button onClick={() => submitJsonImport()} disabled={!jsonImportData.trim()}
                className="px-4 py-2 rounded-lg text-sm bg-gradient-to-r from-cv-accent to-cv-accent2 text-white font-medium disabled:opacity-50 hover:opacity-90">
                Import JSON
              </button>
              <label className="px-4 py-2 rounded-lg text-sm bg-cv-accent/20 text-cv-accent font-medium hover:bg-cv-accent/30 cursor-pointer flex items-center gap-1">
                <Upload size={14} /> Upload File
                <input type="file" accept=".json" onChange={handleFileUpload} className="hidden" />
              </label>
              {jsonImportStatus && <span className="text-xs text-cv-muted">{jsonImportStatus}</span>}
            </div>
          </div>
        )}
        {collectionResult && !showCollectionModal && (
          <div className="mt-3 bg-cv-accent/10 border border-cv-accent/30 rounded-lg p-3">
            <div className="text-sm text-cv-accent font-semibold">Import Complete!</div>
            <div className="text-xs text-cv-muted mt-1">
              {collectionResult.sets_created || 0} sets created, {collectionResult.sets_matched || 0} matched, {collectionResult.cards_added || 0} cards added, {collectionResult.cards_updated || 0} updated
            </div>
          </div>
        )}
      </div>

      {/* Collection Import Progress Modal */}
      {showCollectionModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-cv-panel border border-cv-border rounded-2xl p-6 max-w-lg w-full mx-4 shadow-2xl">
            <h2 className="text-lg font-display font-bold text-cv-text mb-1">
              Collection Import
            </h2>

            <div className="flex items-center justify-between mb-4">
              <span className="text-xs font-semibold uppercase tracking-wider text-cv-accent">
                {collectionPhase === 'collection-scrape' && 'Scraping TCDB pages...'}
                {collectionPhase === 'collection-import' && 'Importing into CardVoice...'}
                {collectionPhase === 'done' && 'Import Complete'}
                {collectionPhase === 'error' && 'Import Failed'}
                {(collectionPhase === 'starting' || collectionPhase === 'idle') && 'Starting...'}
              </span>
              <span className="text-xs text-cv-muted font-mono">
                {formatElapsed(collectionStartedAt)}
              </span>
            </div>

            {collectionProgress?.total > 0 && (
              <div className="w-full h-1.5 bg-cv-border/50 rounded-full mb-2 overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-cv-accent to-cv-gold rounded-full transition-all duration-500"
                  style={{ width: `${Math.min(100, Math.round((collectionProgress.current / collectionProgress.total) * 100))}%` }}
                />
              </div>
            )}
            {collectionProgress && (
              <div className="text-xs text-cv-muted mb-3 truncate">
                {collectionProgress.currentItem || `${collectionProgress.current}/${collectionProgress.total}`}
              </div>
            )}

            <div className="bg-cv-dark/80 rounded-lg border border-cv-border/30 p-3 h-48 overflow-y-auto font-mono text-[11px] leading-relaxed text-cv-muted mb-4">
              {collectionLog.length > 0 ? (
                collectionLog.map((line, i) => (
                  <div key={i} className={i === collectionLog.length - 1 ? 'text-cv-text' : ''}>{line}</div>
                ))
              ) : (
                <div className="text-cv-muted/50">Waiting for scraper output...</div>
              )}
              <div ref={collectionLogEndRef} />
            </div>

            {collectionPhase === 'error' && (
              <div className="mb-4 p-3 rounded-lg bg-red-900/20 border border-red-500/30 text-red-400 text-sm">
                {collectionStatus}
              </div>
            )}

            {collectionPhase === 'done' && collectionResult && (
              <div className="mb-4 p-3 rounded-lg bg-green-900/20 border border-green-500/30">
                <div className="flex items-center gap-2 mb-2">
                  <CheckCircle size={16} className="text-green-400" />
                  <span className="text-sm font-semibold text-green-400">Import Complete</span>
                </div>
                <div className="grid grid-cols-2 gap-1 text-xs">
                  <span className="text-cv-muted">Sets created:</span>
                  <span className="text-cv-text font-mono">{collectionResult.sets_created || collectionResult?.import?.sets_created || 0}</span>
                  <span className="text-cv-muted">Sets matched:</span>
                  <span className="text-cv-text font-mono">{collectionResult.sets_matched || collectionResult?.import?.sets_matched || 0}</span>
                  <span className="text-cv-muted">Cards added:</span>
                  <span className="text-cv-text font-mono">{collectionResult.cards_added || collectionResult?.import?.cards_added || 0}</span>
                  <span className="text-cv-muted">Cards updated:</span>
                  <span className="text-cv-text font-mono">{collectionResult.cards_updated || collectionResult?.import?.cards_updated || 0}</span>
                </div>
              </div>
            )}

            <div className="flex gap-3">
              {collectionImporting ? (
                <button
                  onClick={cancelCollection}
                  className="flex-1 px-4 py-2.5 rounded-xl text-sm font-medium bg-red-500/10 border border-red-500/30 text-red-400 hover:bg-red-500/20 transition-all"
                >
                  Cancel Import
                </button>
              ) : (
                <button
                  onClick={() => setShowCollectionModal(false)}
                  className="flex-1 px-4 py-2.5 rounded-xl text-sm font-medium bg-white/5 border border-cv-border/50 text-cv-muted hover:text-cv-text hover:bg-white/10 transition-all"
                >
                  Close
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Checklist Backfill */}
      <div className="bg-cv-panel rounded-xl border border-cv-border p-4 mb-4">
        <h3 className="text-sm font-semibold text-cv-text mb-3">Checklist Backfill</h3>
        <p className="text-xs text-cv-muted mb-3">
          After importing your collection, backfill full checklists so you can track which cards you're missing.
        </p>
        <button onClick={startBackfill} disabled={backfillRunning}
          className="px-4 py-2 rounded-lg text-sm bg-cv-accent text-white font-medium disabled:opacity-50 hover:bg-cv-accent/80">
          {backfillRunning ? 'Running...' : 'Start Backfill'}
        </button>
        {backfillResult && !showBackfillModal && (
          <div className="mt-3 bg-cv-accent/10 border border-cv-accent/30 rounded-lg p-3">
            <div className="text-sm text-cv-accent font-semibold">Backfill Complete!</div>
            <div className="text-xs text-cv-muted mt-1">
              {backfillResult.sets_backfilled || 0} of {backfillResult.total || 0} sets backfilled
            </div>
          </div>
        )}
      </div>

      {/* Backfill Progress Modal */}
      {showBackfillModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-cv-panel border border-cv-border rounded-2xl p-6 max-w-lg w-full mx-4 shadow-2xl">
            <h2 className="text-lg font-display font-bold text-cv-text mb-1">
              Checklist Backfill
            </h2>

            <div className="flex items-center justify-between mb-4">
              <span className="text-xs font-semibold uppercase tracking-wider text-cv-accent">
                {backfillPhase === 'backfilling' && 'Backfilling checklists...'}
                {backfillPhase === 'done' && 'Backfill Complete'}
                {backfillPhase === 'error' && 'Backfill Failed'}
                {(backfillPhase === 'starting' || backfillPhase === 'idle') && 'Starting...'}
              </span>
              <span className="text-xs text-cv-muted font-mono">
                {formatElapsed(backfillStartedAt)}
              </span>
            </div>

            {backfillProgress?.total > 0 && (
              <div className="w-full h-1.5 bg-cv-border/50 rounded-full mb-2 overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-cv-accent to-cv-gold rounded-full transition-all duration-500"
                  style={{ width: `${Math.min(100, Math.round((backfillProgress.current / backfillProgress.total) * 100))}%` }}
                />
              </div>
            )}
            {backfillProgress && (
              <div className="flex items-center justify-between text-xs text-cv-muted mb-3">
                <span className="truncate flex-1 mr-2">{backfillProgress.currentItem || 'Starting...'}</span>
                {backfillProgress.total > 0 && (
                  <span className="font-mono whitespace-nowrap">{backfillProgress.current}/{backfillProgress.total}</span>
                )}
              </div>
            )}

            <div className="bg-cv-dark/80 rounded-lg border border-cv-border/30 p-3 h-48 overflow-y-auto font-mono text-[11px] leading-relaxed text-cv-muted mb-4">
              {backfillLog.length > 0 ? (
                backfillLog.map((line, i) => (
                  <div key={i} className={line.startsWith('ERROR') ? 'text-red-400' : i === backfillLog.length - 1 ? 'text-cv-text' : ''}>{line}</div>
                ))
              ) : (
                <div className="text-cv-muted/50">Starting backfill...</div>
              )}
              <div ref={backfillLogEndRef} />
            </div>

            {backfillPhase === 'done' && backfillResult && (
              <div className="mb-4 p-3 rounded-lg bg-green-900/20 border border-green-500/30">
                <div className="flex items-center gap-2 mb-2">
                  <CheckCircle size={16} className="text-green-400" />
                  <span className="text-sm font-semibold text-green-400">Backfill Complete</span>
                </div>
                <div className="grid grid-cols-2 gap-1 text-xs">
                  <span className="text-cv-muted">Sets backfilled:</span>
                  <span className="text-cv-text font-mono">{backfillResult.sets_backfilled || 0}</span>
                  <span className="text-cv-muted">Total sets:</span>
                  <span className="text-cv-text font-mono">{backfillResult.total || 0}</span>
                </div>
              </div>
            )}

            {backfillPhase === 'error' && (
              <div className="mb-4 p-3 rounded-lg bg-red-900/20 border border-red-500/30 text-red-400 text-sm">
                {backfillStatus}
              </div>
            )}

            <div className="flex gap-3">
              {backfillRunning ? (
                <button
                  onClick={cancelBackfill}
                  className="flex-1 px-4 py-2.5 rounded-xl text-sm font-medium bg-red-500/10 border border-red-500/30 text-red-400 hover:bg-red-500/20 transition-all"
                >
                  Cancel Backfill
                </button>
              ) : (
                <button
                  onClick={() => setShowBackfillModal(false)}
                  className="flex-1 px-4 py-2.5 rounded-xl text-sm font-medium bg-white/5 border border-cv-border/50 text-cv-muted hover:text-cv-text hover:bg-white/10 transition-all"
                >
                  Close
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Scrape Queue */}
      <div className="bg-cv-panel rounded-xl border border-cv-border p-4 mb-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-cv-text">Scrape Queue</h3>
            {scrapeQueue.length > 0 && (
              <span className="text-xs bg-cv-accent/20 text-cv-accent px-2 py-0.5 rounded-full font-mono">
                {scrapeQueue.length}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowQueueLoad(true)}
              className="px-3 py-1.5 rounded-lg text-xs bg-cv-accent/20 text-cv-accent font-medium hover:bg-cv-accent/30 transition-colors"
            >
              Load Queue
            </button>
            {scrapeStatus.running ? (
              <button
                onClick={stopScraping}
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs bg-red-600/20 text-red-400 font-medium hover:bg-red-600/30 transition-colors"
              >
                <Square size={12} /> Stop
              </button>
            ) : (
              <button
                onClick={startScraping}
                disabled={scrapeQueue.filter(q => q.status === 'pending').length === 0}
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs bg-green-600/20 text-green-400 font-medium hover:bg-green-600/30 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <Play size={12} /> Start
              </button>
            )}
            <button
              onClick={importAllScraped}
              disabled={queueCounts.scraped === 0}
              className="px-3 py-1.5 rounded-lg text-xs bg-cv-accent text-white font-medium hover:bg-cv-accent/80 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              Import All Scraped
            </button>
            <button
              onClick={clearQueue}
              disabled={scrapeQueue.length === 0}
              className="px-3 py-1.5 rounded-lg text-xs bg-white/5 border border-cv-border/50 text-cv-muted hover:text-cv-text hover:bg-white/10 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              Clear
            </button>
          </div>
        </div>

        {/* Progress bar when running */}
        {scrapeStatus.running && scrapeStatus.total > 0 && (
          <div className="mb-3">
            <div className="w-full h-1.5 bg-cv-border/50 rounded-full mb-1 overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-cv-accent to-cv-gold rounded-full transition-all duration-500"
                style={{ width: `${Math.min(100, Math.round((scrapeStatus.completed / scrapeStatus.total) * 100))}%` }}
              />
            </div>
            <div className="text-xs text-cv-muted">
              {scrapeStatus.completed}/{scrapeStatus.total} completed
              {scrapeStatus.currentItem && <span className="ml-2 text-cv-text">{scrapeStatus.currentItem}</span>}
            </div>
          </div>
        )}

        {/* Filter tabs */}
        {scrapeQueue.length > 0 && (
          <div className="flex gap-1 mb-3 flex-wrap">
            {[
              { key: 'all', label: 'All' },
              { key: 'pending', label: 'Pending' },
              { key: 'needs_review', label: 'Needs Review' },
              { key: 'scraped', label: 'Scraped' },
              { key: 'imported', label: 'Imported' },
              { key: 'error', label: 'Errors' },
            ].map(tab => (
              <button
                key={tab.key}
                onClick={() => setScrapeFilter(tab.key)}
                className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${
                  scrapeFilter === tab.key
                    ? 'bg-cv-accent/20 text-cv-accent'
                    : 'text-cv-muted hover:text-cv-text hover:bg-white/5'
                }`}
              >
                {tab.label} ({queueCounts[tab.key] || 0})
              </button>
            ))}
          </div>
        )}

        {/* Queue table */}
        {scrapeQueue.length > 0 && (
          <div className="max-h-96 overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-cv-panel">
                <tr className="border-b border-cv-border/30 text-xs text-cv-muted uppercase">
                  <th className="text-left py-2 font-semibold w-10">#</th>
                  <th className="text-left py-2 font-semibold w-16">Year</th>
                  <th className="text-left py-2 font-semibold w-24">Brand</th>
                  <th className="text-left py-2 font-semibold">Set Name</th>
                  <th className="text-center py-2 font-semibold w-28">Status</th>
                  <th className="text-center py-2 font-semibold w-56">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredQueue.map((q, i) => (
                  <tr key={q.id} className="border-b border-cv-border/10 hover:bg-white/[0.02]">
                    <td className="py-2 text-cv-muted font-mono text-xs">{i + 1}</td>
                    <td className="py-2 text-cv-text">{q.year || ''}</td>
                    <td className="py-2 text-cv-muted">{q.brand || ''}</td>
                    <td className="py-2 text-cv-text font-medium">{q.set_name || q.name || ''}</td>
                    <td className="py-2 text-center">
                      <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${statusBadge(q.status)}`}>
                        {(q.status || 'pending').replace('_', ' ')}
                      </span>
                    </td>
                    <td className="py-2 text-center">
                      <div className="flex items-center justify-center gap-1 flex-wrap">
                        {q.status === 'scraped' && (
                          <>
                            <button onClick={() => openPreview(q)}
                              className="flex items-center gap-1 px-2 py-1 rounded text-xs bg-cv-secondary text-cv-text hover:bg-cv-secondary/80 transition-colors">
                              <Eye size={12} /> Preview
                            </button>
                            <button onClick={() => importQueueItem(q.id)}
                              className="px-2 py-1 rounded text-xs bg-green-600/20 text-green-400 hover:bg-green-600/30 transition-colors">
                              Import
                            </button>
                            <button onClick={() => skipQueueItem(q.id)}
                              className="px-2 py-1 rounded text-xs bg-gray-600/20 text-gray-400 hover:bg-gray-600/30 transition-colors">
                              Skip
                            </button>
                            <button onClick={() => deleteQueueItem(q.id)}
                              className="p-1 rounded text-cv-muted hover:text-red-400 hover:bg-red-600/10 transition-colors">
                              <Trash2 size={13} />
                            </button>
                          </>
                        )}
                        {q.status === 'needs_review' && (
                          <>
                            {q.scraped_data?.candidates && (
                              <span className="text-xs text-cv-muted mr-1">
                                {q.scraped_data.candidates.length} candidates
                              </span>
                            )}
                            <input
                              type="text"
                              value={assignInputs[q.id] || ''}
                              onChange={e => setAssignInputs(prev => ({ ...prev, [q.id]: e.target.value }))}
                              placeholder="TCDB Set ID"
                              className="w-24 bg-cv-dark border border-cv-border/50 rounded px-2 py-1 text-xs text-cv-text focus:border-cv-accent focus:outline-none"
                            />
                            <button
                              onClick={() => { assignSetId(q.id, assignInputs[q.id]); setAssignInputs(prev => ({ ...prev, [q.id]: '' })); }}
                              disabled={!assignInputs[q.id]}
                              className="px-2 py-1 rounded text-xs bg-cv-accent text-white hover:bg-cv-accent/80 disabled:opacity-50 transition-colors"
                            >
                              Assign
                            </button>
                            <button onClick={() => deleteQueueItem(q.id)}
                              className="p-1 rounded text-cv-muted hover:text-red-400 hover:bg-red-600/10 transition-colors">
                              <Trash2 size={13} />
                            </button>
                          </>
                        )}
                        {q.status === 'error' && (
                          <>
                            {q.error_message && (
                              <span className="text-xs text-red-400 max-w-[150px] truncate" title={q.error_message}>
                                {q.error_message}
                              </span>
                            )}
                            <button onClick={() => rescrapeQueueItem(q.id)}
                              className="flex items-center gap-1 px-2 py-1 rounded text-xs bg-cv-secondary text-cv-text hover:bg-cv-secondary/80 transition-colors">
                              <RefreshCw size={12} /> Re-scrape
                            </button>
                            <button onClick={() => deleteQueueItem(q.id)}
                              className="p-1 rounded text-cv-muted hover:text-red-400 hover:bg-red-600/10 transition-colors">
                              <Trash2 size={13} />
                            </button>
                          </>
                        )}
                        {q.status === 'imported' && q.card_set_id && (
                          <a href={`/sets/${q.card_set_id}`}
                            className="flex items-center gap-1 px-2 py-1 rounded text-xs bg-cv-accent/20 text-cv-accent hover:bg-cv-accent/30 transition-colors">
                            <ExternalLink size={12} /> View Set
                          </a>
                        )}
                        {q.status === 'pending' && (
                          <button onClick={() => deleteQueueItem(q.id)}
                            className="p-1 rounded text-cv-muted hover:text-red-400 hover:bg-red-600/10 transition-colors">
                            <Trash2 size={13} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {filteredQueue.length === 0 && (
                  <tr><td colSpan={6} className="py-6 text-center text-cv-muted text-xs">No items match filter</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {scrapeQueue.length === 0 && (
          <p className="text-xs text-cv-muted">No items in queue. Click "Load Queue" to add sets.</p>
        )}
      </div>

      {/* Load Queue Modal */}
      {showQueueLoad && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-cv-panel border border-cv-border rounded-2xl p-6 max-w-lg w-full mx-4 shadow-2xl">
            <h2 className="text-lg font-display font-bold text-cv-text mb-3">Load Scrape Queue</h2>
            <p className="text-xs text-cv-muted mb-3">Paste a JSON array of sets to scrape. Each item needs at minimum: year, brand, set_name.</p>
            <textarea
              value={queueJsonInput}
              onChange={e => setQueueJsonInput(e.target.value)}
              placeholder='[{"year": 2024, "brand": "Topps", "set_name": "Chrome"}]'
              rows={8}
              className="w-full bg-cv-dark border border-cv-border rounded-lg px-3 py-2 text-xs text-cv-text font-mono focus:border-cv-accent focus:outline-none resize-y mb-4"
            />
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => { setShowQueueLoad(false); setQueueJsonInput(''); }}
                className="px-4 py-2 rounded-lg text-sm font-medium bg-white/5 border border-cv-border/50 text-cv-muted hover:text-cv-text hover:bg-white/10 transition-all"
              >
                Cancel
              </button>
              <button
                onClick={submitQueueJson}
                disabled={!queueJsonInput.trim()}
                className="px-4 py-2 rounded-lg text-sm font-medium bg-cv-accent text-white hover:bg-cv-accent/80 disabled:opacity-50 transition-all"
              >
                Load
              </button>
            </div>
          </div>
        </div>
      )}

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

      {/* Scrape Preview Modal */}
      {showPreviewModal && previewItem && previewData && (
        <ScrapePreviewModal
          item={previewItem}
          data={previewData}
          onClose={() => { setShowPreviewModal(false); setPreviewItem(null); setPreviewData(null); }}
          onImport={importQueueItem}
          onSkip={skipQueueItem}
          onRescrape={rescrapeQueueItem}
          onEdit={handlePreviewEdit}
        />
      )}

      {/* Import Progress Modal */}
      {showImportModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-cv-panel border border-cv-border rounded-2xl p-6 max-w-lg w-full mx-4 shadow-2xl">
            <h2 className="text-lg font-display font-bold text-cv-text mb-1">
              {selectedSet?.name || 'Importing...'}
            </h2>

            <div className="flex items-center justify-between mb-4">
              <span className="text-xs font-semibold uppercase tracking-wider text-cv-accent">
                {importStatus?.phase === 'importing' && 'Scraping...'}
                {importStatus?.phase === 'merging' && 'Merging into CardVoice...'}
                {importStatus?.phase === 'done' && 'Import Complete'}
                {importStatus?.phase === 'error' && 'Import Failed'}
                {(!importStatus || importStatus.phase === 'idle') && 'Starting...'}
              </span>
              <span className="text-xs text-cv-muted font-mono">
                {formatElapsed(importStatus?.startedAt)}
              </span>
            </div>

            {importStatus?.progress?.total > 0 && (
              <div className="w-full h-1.5 bg-cv-border/50 rounded-full mb-4 overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-cv-accent to-cv-gold rounded-full transition-all duration-500"
                  style={{ width: `${Math.round((importStatus.progress.current / importStatus.progress.total) * 100)}%` }}
                />
              </div>
            )}

            {importStatus?.progress?.currentItem && importStatus.phase !== 'done' && importStatus.phase !== 'error' && (
              <div className="text-xs text-cv-text mb-3 truncate">{importStatus.progress.currentItem}</div>
            )}

            <div className="bg-cv-dark/80 rounded-lg border border-cv-border/30 p-3 h-48 overflow-y-auto font-mono text-[11px] leading-relaxed text-cv-muted mb-4">
              {importStatus?.log?.length > 0 ? (
                importStatus.log.map((line, i) => (
                  <div key={i} className={i === importStatus.log.length - 1 ? 'text-cv-text' : ''}>{line}</div>
                ))
              ) : (
                <div className="text-cv-muted/50">Waiting for scraper output...</div>
              )}
              <div ref={logEndRef} />
            </div>

            {importStatus?.phase === 'error' && importStatus.error && (
              <div className="mb-4 p-3 rounded-lg bg-red-900/20 border border-red-500/30 text-red-400 text-sm">
                {importStatus.error}
              </div>
            )}

            {importStatus?.phase === 'done' && importResult?.merge && !importResult.merge.skipped && (
              <div className="mb-4 p-3 rounded-lg bg-green-900/20 border border-green-500/30">
                <div className="flex items-center gap-2 mb-2">
                  <CheckCircle size={16} className="text-green-400" />
                  <span className="text-sm font-semibold text-green-400">Import Complete</span>
                </div>
                <div className="grid grid-cols-2 gap-1 text-xs">
                  <span className="text-cv-muted">Sets added:</span>
                  <span className="text-cv-text font-mono">{importResult.merge.sets?.added || 0}</span>
                  <span className="text-cv-muted">Cards added:</span>
                  <span className="text-cv-text font-mono">{importResult.merge.cards?.added || 0}</span>
                  <span className="text-cv-muted">Cards updated:</span>
                  <span className="text-cv-text font-mono">{importResult.merge.cards?.updated || 0}</span>
                  <span className="text-cv-muted">Insert types:</span>
                  <span className="text-cv-text font-mono">{importResult.merge.insertTypes?.added || 0}</span>
                  <span className="text-cv-muted">Parallels:</span>
                  <span className="text-cv-text font-mono">{importResult.merge.parallels?.added || 0}</span>
                </div>
              </div>
            )}

            {importStatus?.phase === 'done' && importResult?.merge?.skipped && (
              <div className="mb-4 p-3 rounded-lg bg-yellow-900/20 border border-yellow-500/30">
                <div className="flex items-center gap-2 mb-2">
                  <XCircle size={16} className="text-yellow-400" />
                  <span className="text-sm font-semibold text-yellow-400">Merge Skipped</span>
                </div>
                <div className="text-xs text-cv-muted">{importResult.merge.reason}</div>
              </div>
            )}

            <div className="flex gap-3">
              {importStatus?.running ? (
                <button
                  onClick={cancelImport}
                  className="flex-1 px-4 py-2.5 rounded-xl text-sm font-medium bg-red-500/10 border border-red-500/30 text-red-400 hover:bg-red-500/20 transition-all"
                >
                  Cancel Import
                </button>
              ) : (
                <button
                  onClick={() => setShowImportModal(false)}
                  className="flex-1 px-4 py-2.5 rounded-xl text-sm font-medium bg-white/5 border border-cv-border/50 text-cv-muted hover:text-cv-text hover:bg-white/10 transition-all"
                >
                  Close
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
