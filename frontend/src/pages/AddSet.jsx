import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, Plus, List, Database } from 'lucide-react';
import axios from 'axios';
import ChecklistWizardModal from '../components/ChecklistWizardModal';

const API = import.meta.env.VITE_API_URL || 'http://localhost:8000';

export default function AddSet() {
  const navigate = useNavigate();
  const [sets, setSets] = useState([]);
  const [selectedSetId, setSelectedSetId] = useState(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newSet, setNewSet] = useState({ name: '', year: 2025, brand: '', sport: 'Baseball' });
  const [wizardOpen, setWizardOpen] = useState(false);
  const [creating, setCreating] = useState(false);

  useEffect(() => { loadSets(); }, []);

  const loadSets = () => {
    axios.get(`${API}/api/sets`).then(r => setSets(r.data)).catch(() => {});
  };

  const handleSelectChange = (e) => {
    const value = e.target.value;
    if (value === '__create__') {
      setShowCreateForm(true);
      setSelectedSetId(null);
    } else {
      setSelectedSetId(value ? Number(value) : null);
      setShowCreateForm(false);
    }
  };

  const createSet = async (e) => {
    e.preventDefault();
    setCreating(true);
    try {
      const res = await axios.post(`${API}/api/sets`, newSet);
      setSelectedSetId(res.data.id);
      setShowCreateForm(false);
      setNewSet({ name: '', year: 2025, brand: '', sport: 'Baseball' });
      loadSets();
    } catch (err) {
      alert(err.response?.data?.detail || 'Failed to create set');
    }
    setCreating(false);
  };

  const handleWizardComplete = () => {
    setWizardOpen(false);
    loadSets();
  };

  const selectedSetName = sets.find(s => s.id === selectedSetId)?.name;

  return (
    <div className="w-full max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <Link to="/sets" className="p-2 rounded-lg bg-cv-panel border border-cv-border text-cv-muted hover:text-cv-text">
          <ArrowLeft size={18} />
        </Link>
        <div>
          <h2 className="text-2xl font-bold text-cv-text">Add Cards to Set</h2>
          <p className="text-sm text-cv-muted mt-0.5">Select or create a set, then import a checklist</p>
        </div>
      </div>

      {/* Set Selector */}
      <div className="bg-cv-panel rounded-xl border border-cv-border p-6 mb-4">
        <label className="text-xs text-cv-muted uppercase tracking-wider font-semibold block mb-2">Select a Set</label>
        <select
          value={selectedSetId ?? (showCreateForm ? '__create__' : '')}
          onChange={handleSelectChange}
          className="w-full bg-cv-dark border border-cv-border rounded-lg px-3 py-2.5 text-sm text-cv-text focus:border-cv-accent focus:outline-none"
        >
          <option value="">Choose a set...</option>
          <option value="__create__">+ Create New Set</option>
          {Object.entries(sets.reduce((groups, s) => {
            const yr = s.year || 'No Year';
            if (!groups[yr]) groups[yr] = [];
            groups[yr].push(s);
            return groups;
          }, {})).map(([year, yearSets]) => (
            <optgroup key={year} label={`── ${year} ──`}>
              {yearSets.map(s => (
                <option key={s.id} value={s.id}>{s.name} {s.total_cards ? `(${s.total_cards} cards)` : ''}</option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>

      {/* Create Form */}
      {showCreateForm && (
        <form onSubmit={createSet} className="bg-cv-panel rounded-xl border border-cv-accent/30 p-6 mb-4">
          <h3 className="text-sm font-semibold text-cv-accent uppercase tracking-wider mb-4">Create New Set</h3>
          <div className="grid grid-cols-4 gap-4">
            <div className="col-span-2">
              <label className="text-xs text-cv-muted uppercase block mb-1">Set Name</label>
              <input type="text" required value={newSet.name}
                onChange={e => setNewSet({ ...newSet, name: e.target.value })}
                placeholder="e.g., 2025 Topps Chrome"
                className="w-full bg-cv-dark border border-cv-border rounded-lg px-3 py-2 text-sm text-cv-text focus:border-cv-accent focus:outline-none" />
            </div>
            <div>
              <label className="text-xs text-cv-muted uppercase block mb-1">Year</label>
              <input type="number" value={newSet.year}
                onChange={e => setNewSet({ ...newSet, year: parseInt(e.target.value) || null })}
                className="w-full bg-cv-dark border border-cv-border rounded-lg px-3 py-2 text-sm text-cv-text focus:border-cv-accent focus:outline-none" />
            </div>
            <div>
              <label className="text-xs text-cv-muted uppercase block mb-1">Brand</label>
              <input type="text" value={newSet.brand}
                onChange={e => setNewSet({ ...newSet, brand: e.target.value })}
                placeholder="e.g., Topps"
                className="w-full bg-cv-dark border border-cv-border rounded-lg px-3 py-2 text-sm text-cv-text focus:border-cv-accent focus:outline-none" />
            </div>
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" onClick={() => setShowCreateForm(false)}
              className="px-4 py-2 text-sm text-cv-muted hover:text-cv-text">Cancel</button>
            <button type="submit" disabled={creating}
              className="px-4 py-2 rounded-lg text-sm bg-cv-accent text-cv-dark font-medium hover:bg-cv-accent/90 disabled:opacity-50">
              {creating ? 'Creating...' : 'Create Set'}
            </button>
          </div>
        </form>
      )}

      {/* Action Card */}
      {selectedSetId ? (
        <div className="bg-cv-panel rounded-xl border border-cv-border p-8 text-center">
          <List size={40} className="text-cv-accent mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-cv-text mb-1">
            Ready to add cards to <span className="text-cv-accent">{selectedSetName}</span>
          </h3>
          <p className="text-sm text-cv-muted mb-6 max-w-md mx-auto">
            Open the checklist wizard to paste and parse your Beckett checklist section by section — with parallels, card counts, and auto-validation.
          </p>
          <button onClick={() => setWizardOpen(true)}
            className="inline-flex items-center gap-2 px-6 py-3 rounded-lg text-sm font-medium bg-cv-accent text-cv-dark hover:bg-cv-accent/90 transition-all">
            <Plus size={18} /> Add Checklist
          </button>
        </div>
      ) : !showCreateForm && (
        <div className="bg-cv-panel rounded-xl border border-cv-border p-8 text-center">
          <Database size={40} className="text-cv-muted mx-auto mb-4" />
          <p className="text-cv-muted">Select a set from the dropdown above, or create a new one</p>
        </div>
      )}

      {/* Wizard Modal */}
      {selectedSetId && (
        <ChecklistWizardModal
          open={wizardOpen}
          onOpenChange={setWizardOpen}
          setId={selectedSetId}
          setName={selectedSetName}
          onComplete={handleWizardComplete}
        />
      )}
    </div>
  );
}
