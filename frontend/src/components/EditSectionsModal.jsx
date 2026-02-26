import { useState, useEffect } from 'react';
import { X, Plus, Pencil, Check, Trash2 } from 'lucide-react';
import axios from 'axios';

const API = import.meta.env.VITE_API_URL || 'http://localhost:8000';

const SECTION_TYPES = ['base', 'insert', 'autograph', 'relic'];
const VARIATION_TYPES = ['parallel', 'autograph', 'relic'];

export default function EditSectionsModal({ open, onOpenChange, setId, onUpdate }) {
  const [insertTypes, setInsertTypes] = useState([]);
  const [parallels, setParallels] = useState([]);
  const [editingIt, setEditingIt] = useState(null);
  const [editingP, setEditingP] = useState(null);
  const [itForm, setItForm] = useState({});
  const [pForm, setPForm] = useState({});
  const [addingIt, setAddingIt] = useState(false);
  const [addingP, setAddingP] = useState(false);
  const [newIt, setNewIt] = useState({ name: '', card_count: '', odds: '', section_type: 'base', tracked: 0 });
  const [newP, setNewP] = useState({ name: '', print_run: '', exclusive: '', variation_type: 'parallel' });

  const load = () => {
    axios.get(`${API}/api/sets/${setId}/metadata`).then(r => {
      setInsertTypes(r.data.insertTypes);
      setParallels(r.data.parallels);
    }).catch(() => {});
  };

  useEffect(() => {
    if (open) {
      load();
      setEditingIt(null);
      setEditingP(null);
      setAddingIt(false);
      setAddingP(false);
    }
  }, [open, setId]);

  if (!open) return null;

  const close = () => onOpenChange(false);

  // Insert Types
  const startEditIt = (it) => {
    setEditingIt(it.id);
    setItForm({ name: it.name, card_count: it.card_count || 0, odds: it.odds || '', section_type: it.section_type || 'base', tracked: it.tracked });
  };

  const toggleTracked = async (it) => {
    try {
      const res = await axios.put(`${API}/api/insert-types/${it.id}`, {
        tracked: it.tracked ? 0 : 1,
      });
      setInsertTypes(prev => prev.map(t => t.id === it.id ? { ...t, tracked: res.data.tracked } : t));
      onUpdate?.();
    } catch (err) {
      console.error('Toggle tracked failed:', err);
    }
  };

  const saveEditIt = async (id) => {
    try {
      await axios.put(`${API}/api/insert-types/${id}`, itForm);
      setEditingIt(null);
      load();
      onUpdate();
    } catch (err) {
      alert(err.response?.data?.detail || 'Update failed');
    }
  };

  const deleteIt = async (id, name) => {
    if (!window.confirm(`Delete insert type "${name}"?\n\nThis removes the section metadata and pricing data. Cards themselves are kept.`)) return;
    try {
      await axios.delete(`${API}/api/insert-types/${id}`);
      load();
      onUpdate();
    } catch (err) {
      alert(err.response?.data?.detail || 'Delete failed');
    }
  };

  const addIt = async () => {
    if (!newIt.name.trim()) return;
    try {
      await axios.post(`${API}/api/sets/${setId}/insert-types`, {
        ...newIt,
        card_count: parseInt(newIt.card_count) || 0,
      });
      setNewIt({ name: '', card_count: '', odds: '', section_type: 'base', tracked: 0 });
      setAddingIt(false);
      load();
      onUpdate();
    } catch (err) {
      alert(err.response?.data?.detail || 'Add failed');
    }
  };

  // Parallels
  const startEditP = (p) => {
    setEditingP(p.id);
    setPForm({
      name: p.name,
      print_run: p.print_run || '',
      exclusive: p.exclusive || '',
      variation_type: p.variation_type || 'parallel',
    });
  };

  const saveEditP = async (id) => {
    try {
      await axios.put(`${API}/api/set-parallels/${id}`, {
        ...pForm,
        print_run: pForm.print_run ? parseInt(pForm.print_run) : null,
      });
      setEditingP(null);
      load();
      onUpdate();
    } catch (err) {
      alert(err.response?.data?.detail || 'Update failed');
    }
  };

  const deleteP = async (id, name) => {
    if (!window.confirm(`Delete parallel "${name}"?\n\nThis removes the parallel metadata. Cards keep their parallel text.`)) return;
    try {
      await axios.delete(`${API}/api/set-parallels/${id}`);
      load();
      onUpdate();
    } catch (err) {
      alert(err.response?.data?.detail || 'Delete failed');
    }
  };

  const addP = async () => {
    if (!newP.name.trim()) return;
    try {
      await axios.post(`${API}/api/sets/${setId}/parallels`, {
        ...newP,
        print_run: newP.print_run ? parseInt(newP.print_run) : null,
      });
      setNewP({ name: '', print_run: '', exclusive: '', variation_type: 'parallel' });
      setAddingP(false);
      load();
      onUpdate();
    } catch (err) {
      alert(err.response?.data?.detail || 'Add failed');
    }
  };

  const inputCls = 'bg-cv-dark border border-cv-border/50 rounded px-2 py-1 text-sm text-cv-text focus:border-cv-accent focus:outline-none';
  const selectCls = 'bg-cv-dark border border-cv-border/50 rounded px-2 py-1 text-sm text-cv-text focus:outline-none';

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={close}>
      <div className="bg-cv-panel border border-cv-border rounded-xl w-full max-w-3xl max-h-[85vh] flex flex-col"
        onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-cv-border">
          <h3 className="text-lg font-display font-semibold text-cv-text">Edit Sections</h3>
          <button onClick={close} className="p-1.5 rounded-lg text-cv-muted hover:text-cv-text hover:bg-cv-dark transition-all">
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-6">

          {/* Insert Types */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-sm font-semibold text-cv-text uppercase tracking-wider">Insert Types</h4>
              {!addingIt && (
                <button onClick={() => setAddingIt(true)}
                  className="flex items-center gap-1 text-xs text-cv-accent hover:text-cv-accent/80 transition-colors">
                  <Plus size={14} /> Add
                </button>
              )}
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-cv-border/30 text-xs text-cv-muted uppercase">
                  <th className="text-center py-2 font-semibold w-16">Tracked</th>
                  <th className="text-left py-2 font-semibold">Name</th>
                  <th className="text-center py-2 font-semibold w-20">Cards</th>
                  <th className="text-center py-2 font-semibold w-24">Type</th>
                  <th className="text-center py-2 font-semibold w-20">Odds</th>
                  <th className="text-center py-2 font-semibold w-20">Actions</th>
                </tr>
              </thead>
              <tbody>
                {insertTypes.map(it => (
                  <tr key={it.id} className="border-b border-cv-border/20">
                    {editingIt === it.id ? (
                      <>
                        <td className="py-2 px-1 text-center">
                          <button
                            onClick={() => setItForm({ ...itForm, tracked: itForm.tracked ? 0 : 1 })}
                            className={`w-8 h-4 rounded-full transition-colors relative inline-block ${
                              itForm.tracked ? 'bg-cv-accent' : 'bg-cv-dark/50 border border-cv-border/50'
                            }`}
                          >
                            <div className={`absolute top-0.5 w-3 h-3 rounded-full bg-white shadow transition-transform ${
                              itForm.tracked ? 'translate-x-4' : 'translate-x-0.5'
                            }`} />
                          </button>
                        </td>
                        <td className="py-2 pr-2">
                          <input value={itForm.name} onChange={e => setItForm({ ...itForm, name: e.target.value })}
                            className={inputCls + ' w-full'} />
                        </td>
                        <td className="py-2 px-1">
                          <input type="number" value={itForm.card_count} onChange={e => setItForm({ ...itForm, card_count: parseInt(e.target.value) || 0 })}
                            className={inputCls + ' w-full text-center'} />
                        </td>
                        <td className="py-2 px-1">
                          <select value={itForm.section_type} onChange={e => setItForm({ ...itForm, section_type: e.target.value })}
                            className={selectCls + ' w-full'}>
                            {SECTION_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                          </select>
                        </td>
                        <td className="py-2 px-1">
                          <input value={itForm.odds} onChange={e => setItForm({ ...itForm, odds: e.target.value })}
                            className={inputCls + ' w-full text-center'} placeholder="1:24" />
                        </td>
                        <td className="py-2 px-1 text-center">
                          <div className="flex items-center justify-center gap-1">
                            <button onClick={() => saveEditIt(it.id)} className="p-1 rounded text-cv-accent hover:bg-cv-accent/20"><Check size={14} /></button>
                            <button onClick={() => setEditingIt(null)} className="p-1 rounded text-cv-muted hover:bg-white/10"><X size={14} /></button>
                          </div>
                        </td>
                      </>
                    ) : (
                      <>
                        <td className="py-2 px-1 text-center">
                          <button
                            onClick={() => toggleTracked(it)}
                            className={`w-8 h-4 rounded-full transition-colors relative inline-block ${
                              it.tracked ? 'bg-cv-accent' : 'bg-cv-dark/50 border border-cv-border/50'
                            }`}
                          >
                            <div className={`absolute top-0.5 w-3 h-3 rounded-full bg-white shadow transition-transform ${
                              it.tracked ? 'translate-x-4' : 'translate-x-0.5'
                            }`} />
                          </button>
                        </td>
                        <td className="py-2 pr-2 text-cv-text font-medium">{it.name}</td>
                        <td className="py-2 px-1 text-center text-cv-muted font-mono">{it.card_count || '—'}</td>
                        <td className="py-2 px-1 text-center">
                          <span className="text-xs text-cv-muted capitalize">{it.section_type || 'base'}</span>
                        </td>
                        <td className="py-2 px-1 text-center text-cv-muted">{it.odds || '—'}</td>
                        <td className="py-2 px-1 text-center">
                          <div className="flex items-center justify-center gap-1">
                            <button onClick={() => startEditIt(it)} className="p-1 rounded text-cv-muted hover:text-cv-accent hover:bg-cv-accent/10 transition-all"><Pencil size={13} /></button>
                            <button onClick={() => deleteIt(it.id, it.name)} className="p-1 rounded text-cv-muted hover:text-cv-red hover:bg-cv-red/10 transition-all"><Trash2 size={13} /></button>
                          </div>
                        </td>
                      </>
                    )}
                  </tr>
                ))}
                {insertTypes.length === 0 && !addingIt && (
                  <tr><td colSpan={6} className="py-4 text-center text-cv-muted text-xs">No insert types defined</td></tr>
                )}
                {addingIt && (
                  <tr className="border-b border-cv-border/20 bg-cv-accent/[0.03]">
                    <td className="py-2 px-1 text-center">
                      <button
                        onClick={() => setNewIt({ ...newIt, tracked: newIt.tracked ? 0 : 1 })}
                        className={`w-8 h-4 rounded-full transition-colors relative inline-block ${
                          newIt.tracked ? 'bg-cv-accent' : 'bg-cv-dark/50 border border-cv-border/50'
                        }`}
                      >
                        <div className={`absolute top-0.5 w-3 h-3 rounded-full bg-white shadow transition-transform ${
                          newIt.tracked ? 'translate-x-4' : 'translate-x-0.5'
                        }`} />
                      </button>
                    </td>
                    <td className="py-2 pr-2">
                      <input value={newIt.name} onChange={e => setNewIt({ ...newIt, name: e.target.value })}
                        className={inputCls + ' w-full'} placeholder="Section name" autoFocus />
                    </td>
                    <td className="py-2 px-1">
                      <input type="number" value={newIt.card_count} onChange={e => setNewIt({ ...newIt, card_count: e.target.value })}
                        className={inputCls + ' w-full text-center'} placeholder="0" />
                    </td>
                    <td className="py-2 px-1">
                      <select value={newIt.section_type} onChange={e => setNewIt({ ...newIt, section_type: e.target.value })}
                        className={selectCls + ' w-full'}>
                        {SECTION_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                      </select>
                    </td>
                    <td className="py-2 px-1">
                      <input value={newIt.odds} onChange={e => setNewIt({ ...newIt, odds: e.target.value })}
                        className={inputCls + ' w-full text-center'} placeholder="1:24" />
                    </td>
                    <td className="py-2 px-1 text-center">
                      <div className="flex items-center justify-center gap-1">
                        <button onClick={addIt} className="p-1 rounded text-cv-accent hover:bg-cv-accent/20"><Check size={14} /></button>
                        <button onClick={() => setAddingIt(false)} className="p-1 rounded text-cv-muted hover:bg-white/10"><X size={14} /></button>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Parallels */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-sm font-semibold text-cv-text uppercase tracking-wider">Parallels</h4>
              {!addingP && (
                <button onClick={() => setAddingP(true)}
                  className="flex items-center gap-1 text-xs text-cv-accent hover:text-cv-accent/80 transition-colors">
                  <Plus size={14} /> Add
                </button>
              )}
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-cv-border/30 text-xs text-cv-muted uppercase">
                  <th className="text-left py-2 font-semibold">Name</th>
                  <th className="text-center py-2 font-semibold w-24">Print Run</th>
                  <th className="text-center py-2 font-semibold w-28">Exclusive</th>
                  <th className="text-center py-2 font-semibold w-24">Type</th>
                  <th className="text-center py-2 font-semibold w-20">Actions</th>
                </tr>
              </thead>
              <tbody>
                {parallels.map(p => (
                  <tr key={p.id} className="border-b border-cv-border/20">
                    {editingP === p.id ? (
                      <>
                        <td className="py-2 pr-2">
                          <input value={pForm.name} onChange={e => setPForm({ ...pForm, name: e.target.value })}
                            className={inputCls + ' w-full'} />
                        </td>
                        <td className="py-2 px-1">
                          <input type="number" value={pForm.print_run} onChange={e => setPForm({ ...pForm, print_run: e.target.value })}
                            className={inputCls + ' w-full text-center'} placeholder="e.g. 50" />
                        </td>
                        <td className="py-2 px-1">
                          <input value={pForm.exclusive} onChange={e => setPForm({ ...pForm, exclusive: e.target.value })}
                            className={inputCls + ' w-full text-center'} placeholder="Hobby" />
                        </td>
                        <td className="py-2 px-1">
                          <select value={pForm.variation_type} onChange={e => setPForm({ ...pForm, variation_type: e.target.value })}
                            className={selectCls + ' w-full'}>
                            {VARIATION_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                          </select>
                        </td>
                        <td className="py-2 px-1 text-center">
                          <div className="flex items-center justify-center gap-1">
                            <button onClick={() => saveEditP(p.id)} className="p-1 rounded text-cv-accent hover:bg-cv-accent/20"><Check size={14} /></button>
                            <button onClick={() => setEditingP(null)} className="p-1 rounded text-cv-muted hover:bg-white/10"><X size={14} /></button>
                          </div>
                        </td>
                      </>
                    ) : (
                      <>
                        <td className="py-2 pr-2 text-cv-text font-medium">{p.name}</td>
                        <td className="py-2 px-1 text-center text-cv-muted font-mono">{p.print_run ? `/${p.print_run}` : '—'}</td>
                        <td className="py-2 px-1 text-center text-cv-muted">{p.exclusive || '—'}</td>
                        <td className="py-2 px-1 text-center">
                          <span className="text-xs text-cv-muted capitalize">{p.variation_type || 'parallel'}</span>
                        </td>
                        <td className="py-2 px-1 text-center">
                          <div className="flex items-center justify-center gap-1">
                            <button onClick={() => startEditP(p)} className="p-1 rounded text-cv-muted hover:text-cv-accent hover:bg-cv-accent/10 transition-all"><Pencil size={13} /></button>
                            <button onClick={() => deleteP(p.id, p.name)} className="p-1 rounded text-cv-muted hover:text-cv-red hover:bg-cv-red/10 transition-all"><Trash2 size={13} /></button>
                          </div>
                        </td>
                      </>
                    )}
                  </tr>
                ))}
                {parallels.length === 0 && !addingP && (
                  <tr><td colSpan={5} className="py-4 text-center text-cv-muted text-xs">No parallels defined</td></tr>
                )}
                {addingP && (
                  <tr className="border-b border-cv-border/20 bg-cv-accent/[0.03]">
                    <td className="py-2 pr-2">
                      <input value={newP.name} onChange={e => setNewP({ ...newP, name: e.target.value })}
                        className={inputCls + ' w-full'} placeholder="Parallel name" autoFocus />
                    </td>
                    <td className="py-2 px-1">
                      <input type="number" value={newP.print_run} onChange={e => setNewP({ ...newP, print_run: e.target.value })}
                        className={inputCls + ' w-full text-center'} placeholder="e.g. 50" />
                    </td>
                    <td className="py-2 px-1">
                      <input value={newP.exclusive} onChange={e => setNewP({ ...newP, exclusive: e.target.value })}
                        className={inputCls + ' w-full text-center'} placeholder="Hobby" />
                    </td>
                    <td className="py-2 px-1">
                      <select value={newP.variation_type} onChange={e => setNewP({ ...newP, variation_type: e.target.value })}
                        className={selectCls + ' w-full'}>
                        {VARIATION_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                      </select>
                    </td>
                    <td className="py-2 px-1 text-center">
                      <div className="flex items-center justify-center gap-1">
                        <button onClick={addP} className="p-1 rounded text-cv-accent hover:bg-cv-accent/20"><Check size={14} /></button>
                        <button onClick={() => setAddingP(false)} className="p-1 rounded text-cv-muted hover:bg-white/10"><X size={14} /></button>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-cv-border flex justify-end">
          <button onClick={close}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-white/5 border border-cv-border/50 text-cv-text hover:bg-white/10 transition-all">
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
