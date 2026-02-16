import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useBlocker } from 'react-router-dom';
import { Mic, MicOff, Trash2, Undo2, Download, Volume2, AlertCircle, Check, Plus, ChevronRight, Minus, Clock, Target, Zap } from 'lucide-react';
import axios from 'axios';

const API = import.meta.env.VITE_API_URL || 'http://localhost:8000';

const WORD_MAP = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15,
  sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
  twenty: 20, thirty: 30, forty: 40, fifty: 50,
  sixty: 60, seventy: 70, eighty: 80, ninety: 90,
  // Common misheard variants
  won: 1, wan: 1, wun: 1,
  to: 2, too: 2, tu: 2, tew: 2,
  tree: 3, free: 3,
  for: 4, fore: 4, fo: 4,
  fife: 5,
  sick: 6, sicks: 6,
  ate: 8,
  nein: 9,
  tin: 10,
  fourty: 40,
  fitty: 50,
  hundred: 100,
};

// ============================================================
// Context Inference + Correction Learning
// ============================================================

function inferDecade(entries) {
  if (entries.length < 2) return 0;
  const recent = entries.slice(-5).map(e => e.num);
  const decades = recent.map(n => Math.floor(n / 10) * 10);
  const freq = {};
  decades.forEach(d => { freq[d] = (freq[d] || 0) + 1; });
  const sorted = Object.entries(freq).sort((a, b) => b[1] - a[1]);
  if (sorted.length === 0) return 0;
  const [topDecade, topCount] = sorted[0];
  return topCount >= 2 && parseInt(topDecade) >= 10 ? parseInt(topDecade) : 0;
}

function inferFromContext(num, entries) {
  if (num >= 10 || entries.length < 2) return { num, inferred: false };

  // Check learned corrections first
  const decade = inferDecade(entries);
  if (decade >= 10) {
    const corrections = JSON.parse(localStorage.getItem('cardvoice_corrections') || '{}');
    const key = `${num}_${decade}`;
    if (corrections[key] && corrections[key].count >= 2) {
      return { num: corrections[key].corrected, inferred: true };
    }
  }

  // Statistical decade inference
  if (decade >= 10) {
    const corrected = decade + num;
    if (corrected <= 9999) return { num: corrected, inferred: true };
  }

  return { num, inferred: false };
}

const SKIP_WORDS = new Set(['and','the','a','an','um','uh','like','okay','ok','card','number','hash','pound','next','then','also','have','got','need','want','is','are','it','that','this','so','yeah','yes','no','not','with','from']);
const MULT_WORDS = new Set(['times','x','count','of','quantity','qty','stock','copies','copy','ex']);

function parseTokenNum(t) {
  if (t === undefined) return undefined;
  if (WORD_MAP[t] !== undefined) return WORD_MAP[t];
  if (/^\d+$/.test(t)) return parseInt(t);
  return undefined;
}

function parseSpokenNumbers(text, prevLastNum = null) {
  if (!text) return [];
  text = text.toLowerCase().replace(/[-]/g, ' ').replace(/[,.!?;:]/g, ' ').replace(/\s+/g, ' ').trim();
  const tokens = text.split(' ');
  const results = [];
  let lastNum = prevLastNum;
  let i = 0;
  while (i < tokens.length) {
    const t = tokens[i];
    if (SKIP_WORDS.has(t)) { i++; continue; }
    if (MULT_WORDS.has(t) && lastNum !== null && i + 1 < tokens.length) {
      const mult = parseInt(tokens[i+1]) || WORD_MAP[tokens[i+1]];
      if (mult && mult >= 1 && mult <= 50) { for (let m = 0; m < mult-1; m++) results.push(lastNum); i += 2; continue; }
    }
    if (/^\d+$/.test(t)) { const v = parseInt(t); if (v >= 1 && v <= 9999) { results.push(v); lastNum = v; } i++; continue; }
    if (WORD_MAP[t] !== undefined) {
      let val = WORD_MAP[t];
      if (val >= 1 && val <= 9 && tokens[i+1] === 'hundred') {
        val *= 100; i += 2;
        if (tokens[i] === 'and') i++;
        const nx = parseTokenNum(tokens[i]);
        if (nx !== undefined) { if (nx >= 1 && nx <= 19) { val += nx; i++; } else if (nx >= 20 && nx <= 90) { val += nx; i++; const ox = parseTokenNum(tokens[i]); if (ox !== undefined && ox >= 1 && ox <= 9) { val += ox; i++; } } }
        results.push(val); lastNum = val; continue;
      }
      if (val >= 20 && val <= 90) { const ones = parseTokenNum(tokens[i+1]); if (ones !== undefined && ones >= 1 && ones <= 9) { val += ones; i++; } }
      if (val >= 1 && val <= 9999) { results.push(val); lastNum = val; }
      i++; continue;
    }
    i++;
  }
  return results;
}

function useVoiceRecognition({ onResult }) {
  const [isListening, setIsListening] = useState(false);
  const [error, setError] = useState(null);
  const recRef = useRef(null);
  const activeRef = useRef(false);
  const start = useCallback(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { setError('Speech recognition not available'); return; }
    const rec = new SR(); rec.continuous = true; rec.interimResults = true; rec.lang = 'en-US'; rec.maxAlternatives = 3;
    rec.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const result = e.results[i];
        if (result.isFinal) {
          let bestTranscript = result[0].transcript;
          let bestNums = parseSpokenNumbers(bestTranscript);
          let bestScore = bestNums.reduce((s, n) => s + n, 0) || 0;
          for (let a = 1; a < result.length; a++) {
            const alt = result[a].transcript;
            const altNums = parseSpokenNumbers(alt);
            const altScore = altNums.reduce((s, n) => s + n, 0) || 0;
            if (altScore > bestScore) { bestScore = altScore; bestTranscript = alt; }
          }
          onResult(bestTranscript.trim(), true);
        } else {
          onResult(result[0].transcript.trim(), false);
        }
      }
    };
    rec.onerror = (e) => { if (e.error !== 'no-speech' && e.error !== 'aborted') setError(`Speech error: ${e.error}`); };
    rec.onend = () => { if (activeRef.current) { try { rec.start(); } catch(e){} } };
    recRef.current = rec; activeRef.current = true; setIsListening(true); setError(null); rec.start();
  }, [onResult]);
  const stop = useCallback(() => { activeRef.current = false; setIsListening(false); if (recRef.current) { recRef.current.abort(); recRef.current = null; } }, []);
  return { isListening, start, stop, error };
}

export default function VoiceEntry() {
  const { setId: urlSetId } = useParams();
  const [sets, setSets] = useState([]);
  const [selectedSetId, setSelectedSetId] = useState(urlSetId ? Number(urlSetId) : null);
  const [showCreateSet, setShowCreateSet] = useState(false);
  const [newSetName, setNewSetName] = useState('');
  const [prefix, setPrefix] = useState('');
  const [insertType, setInsertType] = useState('Base');
  const [parallel, setParallel] = useState('');
  const [metadata, setMetadata] = useState({ insertTypes: [], parallels: [] });
  const [currentEntries, setCurrentEntries] = useState([]); // [{id, num, qty, inferred}]
  const entryIdRef = useRef(0);
  const [liveText, setLiveText] = useState('');
  const [lastNumber, setLastNumber] = useState(null);
  const [manualInput, setManualInput] = useState('');
  const [committed, setCommitted] = useState([]);
  const [rawTranscripts, setRawTranscripts] = useState([]);
  const [saving, setSaving] = useState(false);

  // ---- Session stats tracking ----
  const sessionStartRef = useRef(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const statsRef = useRef({ totalEntriesAdded: 0, edits: 0, deletes: 0 });
  const [sessionActive, setSessionActive] = useState(false);

  // Ref keeps latest entries accessible inside callbacks without stale closures
  const currentEntriesRef = useRef(currentEntries);
  currentEntriesRef.current = currentEntries;

  // ---- Entry helpers ----
  const addNumbers = useCallback((nums) => {
    if (!nums || nums.length === 0) return;
    statsRef.current.totalEntriesAdded += nums.length;
    // Compute inferred last number BEFORE setState (safe under React 18 batching)
    // Uses ref snapshot — same entries the updater will see as `prev`
    const lastRaw = nums[nums.length - 1];
    const lastInferred = inferFromContext(lastRaw, currentEntriesRef.current);

    setCurrentEntries(prev => {
      let updated = prev.map(e => ({ ...e })); // deep-copy entries
      const counts = {};
      nums.forEach(n => {
        const result = inferFromContext(n, updated);
        const finalNum = result.num;
        counts[finalNum] = counts[finalNum] || { qty: 0, inferred: result.inferred };
        counts[finalNum].qty++;
      });
      for (const [numStr, info] of Object.entries(counts)) {
        const num = parseInt(numStr);
        const idx = updated.findIndex(e => e.num === num);
        if (idx >= 0) {
          updated[idx] = { ...updated[idx], qty: updated[idx].qty + info.qty, inferred: info.inferred || updated[idx].inferred };
        } else {
          updated.push({ id: ++entryIdRef.current, num, qty: info.qty, inferred: info.inferred });
        }
      }
      return updated;
    });
    setLastNumber(lastInferred.num);
  }, []);

  const updateEntry = useCallback((id, field, value) => {
    setCurrentEntries(prev => prev.map(e => e.id === id ? { ...e, [field]: value } : e));
  }, []);

  const deleteEntry = useCallback((id) => {
    statsRef.current.deletes++;
    setCurrentEntries(prev => prev.filter(e => e.id !== id));
  }, []);

  const handleNumEdit = useCallback((id, oldNum, newNum) => {
    if (oldNum === newNum || isNaN(newNum) || newNum < 1) return;
    if (typeof oldNum !== 'number' || oldNum < 1) {
      // Old value was empty/invalid — just set, don't log correction
      updateEntry(id, 'num', newNum);
      return;
    }
    statsRef.current.edits++;
    updateEntry(id, 'num', newNum);
    // Log correction for learning (read current state via ref, not setter)
    const entries = currentEntriesRef.current;
    const decade = inferDecade(entries);
    if (decade >= 10 && oldNum < 10) {
      const key = `${oldNum}_${decade}`;
      const corrections = JSON.parse(localStorage.getItem('cardvoice_corrections') || '{}');
      corrections[key] = corrections[key] || { corrected: newNum, count: 0 };
      corrections[key].corrected = newNum;
      corrections[key].count++;
      localStorage.setItem('cardvoice_corrections', JSON.stringify(corrections));
    }
  }, [updateEntry]);

  // Clear inferred flags after 3 seconds
  useEffect(() => {
    const hasInferred = currentEntries.some(e => e.inferred);
    if (!hasInferred) return;
    const timer = setTimeout(() => {
      setCurrentEntries(prev => prev.map(e => e.inferred ? { ...e, inferred: false } : e));
    }, 3000);
    return () => clearTimeout(timer);
  }, [currentEntries]);

  // Warn before losing unsaved work (browser refresh / tab close)
  const hasUnsaved = currentEntries.length > 0 || committed.length > 0;
  useEffect(() => {
    if (!hasUnsaved) return;
    const handler = (e) => { e.preventDefault(); };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [hasUnsaved]);

  // Block in-app navigation when there's unsaved data
  useBlocker(({ currentLocation, nextLocation }) =>
    hasUnsaved && currentLocation.pathname !== nextLocation.pathname &&
    !window.confirm('You have unsaved card data. Leave anyway?')
  );

  // Session timer — ticks every second while active
  useEffect(() => {
    if (!sessionActive) return;
    const interval = setInterval(() => {
      if (sessionStartRef.current) setElapsedSeconds(Math.floor((Date.now() - sessionStartRef.current) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [sessionActive]);

  useEffect(() => { axios.get(`${API}/api/sets`).then(r => setSets(r.data)).catch(() => {}); }, []);

  // Fetch set metadata when set changes
  useEffect(() => {
    if (!selectedSetId) { setMetadata({ insertTypes: [], parallels: [] }); return; }
    axios.get(`${API}/api/sets/${selectedSetId}/metadata`)
      .then(r => {
        setMetadata(r.data);
        if (r.data.insertTypes.length > 0) {
          const base = r.data.insertTypes.find(t => t.name === 'Base' || t.name === 'Base Set' || t.name.toLowerCase().includes('base'));
          setInsertType(base ? base.name : r.data.insertTypes[0].name);
        }
      })
      .catch(() => setMetadata({ insertTypes: [], parallels: [] }));
  }, [selectedSetId]);

  const createSet = async () => {
    if (!newSetName.trim()) return;
    try {
      const res = await axios.post(`${API}/api/sets`, { name: newSetName.trim(), sport: 'Baseball' });
      setSets(prev => [...prev, res.data]); setSelectedSetId(res.data.id); setNewSetName(''); setShowCreateSet(false);
    } catch (err) { alert(err.response?.data?.detail || 'Failed'); }
  };

  const handleVoiceResult = useCallback((text, isFinal) => {
    setLiveText(text);
    if (isFinal) {
      setRawTranscripts(p => [...p, text]);
      // If text contains "card", try to auto-apply quantities via API
      if (text.toLowerCase().includes('card') && selectedSetId) {
        axios.put(`${API}/api/sets/${selectedSetId}/voice-qty`, { text, insert_type: insertType })
          .then(res => {
            if (res.data.parsed_pairs && res.data.parsed_pairs.length > 0) {
              let allNums = [];
              res.data.parsed_pairs.forEach(pair => {
                for (let i = 0; i < pair.qty; i++) allNums.push(pair.card);
              });
              addNumbers(allNums);
            }
          })
          .catch(() => {});
      } else {
        const nums = parseSpokenNumbers(text, lastNumber);
        if (nums.length > 0) addNumbers(nums);
      }
    }
  }, [selectedSetId, insertType, lastNumber, addNumbers]);

  const { isListening, start, stop, error } = useVoiceRecognition({ onResult: handleVoiceResult });

  const handleManualSubmit = (e) => { e.preventDefault(); const nums = parseSpokenNumbers(manualInput); if (nums.length > 0) { addNumbers(nums); setManualInput(''); } };

  const commitBatch = () => {
    const valid = currentEntries.filter(e => typeof e.num === 'number' && e.num >= 1 && e.qty >= 1);
    if (valid.length === 0) return;
    const entries = valid.map(e => ({ num: prefix ? `${prefix}${e.num}` : String(e.num), qty: e.qty }));
    setCommitted(prev => [...prev, { insertType, parallel, prefix, entries, timestamp: new Date().toLocaleTimeString(), heard: rawTranscripts.join(' | ') }]);
    setCurrentEntries([]); setLastNumber(null); setLiveText(''); setRawTranscripts([]);
  };

  const undoLast = () => { if (currentEntries.length > 0) statsRef.current.deletes++; setCurrentEntries(p => p.length > 0 ? p.slice(0, -1) : p); };
  const clearCurrent = () => { setCurrentEntries([]); setLastNumber(null); setLiveText(''); };
  const removeCommitted = (idx) => { setCommitted(p => p.filter((_, i) => i !== idx)); };

  const csvField = (val) => {
    const s = String(val ?? '');
    return (s.includes(',') || s.includes('"') || s.includes('\n')) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };

  const exportData = () => {
    if (committed.length === 0) return;
    let csv = 'Card #,Insert Type,Parallel,Qty\n';
    committed.forEach(batch => { batch.entries.forEach(e => { csv += `${csvField(e.num)},${csvField(batch.insertType)},${csvField(batch.parallel)},${e.qty}\n`; }); });
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url;
    a.download = `${sets.find(s => s.id === selectedSetId)?.name || 'cardvoice'}_export.csv`;
    a.click();
  };

  const saveToSet = async () => {
    if (!selectedSetId || committed.length === 0 || saving) return;
    setSaving(true);
    const allCards = [];
    committed.forEach(batch => { batch.entries.forEach(e => { allCards.push({ card_number: e.num, player: '', team: '', rc_sp: '', insert_type: batch.insertType, parallel: batch.parallel, qty: e.qty }); }); });
    try {
      await axios.post(`${API}/api/sets/${selectedSetId}/cards`, { cards: allCards });
      // Persist session stats
      if (sessionStartRef.current) {
        const duration = Math.floor((Date.now() - sessionStartRef.current) / 1000);
        axios.post(`${API}/api/voice-sessions`, {
          set_id: selectedSetId,
          duration_seconds: duration,
          total_entries: statsRef.current.totalEntriesAdded,
          total_cards: totalCommitted,
          edits: statsRef.current.edits,
          deletes: statsRef.current.deletes,
          accuracy_pct: accuracyPct,
          cards_per_min: parseFloat(cardsPerMinute),
          insert_type_filter: insertType,
        }).catch(() => {});
        sessionStartRef.current = null; setSessionActive(false); setElapsedSeconds(0);
        statsRef.current = { totalEntriesAdded: 0, edits: 0, deletes: 0 };
      }
      const totalQty = allCards.reduce((s, c) => s + c.qty, 0);
      alert(`Saved ${totalQty} cards (${allCards.length} unique) across ${committed.length} batch${committed.length !== 1 ? 'es' : ''}!`);
      setCommitted([]);
    } catch (err) { alert('Save failed'); } finally { setSaving(false); }
  };

  const totalCurrentCards = currentEntries.reduce((s, e) => s + e.qty, 0);
  const totalCommitted = committed.reduce((s, b) => s + b.entries.reduce((s2, e) => s2 + e.qty, 0), 0);
  const selectedSetObj = sets.find(s => s.id === selectedSetId);
  const selectedSetName = selectedSetObj?.name || '';
  const selectedSetYear = selectedSetObj?.year;

  // Derived session stats
  const allCardsThisSession = totalCurrentCards + totalCommitted;
  const cardsPerMinute = elapsedSeconds > 0 ? ((allCardsThisSession) * 60 / elapsedSeconds).toFixed(1) : '0.0';
  const totalErrors = statsRef.current.edits + statsRef.current.deletes;
  const totalActions = statsRef.current.totalEntriesAdded + totalErrors;
  const accuracyPct = totalActions > 0 ? Math.round(((totalActions - totalErrors) / totalActions) * 100) : 100;
  const formatTime = (secs) => { const m = Math.floor(secs / 60); const s = secs % 60; return `${m}:${s.toString().padStart(2, '0')}`; };

  return (
    <div className="w-full">
      {/* CONFIG BAR */}
      <div className="bg-cv-panel rounded-xl border border-cv-border p-4 mb-4">
        <div className="grid grid-cols-12 gap-3 items-end">
          <div className="col-span-3">
            <label className="text-xs text-cv-muted uppercase tracking-wider font-semibold block mb-1">Active Set</label>
            <div className="flex gap-2">
              <select value={selectedSetId || ''} onChange={e => setSelectedSetId(e.target.value ? Number(e.target.value) : null)}
                className="flex-1 bg-cv-dark border border-cv-border rounded-lg px-3 py-2 text-sm text-cv-text focus:border-cv-accent focus:outline-none">
                <option value="">-- Select or Create --</option>
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
              <button onClick={() => setShowCreateSet(!showCreateSet)} className="p-2 rounded-lg bg-cv-accent/20 text-cv-accent border border-cv-accent/40 hover:bg-cv-accent/30"><Plus size={16} /></button>
            </div>
            {showCreateSet && (
              <div className="flex gap-2 mt-2">
                <input type="text" value={newSetName} onChange={e => setNewSetName(e.target.value)} placeholder="e.g., 2022 Topps" autoFocus onKeyDown={e => e.key === 'Enter' && createSet()}
                  className="flex-1 bg-cv-dark border border-cv-border rounded-lg px-3 py-2 text-sm text-cv-text focus:border-cv-accent focus:outline-none" />
                <button onClick={createSet} className="px-3 py-2 rounded-lg text-sm bg-cv-accent text-cv-dark font-medium">Create</button>
              </div>
            )}
          </div>
          <div className="col-span-2">
            <label className="text-xs text-cv-muted uppercase tracking-wider font-semibold block mb-1">Card # Prefix</label>
            <input type="text" value={prefix} onChange={e => setPrefix(e.target.value)} placeholder="BP-  GUHT-  US"
              className="w-full bg-cv-dark border border-cv-border rounded-lg px-3 py-2 text-sm text-cv-text font-mono focus:border-cv-accent focus:outline-none" />
          </div>
          <div className="col-span-3">
            <label className="text-xs text-cv-muted uppercase tracking-wider font-semibold block mb-1">Insert Type</label>
            {metadata.insertTypes.length > 0 ? (
              <select value={insertType} onChange={e => setInsertType(e.target.value)}
                className="w-full bg-cv-dark border border-cv-border rounded-lg px-3 py-2 text-sm text-cv-text focus:border-cv-accent focus:outline-none">
                {metadata.insertTypes.map(t => {
                  const prefix = t.section_type && t.section_type !== 'base'
                    ? `[${t.section_type === 'autograph' ? 'A' : t.section_type === 'relic' ? 'R' : 'I'}] ` : '';
                  return (
                    <option key={t.name} value={t.name}>{prefix}{t.name}{t.card_count ? ` (${t.card_count})` : ''}</option>
                  );
                })}
              </select>
            ) : (
              <input type="text" value={insertType} onChange={e => setInsertType(e.target.value)} placeholder="Base, Prospects, Rated Prospect"
                className="w-full bg-cv-dark border border-cv-border rounded-lg px-3 py-2 text-sm text-cv-text focus:border-cv-accent focus:outline-none" />
            )}
          </div>
          <div className="col-span-4">
            <label className="text-xs text-cv-muted uppercase tracking-wider font-semibold block mb-1">Parallel</label>
            {metadata.parallels.length > 0 ? (
              <select value={parallel} onChange={e => setParallel(e.target.value)}
                className="w-full bg-cv-dark border border-cv-border rounded-lg px-3 py-2 text-sm text-cv-text focus:border-cv-accent focus:outline-none">
                <option value="">Base</option>
                {metadata.parallels.map(p => (
                  <option key={p.name} value={p.name}>
                    {p.name}{p.print_run ? ` /${p.print_run}` : ''}{p.exclusive ? ` (${p.exclusive})` : ''}
                  </option>
                ))}
              </select>
            ) : (
              <input type="text" value={parallel} onChange={e => setParallel(e.target.value)} placeholder="(blank = base)  Gold  Blue /150  Refractor"
                className="w-full bg-cv-dark border border-cv-border rounded-lg px-3 py-2 text-sm text-cv-text focus:border-cv-accent focus:outline-none" />
            )}
          </div>
        </div>
        <div className="mt-3 px-3 py-2 bg-cv-dark rounded-lg flex items-center gap-2 text-sm">
          {!selectedSetId ? (
            <span className="text-cv-red">Select a set from the dropdown above to begin</span>
          ) : (
            <>
              <span className="text-cv-muted">Recording as:</span>
              {selectedSetYear && <span className="text-cv-yellow font-mono font-semibold text-xs mr-1">{selectedSetYear}</span>}
              {selectedSetName && <><span className="text-cv-accent font-semibold">{selectedSetName}</span><ChevronRight size={14} className="text-cv-muted" /></>}
              <span className="text-cv-text">{insertType || 'Base'}</span>
              {parallel && <><ChevronRight size={14} className="text-cv-muted" /><span className="text-cv-yellow">{parallel}</span></>}
              {prefix && <><span className="text-cv-muted ml-2">|</span><span className="text-cv-muted">Prefix:</span><span className="text-cv-text font-mono">{prefix}</span></>}
            </>
          )}
        </div>
      </div>

      <div className="grid grid-cols-12 gap-4">
        {/* LEFT: Voice + Numbers */}
        <div className="col-span-7 space-y-4">
          <div className="bg-cv-panel rounded-xl border border-cv-border p-6">
            <div className="flex items-center gap-6">
              <button onClick={() => {
                  if (isListening) { stop(); } else {
                    start();
                    if (!sessionStartRef.current) { sessionStartRef.current = Date.now(); setSessionActive(true); }
                  }
                }} disabled={!selectedSetId}
                className={`relative w-20 h-20 rounded-full flex items-center justify-center transition-all flex-shrink-0 ${!selectedSetId ? 'bg-cv-muted/30 text-cv-muted cursor-not-allowed' : isListening ? 'bg-cv-red text-white recording-pulse shadow-lg shadow-red-500/30' : 'bg-cv-accent text-cv-dark hover:scale-105 shadow-lg shadow-emerald-500/20'}`}
                title={!selectedSetId ? 'Select a set first' : ''}>
                {isListening ? <MicOff size={32} /> : <Mic size={32} />}
              </button>
              <div className="flex-1 text-center min-h-[80px] flex flex-col items-center justify-center">
                {lastNumber ? (
                  <div key={lastNumber + '-' + totalCurrentCards} className="number-flash">
                    <div className="text-6xl font-mono font-black text-cv-text">
                      {prefix && <span className="text-cv-muted text-4xl">{prefix}</span>}{lastNumber}
                    </div>
                  </div>
                ) : (<div className="text-cv-muted">{isListening ? 'Listening... say card numbers' : 'Press mic and speak'}</div>)}
              </div>
              <button onClick={commitBatch} disabled={currentEntries.length === 0}
                className="w-20 h-20 rounded-full flex flex-col items-center justify-center bg-cv-accent/20 border-2 border-cv-accent/50 text-cv-accent hover:bg-cv-accent/30 disabled:opacity-20 disabled:border-cv-border transition-all flex-shrink-0">
                <Check size={28} /><span className="text-[10px] mt-0.5 font-semibold">COMMIT</span>
              </button>
            </div>
            {liveText && <div className="mt-4 bg-cv-dark rounded-lg p-2 border border-cv-border"><div className="flex items-center gap-2"><Volume2 size={12} className="text-cv-accent" /><span className="text-xs text-cv-muted">Live:</span><span className="text-sm text-cv-text/70 font-mono">{liveText}</span></div></div>}
            {error && <div className="mt-3 bg-cv-red/10 border border-cv-red/30 rounded-lg p-2 flex items-center gap-2"><AlertCircle size={14} className="text-cv-red" /><span className="text-sm text-cv-red">{error}</span></div>}
          </div>

          {sessionActive && (
            <div className="bg-cv-panel rounded-xl border border-cv-border p-3 flex items-center justify-between gap-4">
              <div className="flex items-center gap-2">
                <Clock size={14} className="text-cv-accent" />
                <span className="text-sm font-mono text-cv-text">{formatTime(elapsedSeconds)}</span>
              </div>
              <div className="flex items-center gap-2">
                <Zap size={14} className="text-cv-yellow" />
                <span className="text-sm font-mono text-cv-text">{cardsPerMinute}</span>
                <span className="text-xs text-cv-muted">cards/min</span>
              </div>
              <div className="flex items-center gap-2">
                <Target size={14} className="text-cv-accent" />
                <span className="text-sm font-mono text-cv-text">{accuracyPct}%</span>
                <span className="text-xs text-cv-muted">accuracy</span>
              </div>
              {totalErrors > 0 && (
                <div className="flex items-center gap-1">
                  <span className="text-xs text-cv-muted">{totalErrors} correction{totalErrors !== 1 ? 's' : ''}</span>
                </div>
              )}
            </div>
          )}

          <form onSubmit={handleManualSubmit} className="flex gap-2">
            <input type="text" value={manualInput} onChange={e => setManualInput(e.target.value)} placeholder="Type numbers: 42 55 103 times 2..."
              className="flex-1 bg-cv-dark border border-cv-border rounded-lg px-4 py-2.5 text-sm text-cv-text placeholder:text-cv-muted/50 focus:border-cv-accent focus:outline-none font-mono" />
            <button type="submit" className="px-4 py-2.5 bg-cv-panel border border-cv-border rounded-lg text-cv-text text-sm hover:border-cv-accent/50">Add</button>
          </form>

          <div className="bg-cv-panel rounded-xl border border-cv-border p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-3">
                <label className="text-xs text-cv-muted uppercase tracking-wider font-semibold">Current Batch</label>
                <span className="text-xs text-cv-accent font-mono">{currentEntries.length} unique · {totalCurrentCards} total</span>
              </div>
              <div className="flex gap-2">
                <button onClick={undoLast} disabled={currentEntries.length === 0} className="flex items-center gap-1 px-2 py-1 rounded text-xs text-cv-muted hover:text-cv-text disabled:opacity-30"><Undo2 size={12} /> Undo</button>
                <button onClick={clearCurrent} disabled={currentEntries.length === 0} className="flex items-center gap-1 px-2 py-1 rounded text-xs text-cv-red hover:text-cv-red/80 disabled:opacity-30"><Trash2 size={12} /> Clear</button>
              </div>
            </div>
            <div className="max-h-[200px] overflow-y-auto space-y-1">
              {currentEntries.length === 0 && <span className="text-cv-muted text-sm block text-center py-4">No numbers yet - speak or type to add</span>}
              {[...currentEntries].reverse().map(entry => (
                <div key={entry.id} className={`flex items-center gap-2 px-2 py-1.5 rounded transition-colors ${entry.inferred ? 'bg-cv-yellow/10 border border-cv-yellow/30' : 'bg-cv-dark border border-cv-border'}`}>
                  {prefix && <span className="text-cv-muted text-xs font-mono">{prefix}</span>}
                  <input
                    type="text"
                    value={entry.num}
                    onChange={e => {
                      const raw = e.target.value;
                      if (raw === '') { updateEntry(entry.id, 'num', ''); return; }
                      const v = parseInt(raw);
                      if (!isNaN(v)) handleNumEdit(entry.id, entry.num, v);
                    }}
                    className="w-20 bg-transparent border-b border-cv-border/50 text-cv-text font-mono text-sm text-center focus:border-cv-accent focus:outline-none py-0.5"
                  />
                  <div className="flex items-center gap-1 ml-auto">
                    <button onClick={() => updateEntry(entry.id, 'qty', Math.max(1, entry.qty - 1))}
                      className="w-6 h-6 rounded flex items-center justify-center text-cv-muted hover:text-cv-text hover:bg-cv-border/30">
                      <Minus size={12} />
                    </button>
                    <span className="text-sm font-mono text-cv-yellow w-6 text-center">{entry.qty}</span>
                    <button onClick={() => updateEntry(entry.id, 'qty', entry.qty + 1)}
                      className="w-6 h-6 rounded flex items-center justify-center text-cv-muted hover:text-cv-text hover:bg-cv-border/30">
                      <Plus size={12} />
                    </button>
                  </div>
                  {entry.inferred && <span className="text-[9px] text-cv-yellow font-semibold uppercase tracking-wider">inferred</span>}
                  <button onClick={() => deleteEntry(entry.id)}
                    className="w-6 h-6 rounded flex items-center justify-center text-cv-muted hover:text-cv-red ml-1">
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* RIGHT: Committed */}
        <div className="col-span-5">
          <div className="bg-cv-panel rounded-xl border border-cv-border p-4">
            <div className="flex items-center justify-between mb-3">
              <div>
                <label className="text-xs text-cv-muted uppercase tracking-wider font-semibold">Committed Entries</label>
                <div className="text-xs text-cv-accent mt-0.5">{committed.length} batches · {totalCommitted} total cards</div>
              </div>
              <div className="flex gap-2">
                <button onClick={saveToSet} disabled={committed.length === 0 || !selectedSetId || saving}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs bg-cv-accent/20 border border-cv-accent/40 text-cv-accent hover:bg-cv-accent/30 disabled:opacity-30 transition-all">
                  <Check size={12} /> {saving ? 'Saving...' : 'Save to Set'}
                </button>
                <button onClick={exportData} disabled={committed.length === 0}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs bg-cv-dark border border-cv-border text-cv-text hover:border-cv-accent/50 disabled:opacity-30 transition-all">
                  <Download size={12} /> Export CSV
                </button>
              </div>
            </div>
            <div className="space-y-2 max-h-[500px] overflow-y-auto">
              {committed.length === 0 && (
                <div className="text-cv-muted text-sm text-center py-8">
                  Speak numbers then hit <span className="text-cv-accent font-semibold">COMMIT</span><br/>
                  <span className="text-xs mt-2 block">Change Insert Type / Parallel between commits<br/>to log different card types</span>
                </div>
              )}
              {committed.map((batch, idx) => (
                <div key={idx} className="bg-cv-dark rounded-lg border border-cv-border p-3">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2 text-xs">
                      <span className="text-cv-text font-semibold">{batch.insertType}</span>
                      {batch.parallel && <><ChevronRight size={10} className="text-cv-muted" /><span className="text-cv-yellow">{batch.parallel}</span></>}
                      {batch.prefix && <span className="text-cv-muted font-mono ml-1">({batch.prefix}*)</span>}
                      <span className="text-cv-muted">· {batch.timestamp}</span>
                    </div>
                    <button onClick={() => removeCommitted(idx)} className="text-cv-muted hover:text-cv-red p-1"><Trash2 size={12} /></button>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {batch.entries.map((entry, j) => (
                      <span key={j} className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-cv-panel text-xs font-mono">
                        <span className="text-cv-text">{entry.num}</span>
                        {entry.qty > 1 && <span className="text-cv-yellow">x{entry.qty}</span>}
                      </span>
                    ))}
                  </div>
                  <div className="text-xs text-cv-muted mt-1">{batch.entries.length} unique · {batch.entries.reduce((s, e) => s + e.qty, 0)} total</div>
                  {batch.heard && <div className="text-[10px] text-cv-muted/60 mt-1 truncate" title={batch.heard}>Heard: {batch.heard}</div>}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
