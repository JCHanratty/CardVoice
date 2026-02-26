import { useState, useMemo } from 'react';
import { X, Search, Trash2, RefreshCw, ArrowRight, Download, SkipForward } from 'lucide-react';

export default function ScrapePreviewModal({ item, data, onClose, onImport, onSkip, onRescrape, onEdit }) {
  const [activeTab, setActiveTab] = useState('cards');
  const [cardSearch, setCardSearch] = useState('');
  const [selectedCards, setSelectedCards] = useState(new Set());

  const cards = data?.cards || [];
  const insertTypes = data?.insertTypes || [];
  const parallels = data?.parallels || [];

  // Filter cards by search
  const filteredCards = useMemo(() => {
    if (!cardSearch.trim()) return cards;
    const q = cardSearch.toLowerCase();
    return cards.filter(c =>
      (c.player || '').toLowerCase().includes(q) ||
      (c.card_number || '').toLowerCase().includes(q) ||
      (c.team || '').toLowerCase().includes(q)
    );
  }, [cards, cardSearch]);

  const baseCards = cards.filter(c => !c.insert_type);

  const allSelected = filteredCards.length > 0 && filteredCards.every(c => selectedCards.has(c._idx ?? c.card_number));
  const anySelected = selectedCards.size > 0;

  const toggleCard = (id) => {
    setSelectedCards(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (allSelected) {
      setSelectedCards(new Set());
    } else {
      setSelectedCards(new Set(filteredCards.map(c => c._idx ?? c.card_number)));
    }
  };

  const removeSelected = () => {
    if (!anySelected) return;
    const ops = Array.from(selectedCards).map(id => ({ op: 'remove_card', id }));
    onEdit(ops);
    setSelectedCards(new Set());
  };

  const renameInsert = (it) => {
    const name = prompt('Rename insert type:', it.name);
    if (name && name !== it.name) {
      onEdit([{ op: 'rename_insert', id: it.id || it.name, name }]);
    }
  };

  const reclassifyInsertToParallel = (it) => {
    onEdit([{ op: 'reclassify_insert_to_parallel', id: it.id || it.name }]);
  };

  const removeInsert = (it) => {
    onEdit([{ op: 'remove_insert', id: it.id || it.name }]);
  };

  const renameParallel = (p) => {
    const name = prompt('Rename parallel:', p.name);
    if (name && name !== p.name) {
      onEdit([{ op: 'rename_parallel', id: p.id || p.name, name }]);
    }
  };

  const reclassifyParallelToInsert = (p) => {
    onEdit([{ op: 'reclassify_parallel_to_insert', id: p.id || p.name }]);
  };

  const removeParallel = (p) => {
    onEdit([{ op: 'remove_parallel', id: p.id || p.name }]);
  };

  const tabCls = (tab) =>
    `px-4 py-2 text-sm font-medium rounded-t-lg transition-colors ${
      activeTab === tab
        ? 'bg-cv-secondary text-cv-accent border-b-2 border-cv-accent'
        : 'text-cv-muted hover:text-cv-text hover:bg-cv-secondary/50'
    }`;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="bg-cv-panel border border-cv-border rounded-2xl w-full max-w-5xl max-h-[90vh] flex flex-col mx-4 shadow-2xl">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-cv-border">
          <div>
            <h2 className="text-lg font-display font-bold text-cv-text">
              {item.set_name || 'Set Preview'}
            </h2>
            <div className="flex items-center gap-3 mt-1 text-xs text-cv-muted">
              {item.year && <span>{item.year}</span>}
              {item.brand && <span>{item.brand}</span>}
              <span>{cards.length} cards</span>
              <span>{insertTypes.length} inserts</span>
              <span>{parallels.length} parallels</span>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg text-cv-muted hover:text-cv-text hover:bg-cv-dark transition-all">
            <X size={20} />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 px-6 pt-3 border-b border-cv-border/50">
          <button className={tabCls('cards')} onClick={() => setActiveTab('cards')}>
            Cards ({cards.length})
          </button>
          <button className={tabCls('inserts')} onClick={() => setActiveTab('inserts')}>
            Inserts ({insertTypes.length})
          </button>
          <button className={tabCls('parallels')} onClick={() => setActiveTab('parallels')}>
            Parallels ({parallels.length})
          </button>
        </div>

        {/* Tab Content */}
        <div className="flex-1 overflow-y-auto px-6 py-4">

          {/* Cards Tab */}
          {activeTab === 'cards' && (
            <div>
              <div className="flex items-center gap-3 mb-3">
                <div className="relative flex-1">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-cv-muted" />
                  <input
                    type="text"
                    value={cardSearch}
                    onChange={e => setCardSearch(e.target.value)}
                    placeholder="Search cards..."
                    className="w-full bg-cv-dark border border-cv-border/50 rounded-lg pl-9 pr-3 py-2 text-sm text-cv-text placeholder:text-cv-muted/50 focus:border-cv-accent focus:outline-none"
                  />
                </div>
                {anySelected && (
                  <button
                    onClick={removeSelected}
                    className="flex items-center gap-1 px-3 py-2 rounded-lg text-sm bg-red-600/20 text-red-400 hover:bg-red-600/30 transition-colors"
                  >
                    <Trash2 size={14} /> Remove {selectedCards.size} selected
                  </button>
                )}
              </div>
              <div className="text-xs text-cv-muted mb-2">
                {baseCards.length} base cards / {cards.length} total
              </div>
              <div className="max-h-[50vh] overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-cv-panel">
                    <tr className="border-b border-cv-border/30 text-xs text-cv-muted uppercase">
                      <th className="text-center py-2 w-10">
                        <input
                          type="checkbox"
                          checked={allSelected}
                          onChange={toggleAll}
                          className="accent-cv-accent"
                        />
                      </th>
                      <th className="text-left py-2 font-semibold w-16">#</th>
                      <th className="text-left py-2 font-semibold">Player</th>
                      <th className="text-left py-2 font-semibold">Team</th>
                      <th className="text-left py-2 font-semibold w-20">RC/SP</th>
                      <th className="text-left py-2 font-semibold">Insert Type</th>
                      <th className="text-left py-2 font-semibold">Parallel</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredCards.map((c, i) => {
                      const id = c._idx ?? c.card_number;
                      return (
                        <tr key={i} className="border-b border-cv-border/10 hover:bg-white/[0.02]">
                          <td className="py-1.5 text-center">
                            <input
                              type="checkbox"
                              checked={selectedCards.has(id)}
                              onChange={() => toggleCard(id)}
                              className="accent-cv-accent"
                            />
                          </td>
                          <td className="py-1.5 text-cv-text font-mono">{c.card_number}</td>
                          <td className="py-1.5 text-cv-text">{c.player}</td>
                          <td className="py-1.5 text-cv-muted">{c.team}</td>
                          <td className="py-1.5">
                            {(c.rc_sp || c.flags || []).map(f => (
                              <span key={f} className="text-[10px] bg-cv-gold/15 text-cv-gold rounded px-1 mr-1">{f}</span>
                            ))}
                          </td>
                          <td className="py-1.5 text-cv-muted text-xs">{c.insert_type || ''}</td>
                          <td className="py-1.5 text-cv-muted text-xs">{c.parallel || ''}</td>
                        </tr>
                      );
                    })}
                    {filteredCards.length === 0 && (
                      <tr><td colSpan={7} className="py-6 text-center text-cv-muted text-xs">No cards match filter</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Inserts Tab */}
          {activeTab === 'inserts' && (
            <div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-cv-border/30 text-xs text-cv-muted uppercase">
                    <th className="text-left py-2 font-semibold">Name</th>
                    <th className="text-center py-2 font-semibold w-24">Card Count</th>
                    <th className="text-center py-2 font-semibold w-28">Section Type</th>
                    <th className="text-center py-2 font-semibold w-48">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {insertTypes.map((it, i) => (
                    <tr key={i} className="border-b border-cv-border/10">
                      <td className="py-2 text-cv-text font-medium">{it.name}</td>
                      <td className="py-2 text-center text-cv-muted font-mono">{it.card_count || 0}</td>
                      <td className="py-2 text-center">
                        <span className="text-xs text-cv-muted capitalize">{it.section_type || 'base'}</span>
                      </td>
                      <td className="py-2 text-center">
                        <div className="flex items-center justify-center gap-1">
                          <button
                            onClick={() => renameInsert(it)}
                            className="px-2 py-1 rounded text-xs bg-cv-secondary text-cv-text hover:bg-cv-secondary/80 transition-colors"
                          >
                            Rename
                          </button>
                          <button
                            onClick={() => reclassifyInsertToParallel(it)}
                            className="px-2 py-1 rounded text-xs bg-yellow-600/20 text-yellow-400 hover:bg-yellow-600/30 transition-colors flex items-center gap-1"
                          >
                            <ArrowRight size={12} /> Parallel
                          </button>
                          <button
                            onClick={() => removeInsert(it)}
                            className="px-2 py-1 rounded text-xs bg-red-600/20 text-red-400 hover:bg-red-600/30 transition-colors"
                          >
                            Remove
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {insertTypes.length === 0 && (
                    <tr><td colSpan={4} className="py-6 text-center text-cv-muted text-xs">No insert types</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          {/* Parallels Tab */}
          {activeTab === 'parallels' && (
            <div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-cv-border/30 text-xs text-cv-muted uppercase">
                    <th className="text-left py-2 font-semibold">Name</th>
                    <th className="text-center py-2 font-semibold w-24">Print Run</th>
                    <th className="text-center py-2 font-semibold w-24">Type</th>
                    <th className="text-center py-2 font-semibold w-48">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {parallels.map((p, i) => (
                    <tr key={i} className="border-b border-cv-border/10">
                      <td className="py-2 text-cv-text font-medium">{p.name}</td>
                      <td className="py-2 text-center text-cv-muted font-mono">{p.print_run ? `/${p.print_run}` : '\u2014'}</td>
                      <td className="py-2 text-center">
                        <span className="text-xs text-cv-muted capitalize">{p.variation_type || 'parallel'}</span>
                      </td>
                      <td className="py-2 text-center">
                        <div className="flex items-center justify-center gap-1">
                          <button
                            onClick={() => renameParallel(p)}
                            className="px-2 py-1 rounded text-xs bg-cv-secondary text-cv-text hover:bg-cv-secondary/80 transition-colors"
                          >
                            Rename
                          </button>
                          <button
                            onClick={() => reclassifyParallelToInsert(p)}
                            className="px-2 py-1 rounded text-xs bg-yellow-600/20 text-yellow-400 hover:bg-yellow-600/30 transition-colors flex items-center gap-1"
                          >
                            <ArrowRight size={12} /> Insert
                          </button>
                          <button
                            onClick={() => removeParallel(p)}
                            className="px-2 py-1 rounded text-xs bg-red-600/20 text-red-400 hover:bg-red-600/30 transition-colors"
                          >
                            Remove
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {parallels.length === 0 && (
                    <tr><td colSpan={4} className="py-6 text-center text-cv-muted text-xs">No parallels</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-cv-border">
          <div className="flex items-center gap-2">
            <button
              onClick={() => onRescrape(item.id)}
              className="flex items-center gap-1 px-4 py-2 rounded-lg text-sm bg-white/5 border border-cv-border/50 text-cv-muted hover:text-cv-text hover:bg-white/10 transition-all"
            >
              <RefreshCw size={14} /> Re-scrape
            </button>
            <button
              onClick={() => onSkip(item.id)}
              className="flex items-center gap-1 px-4 py-2 rounded-lg text-sm bg-white/5 border border-cv-border/50 text-cv-muted hover:text-cv-text hover:bg-white/10 transition-all"
            >
              <SkipForward size={14} /> Skip
            </button>
          </div>
          <button
            onClick={() => onImport(item.id)}
            className="flex items-center gap-2 px-6 py-2.5 rounded-lg text-sm font-medium bg-green-600 text-white hover:bg-green-500 transition-all"
          >
            <Download size={16} /> Import to CardVoice
          </button>
        </div>
      </div>
    </div>
  );
}
