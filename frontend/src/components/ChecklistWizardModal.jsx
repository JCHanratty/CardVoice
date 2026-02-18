import React, { useState, useEffect } from 'react';
import { X, Loader2, ChevronDown, CheckCircle, AlertTriangle, Pencil, Trash2 } from 'lucide-react';
import axios from 'axios';

const API = import.meta.env.VITE_API_URL || 'http://localhost:8000';

const SECTION_TYPE_COLORS = {
  base:      'text-cv-accent bg-cv-accent/10 border border-cv-accent/30',
  autograph: 'text-cv-gold bg-cv-gold/10 border border-cv-gold/30',
  relic:     'text-emerald-400 bg-emerald-400/10 border border-emerald-400/30',
  insert:    'text-cv-accent2 bg-cv-accent2/10 border border-cv-accent2/30',
};

const EMPTY_SECTION = {
  name: '',
  declaredCount: '',
  parallelsRaw: '',
  cardsRaw: '',
  parsed: null,
  parseError: null,
  autoAccepted: false,
};

export default function ChecklistWizardModal({ open, onOpenChange, setId, setName, onComplete }) {
  const [currentSection, setCurrentSection] = useState({ ...EMPTY_SECTION });
  const [sections, setSections] = useState([]);
  const [viewMode, setViewMode] = useState('edit');
  const [editingIndex, setEditingIndex] = useState(null);
  const [parsing, setParsing] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [commitResult, setCommitResult] = useState(null);
  const [expandedPreview, setExpandedPreview] = useState(false);

  // Reset state when modal opens
  useEffect(() => {
    if (open) {
      setCurrentSection({ ...EMPTY_SECTION });
      setSections([]);
      setViewMode('edit');
      setEditingIndex(null);
      setCommitResult(null);
    }
  }, [open]);

  if (!open) return null;

  const close = () => onOpenChange(false);

  // Build text blob from structured fields for the parser
  const buildTextBlob = () => {
    let text = '';
    if (currentSection.name) text += `${currentSection.name} Checklist\n`;
    if (currentSection.declaredCount) text += `${currentSection.declaredCount} cards.\n`;
    if (currentSection.parallelsRaw.trim()) {
      const raw = currentSection.parallelsRaw.trim();
      if (raw.includes('\n')) {
        const items = raw.split('\n').map(l => l.trim()).filter(Boolean);
        text += `Parallels: ${items.join('; ')}\n`;
      } else {
        text += `Parallels: ${raw}\n`;
      }
    }
    text += currentSection.cardsRaw;
    return text;
  };

  const handleParse = async () => {
    if (!currentSection.name.trim()) {
      setCurrentSection(prev => ({ ...prev, parseError: 'Section name is required' }));
      return;
    }
    if (!currentSection.cardsRaw.trim()) {
      setCurrentSection(prev => ({ ...prev, parseError: 'Card data is required' }));
      return;
    }

    setParsing(true);
    setCurrentSection(prev => ({ ...prev, parseError: null, parsed: null }));

    try {
      const text = buildTextBlob();
      const res = await axios.post(`${API}/api/parse-checklist`, { text });
      const result = res.data;

      const parsedSection = result.sections?.[0];
      if (!parsedSection || (!parsedSection.cards?.length && !parsedSection.parallels?.length)) {
        setCurrentSection(prev => ({ ...prev, parseError: 'Parser returned no cards or parallels. Check your input format.' }));
        setParsing(false);
        return;
      }

      parsedSection.name = currentSection.name.trim();

      const updated = { ...currentSection, parsed: parsedSection, parseError: null };

      const declared = parseInt(currentSection.declaredCount);
      const actual = parsedSection.cards?.length || 0;
      if (declared > 0 && declared === actual) {
        updated.autoAccepted = true;
        if (editingIndex !== null) {
          setSections(prev => prev.map((s, i) => i === editingIndex ? updated : s));
          setEditingIndex(null);
        } else {
          setSections(prev => [...prev, updated]);
        }
        setCurrentSection({ ...EMPTY_SECTION });
        setViewMode('edit');
      } else {
        setCurrentSection(updated);
        setViewMode('preview');
      }
    } catch (err) {
      setCurrentSection(prev => ({
        ...prev,
        parseError: err.response?.data?.detail || 'Parse failed: ' + err.message,
      }));
    }
    setParsing(false);
  };

  const handleAddSection = () => {
    if (!currentSection.parsed) return;
    if (editingIndex !== null) {
      setSections(prev => prev.map((s, i) => i === editingIndex ? currentSection : s));
      setEditingIndex(null);
    } else {
      setSections(prev => [...prev, currentSection]);
    }
    setCurrentSection({ ...EMPTY_SECTION });
    setViewMode('edit');
  };

  const handleEditSection = (index) => {
    setCurrentSection(sections[index]);
    setEditingIndex(index);
    setViewMode('edit');
  };

  const handleDeleteSection = (index) => {
    setSections(prev => prev.filter((_, i) => i !== index));
    if (editingIndex === index) {
      setEditingIndex(null);
      setCurrentSection({ ...EMPTY_SECTION });
      setViewMode('edit');
    }
  };

  const handleFinish = async () => {
    const allSections = [...sections];
    if (currentSection.parsed && viewMode === 'preview') {
      allSections.push(currentSection);
    }

    if (allSections.length === 0) return;

    setCommitting(true);
    try {
      const payload = {
        sections: allSections.map(s => s.parsed),
      };
      const res = await axios.post(`${API}/api/sets/${setId}/import-checklist`, payload);
      setCommitResult(res.data);
      setTimeout(() => {
        onComplete();
      }, 1500);
    } catch (err) {
      alert('Import failed: ' + (err.response?.data?.detail || err.message));
    }
    setCommitting(false);
  };

  const totalCards = sections.reduce((acc, s) => acc + (s.parsed?.cards?.length || 0), 0);
  const totalParallels = sections.reduce((acc, s) => acc + (s.parsed?.parallels?.length || 0), 0);

  const parsedSection = currentSection.parsed;
  const declared = parseInt(currentSection.declaredCount);
  const actual = parsedSection?.cards?.length || 0;
  const countsMatch = declared > 0 && declared === actual;

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={close}>
      <div className="bg-cv-panel border border-cv-border rounded-xl w-full max-w-5xl max-h-[90vh] flex flex-col"
        onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-cv-border">
          <div>
            <h3 className="text-lg font-display font-semibold text-cv-text">Add Checklist Sections</h3>
            <p className="text-xs text-cv-muted mt-0.5">Adding to: <span className="text-cv-accent">{setName}</span></p>
          </div>
          <button onClick={close} className="p-1.5 rounded-lg text-cv-muted hover:text-cv-text hover:bg-cv-dark transition-all">
            <X size={18} />
          </button>
        </div>

        {/* Success overlay */}
        {commitResult && (
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
            <CheckCircle size={48} className="text-cv-accent mb-4" />
            <h3 className="text-xl font-display font-semibold text-cv-text mb-2">Checklist Saved</h3>
            <p className="text-sm text-cv-muted">
              {commitResult.imported} cards added, {commitResult.updated} updated, {commitResult.parallels_added} parallels
            </p>
          </div>
        )}

        {/* Two-pane body */}
        {!commitResult && (
          <div className="flex flex-1 overflow-hidden">
            {/* Sidebar */}
            <div className="w-64 flex-shrink-0 border-r border-cv-border p-4 overflow-y-auto flex flex-col">
              <div className="text-xs text-cv-muted uppercase tracking-wider font-semibold mb-3">
                Sections Added ({sections.length})
              </div>

              {sections.length === 0 ? (
                <div className="text-xs text-cv-muted/60 italic">No sections added yet</div>
              ) : (
                <div className="space-y-2 flex-1 overflow-y-auto">
                  {sections.map((s, i) => {
                    const sType = s.parsed?.sectionType || 'base';
                    const colorClass = SECTION_TYPE_COLORS[sType] || SECTION_TYPE_COLORS.insert;
                    return (
                      <div key={i} className={`rounded-lg border p-3 ${
                        editingIndex === i
                          ? 'border-dashed border-cv-accent/50 bg-cv-accent/5'
                          : 'border-cv-border bg-cv-dark'
                      }`}>
                        <div className="flex items-center gap-2 mb-1">
                          <span className={`text-xs px-1.5 py-0.5 rounded font-semibold uppercase ${colorClass}`}>
                            {sType}
                          </span>
                          <span className="text-sm text-cv-text font-medium truncate flex-1">{s.name}</span>
                        </div>
                        <div className="text-xs text-cv-muted space-y-0.5">
                          <div>{s.parsed?.cards?.length || 0} cards</div>
                          {(s.parsed?.parallels?.length || 0) > 0 && (
                            <div className="text-cv-gold">{s.parsed.parallels.length} parallel(s)</div>
                          )}
                          {s.autoAccepted && (
                            <div className="text-cv-accent flex items-center gap-1">
                              <CheckCircle size={10} /> Auto-accepted
                            </div>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5 mt-2">
                          <button onClick={() => handleEditSection(i)}
                            className="p-1 rounded text-cv-muted hover:text-cv-text hover:bg-cv-panel transition-all">
                            <Pencil size={12} />
                          </button>
                          <button onClick={() => handleDeleteSection(i)}
                            className="p-1 rounded text-cv-muted hover:text-cv-red hover:bg-cv-red/10 transition-all">
                            <Trash2 size={12} />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Totals */}
              {sections.length > 0 && (
                <div className="border-t border-cv-border pt-3 mt-3 space-y-1">
                  <div className="text-xs text-cv-muted">
                    Total Cards: <span className="text-cv-text font-mono font-semibold">{totalCards}</span>
                  </div>
                  <div className="text-xs text-cv-muted">
                    Total Parallels: <span className="text-cv-gold font-mono font-semibold">{totalParallels}</span>
                  </div>
                </div>
              )}
            </div>

            {/* Main area */}
            <div className="flex-1 overflow-y-auto p-5">
              {viewMode === 'edit' ? (
                /* ===== EDIT MODE ===== */
                <div className="space-y-4">
                  <div className="grid grid-cols-3 gap-4">
                    <div className="col-span-2">
                      <label className="text-xs text-cv-muted uppercase tracking-wider font-semibold block mb-1">Section Name</label>
                      <input type="text" value={currentSection.name}
                        onChange={e => setCurrentSection(prev => ({ ...prev, name: e.target.value }))}
                        placeholder="e.g., Base Set, Autographs, Future Stars"
                        className="w-full bg-cv-dark border border-cv-border rounded-lg px-3 py-2 text-sm text-cv-text focus:border-cv-accent focus:outline-none" />
                    </div>
                    <div>
                      <label className="text-xs text-cv-muted uppercase tracking-wider font-semibold block mb-1">Card Count</label>
                      <input type="number" min="1" value={currentSection.declaredCount}
                        onChange={e => setCurrentSection(prev => ({ ...prev, declaredCount: e.target.value }))}
                        placeholder="e.g., 350"
                        className="w-full bg-cv-dark border border-cv-border rounded-lg px-3 py-2 text-sm text-cv-text focus:border-cv-accent focus:outline-none" />
                      <div className="text-xs text-cv-muted/60 mt-1">Auto-accepts if count matches</div>
                    </div>
                  </div>

                  <div>
                    <label className="text-xs text-cv-muted uppercase tracking-wider font-semibold block mb-1">
                      Parallels <span className="normal-case text-cv-muted/60">(one per line or separated by ;)</span>
                    </label>
                    <textarea rows={4} value={currentSection.parallelsRaw}
                      onChange={e => setCurrentSection(prev => ({ ...prev, parallelsRaw: e.target.value }))}
                      placeholder={"Gold /50\nSilver /100\nRainbow Foil\nPlatinum 1/1\n\nOr: Orange /25; Black /10; Red /5"}
                      className="w-full bg-cv-dark border border-cv-border rounded-lg px-3 py-2 text-sm text-cv-text focus:border-cv-accent focus:outline-none font-mono resize-y" />
                  </div>

                  <div>
                    <label className="text-xs text-cv-muted uppercase tracking-wider font-semibold block mb-1">
                      Cards <span className="normal-case text-cv-muted/60">(paste checklist text)</span>
                    </label>
                    <textarea rows={10} value={currentSection.cardsRaw}
                      onChange={e => setCurrentSection(prev => ({ ...prev, cardsRaw: e.target.value }))}
                      placeholder={"US1 Kristian Campbell, Boston Red Sox RC\nUS2 Shohei Ohtani, Los Angeles Dodgers\nUS3 Ronald Acuna Jr., Atlanta Braves"}
                      className="w-full bg-cv-dark border border-cv-border rounded-lg px-3 py-2 text-sm text-cv-text focus:border-cv-accent focus:outline-none font-mono resize-y" />
                  </div>

                  {currentSection.parseError && (
                    <div className="text-sm text-cv-red bg-cv-red/10 border border-cv-red/30 rounded-lg px-3 py-2">
                      {currentSection.parseError}
                    </div>
                  )}

                  <div className="flex items-center gap-2">
                    <button onClick={handleParse} disabled={parsing}
                      className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-gradient-to-r from-cv-accent to-cv-accent2 text-white hover:shadow-lg hover:shadow-cv-accent/20 disabled:opacity-50 transition-all">
                      {parsing ? <Loader2 size={14} className="animate-spin" /> : null}
                      {parsing ? 'Parsing...' : 'Parse Section'}
                    </button>
                  </div>
                </div>
              ) : (
                /* ===== PREVIEW MODE ===== */
                <div className="space-y-4">
                  {/* Section header with count badge */}
                  <div className="flex items-center gap-3">
                    <span className={`text-xs px-1.5 py-0.5 rounded font-semibold uppercase ${
                      SECTION_TYPE_COLORS[parsedSection?.sectionType] || SECTION_TYPE_COLORS.insert
                    }`}>
                      {parsedSection?.sectionType || 'insert'}
                    </span>
                    <h4 className="text-lg font-display font-semibold text-cv-text">{currentSection.name}</h4>
                    {declared > 0 && (
                      countsMatch ? (
                        <span className="flex items-center gap-1 text-xs px-2 py-0.5 rounded bg-green-500/20 text-green-300 border border-green-500/40">
                          <CheckCircle size={12} /> {actual}/{declared} Match
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 text-xs px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40">
                          <AlertTriangle size={12} /> {actual}/{declared} Mismatch
                        </span>
                      )
                    )}
                    {!declared && (
                      <span className="text-xs text-cv-muted">{actual} cards parsed</span>
                    )}
                  </div>

                  {/* Parallels */}
                  {parsedSection?.parallels?.length > 0 && (
                    <div>
                      <div className="text-xs text-cv-muted uppercase tracking-wider font-semibold mb-2">
                        Parallels ({parsedSection.parallels.length})
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {parsedSection.parallels.map((p, i) => (
                          <span key={i} className="inline-flex items-center gap-1 px-2 py-1 rounded bg-cv-dark border border-cv-border text-xs">
                            <span className="text-cv-gold font-medium">{p.name || p}</span>
                            {(p.serialMax || p.printRun) && (
                              <span className="text-cv-muted">/{p.serialMax || p.printRun}</span>
                            )}
                            {p.exclusive && <span className="text-cv-accent2">({p.exclusive})</span>}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Cards table */}
                  {parsedSection?.cards?.length > 0 && (
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <div className="text-xs text-cv-muted uppercase tracking-wider font-semibold">
                          Cards ({parsedSection.cards.length})
                        </div>
                        <button onClick={() => setExpandedPreview(!expandedPreview)}
                          className="text-xs text-cv-accent hover:text-cv-accent/80">
                          {expandedPreview ? 'Show less' : 'Show all'}
                        </button>
                      </div>
                      <div className="bg-cv-dark rounded-lg border border-cv-border overflow-hidden">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b border-cv-border">
                              <th className="text-left px-3 py-2 text-xs text-cv-muted uppercase font-semibold w-16">#</th>
                              <th className="text-left px-3 py-2 text-xs text-cv-muted uppercase font-semibold">Player</th>
                              <th className="text-left px-3 py-2 text-xs text-cv-muted uppercase font-semibold">Team</th>
                              <th className="text-left px-3 py-2 text-xs text-cv-muted uppercase font-semibold w-16">RC/SP</th>
                            </tr>
                          </thead>
                          <tbody>
                            {(expandedPreview ? parsedSection.cards : parsedSection.cards.slice(0, 15)).map((card, i) => (
                              <tr key={i} className="border-b border-cv-border/30 hover:bg-cv-panel/50">
                                <td className="px-3 py-1.5 text-cv-text font-mono">{card.cardNumber}</td>
                                <td className="px-3 py-1.5 text-cv-text">{card.player}</td>
                                <td className="px-3 py-1.5 text-cv-muted">{card.team}</td>
                                <td className="px-3 py-1.5">
                                  {card.rcSp && <span className="text-cv-gold text-xs font-semibold">{card.rcSp}</span>}
                                  {card.confidence != null && card.confidence < 0.8 && (
                                    <span className="text-amber-400 text-xs font-mono ml-1">{Math.round(card.confidence * 100)}%</span>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        {!expandedPreview && parsedSection.cards.length > 15 && (
                          <div className="px-3 py-2 text-xs text-cv-muted border-t border-cv-border/30">
                            ... and {parsedSection.cards.length - 15} more
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Back to edit */}
                  <button onClick={() => setViewMode('edit')}
                    className="text-xs text-cv-muted hover:text-cv-text underline">
                    &larr; Back to Edit
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Footer */}
        {!commitResult && (
          <div className="flex items-center justify-between px-5 py-4 border-t border-cv-border">
            <button onClick={close}
              className="px-4 py-2 text-sm text-cv-muted hover:text-cv-text transition-all">
              Cancel
            </button>
            <div className="flex items-center gap-2">
              {viewMode === 'preview' && currentSection.parsed && (
                <button onClick={handleAddSection}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-cv-accent/20 border border-cv-accent/40 text-cv-accent hover:bg-cv-accent/30 transition-all">
                  {editingIndex !== null ? 'Update Section' : 'Add & Continue'}
                </button>
              )}
              {(sections.length > 0 || (viewMode === 'preview' && currentSection.parsed)) && (
                <button onClick={handleFinish} disabled={committing}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-gradient-to-r from-cv-accent to-cv-accent2 text-white hover:shadow-lg hover:shadow-cv-accent/20 disabled:opacity-50 transition-all">
                  {committing ? <Loader2 size={14} className="animate-spin" /> : null}
                  {committing ? 'Saving...' : 'Finish & Save'}
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
