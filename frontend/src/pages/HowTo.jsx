import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Mic, MicOff, Keyboard, Check, Undo2, Trash2, Plus, Minus,
  Download, Upload, Database, ArrowRight, Zap, Brain, Pencil,
  Volume2, ChevronRight, ChevronDown, Hash, ListChecks, FileSpreadsheet, Search,
  AlertTriangle, Settings, CornerDownRight
} from 'lucide-react';

// ---- Reusable sub-components (unchanged content) ----

function Section({ icon: Icon, title, children, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="bg-cv-panel rounded-xl border border-cv-border mb-3">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between p-4 text-left"
      >
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-cv-accent/10">
            <Icon size={18} className="text-cv-accent" />
          </div>
          <h3 className="text-base font-bold text-cv-text">{title}</h3>
        </div>
        <ChevronDown
          size={18}
          className={`text-cv-muted transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open && <div className="px-6 pb-5 -mt-1">{children}</div>}
    </div>
  );
}

function Step({ num, children }) {
  return (
    <div className="flex gap-3 mb-3 last:mb-0">
      <div className="w-6 h-6 rounded-full bg-cv-accent/20 text-cv-accent flex items-center justify-center text-xs font-bold flex-shrink-0 mt-0.5">
        {num}
      </div>
      <div className="text-sm text-cv-text/80 leading-relaxed">{children}</div>
    </div>
  );
}

function Tip({ children }) {
  return (
    <div className="flex gap-2 mt-3 px-3 py-2 rounded-lg bg-cv-accent/5 border border-cv-accent/20">
      <Zap size={14} className="text-cv-accent flex-shrink-0 mt-0.5" />
      <span className="text-xs text-cv-accent/90">{children}</span>
    </div>
  );
}

function Warn({ children }) {
  return (
    <div className="flex gap-2 mt-3 px-3 py-2 rounded-lg bg-cv-yellow/5 border border-cv-yellow/20">
      <AlertTriangle size={14} className="text-cv-yellow flex-shrink-0 mt-0.5" />
      <span className="text-xs text-cv-yellow/90">{children}</span>
    </div>
  );
}

function KeyBadge({ children }) {
  return (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-cv-dark border border-cv-border text-[11px] font-mono text-cv-text mx-0.5">
      {children}
    </span>
  );
}

function VoiceExample({ input, output }) {
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 rounded bg-cv-dark border border-cv-border text-xs font-mono mb-1.5 last:mb-0">
      <Volume2 size={11} className="text-cv-muted flex-shrink-0" />
      <span className="text-cv-muted">{input}</span>
      <ArrowRight size={11} className="text-cv-accent flex-shrink-0" />
      <span className="text-cv-text">{output}</span>
    </div>
  );
}

// ---- Tab definitions ----

const TABS = [
  { id: 'start', label: 'Getting Started', icon: Mic },
  { id: 'editing', label: 'Editing & Smart Features', icon: Brain },
  { id: 'sets', label: 'Sets & Exporting', icon: Database },
];

// ---- Section content per tab ----

function GettingStartedTab() {
  return (
    <>
      <Section icon={Mic} title="Quick Start" defaultOpen>
        <Step num={1}>
          <strong className="text-cv-text">Select or create a set</strong> from the dropdown on the Voice Entry page.
          This is the checklist your cards will be saved to (e.g., "2024 Topps Series 1").
        </Step>
        <Step num={2}>
          <strong className="text-cv-text">Hit the mic button</strong> and start speaking card numbers.
          Say them naturally: <KeyBadge>forty two</KeyBadge> <KeyBadge>fifty five</KeyBadge> <KeyBadge>one hundred three</KeyBadge>
        </Step>
        <Step num={3}>
          <strong className="text-cv-text">Review the Current Batch.</strong> Edit any misheard numbers
          by clicking the card number. Adjust quantities with <Minus size={10} className="inline" /> / <Plus size={10} className="inline" /> buttons.
        </Step>
        <Step num={4}>
          <strong className="text-cv-text">Hit COMMIT</strong> <Check size={12} className="inline text-cv-accent" /> to
          lock in that batch. Change Insert Type or Parallel, then keep going for the next group.
        </Step>
        <Step num={5}>
          <strong className="text-cv-text">Save to Set</strong> when you're done. This writes all committed
          batches to the database.
        </Step>
      </Section>

      <Section icon={Volume2} title="Voice Recognition">
        <p className="text-sm text-cv-text/80 mb-3">
          CardVoice uses your browser's built-in speech recognition (Chrome works best).
          It parses spoken numbers, written digits, and common misheard words.
        </p>

        <h4 className="text-xs text-cv-muted uppercase tracking-wider font-semibold mb-2">What you can say</h4>
        <VoiceExample input='"forty two fifty five one hundred three"' output="42, 55, 103" />
        <VoiceExample input='"42 55 103"' output="42, 55, 103" />
        <VoiceExample input='"42 times 3"' output="42 x3" />
        <VoiceExample input='"100 count 10"' output="100 x10" />
        <VoiceExample input='"three hundred and seven quantity 2"' output="307 x2" />

        <h4 className="text-xs text-cv-muted uppercase tracking-wider font-semibold mt-4 mb-2">Quantity words</h4>
        <p className="text-sm text-cv-text/70 mb-2">
          These all work as multipliers after a card number:
        </p>
        <div className="flex flex-wrap gap-1.5">
          {['times', 'x', 'count', 'of', 'quantity', 'qty', 'stock', 'copies', 'copy'].map(w => (
            <KeyBadge key={w}>{w}</KeyBadge>
          ))}
        </div>

        <h4 className="text-xs text-cv-muted uppercase tracking-wider font-semibold mt-4 mb-2">Misheard word fixes</h4>
        <p className="text-sm text-cv-text/70 mb-2">
          Speech recognition often mishears numbers. CardVoice auto-corrects these:
        </p>
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-1.5 text-xs font-mono">
          {[
            ['"won" / "wan"', '1'], ['"to" / "too" / "tu"', '2'], ['"tree" / "free"', '3'],
            ['"for" / "fore"', '4'], ['"fife"', '5'], ['"sick" / "sicks"', '6'],
            ['"ate"', '8'], ['"nein"', '9'], ['"tin"', '10'],
          ].map(([heard, num]) => (
            <div key={heard} className="flex items-center gap-1.5 px-2 py-1 rounded bg-cv-dark border border-cv-border">
              <span className="text-cv-muted">{heard}</span>
              <ArrowRight size={9} className="text-cv-accent" />
              <span className="text-cv-text">{num}</span>
            </div>
          ))}
        </div>
        <Tip>Chrome with maxAlternatives gives the best results. CardVoice scores multiple interpretations and picks the one that produces the most valid card numbers.</Tip>
      </Section>

      <Section icon={Keyboard} title="Manual / Typed Entry">
        <p className="text-sm text-cv-text/80 mb-3">
          The text input below the mic accepts the same syntax as voice. Type numbers separated by spaces.
        </p>
        <VoiceExample input="67 count 3 103 55 times 2" output="67 x3, 103 x1, 55 x2" />
        <VoiceExample input="three hundred forty two" output="342" />
        <Tip>You can mix digits and words freely: <KeyBadge>forty 2</KeyBadge> parses as 42.</Tip>
      </Section>
    </>
  );
}

function EditingTab() {
  return (
    <>
      <Section icon={Pencil} title="Editing the Current Batch" defaultOpen>
        <p className="text-sm text-cv-text/80 mb-3">
          Every row in the Current Batch is fully editable before you commit:
        </p>
        <div className="space-y-2 mb-3">
          <div className="flex items-start gap-2">
            <Hash size={14} className="text-cv-accent mt-0.5 flex-shrink-0" />
            <span className="text-sm text-cv-text/80">
              <strong className="text-cv-text">Card number</strong> — Click the number to change it.
              If voice heard "6" but you meant "66", just type it in.
            </span>
          </div>
          <div className="flex items-start gap-2">
            <Plus size={14} className="text-cv-accent mt-0.5 flex-shrink-0" />
            <span className="text-sm text-cv-text/80">
              <strong className="text-cv-text">Quantity</strong> — Use the <Minus size={10} className="inline" /> / <Plus size={10} className="inline" /> buttons to adjust how many copies you have.
            </span>
          </div>
          <div className="flex items-start gap-2">
            <Trash2 size={14} className="text-cv-red mt-0.5 flex-shrink-0" />
            <span className="text-sm text-cv-text/80">
              <strong className="text-cv-text">Delete</strong> — Remove a row entirely if it shouldn't be there.
            </span>
          </div>
          <div className="flex items-start gap-2">
            <Undo2 size={14} className="text-cv-muted mt-0.5 flex-shrink-0" />
            <span className="text-sm text-cv-text/80">
              <strong className="text-cv-text">Undo</strong> — Removes the last added entry. <strong className="text-cv-text">Clear</strong> wipes the entire batch.
            </span>
          </div>
        </div>
        <Warn>Undo and Clear only affect the Current Batch. Once you hit COMMIT, entries move to the Committed panel and can only be removed there individually.</Warn>
      </Section>

      <Section icon={Brain} title="Smart Context Inference">
        <p className="text-sm text-cv-text/80 mb-3">
          When you're rattling off sequential numbers (63, 64, 65...) and voice hears a single digit like "7",
          CardVoice figures out you probably meant <strong className="text-cv-accent">67</strong> based on the pattern.
        </p>

        <h4 className="text-xs text-cv-muted uppercase tracking-wider font-semibold mb-2">How it works</h4>
        <div className="space-y-1.5 mb-3">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded bg-cv-dark border border-cv-border text-xs">
            <span className="text-cv-muted">Recent entries:</span>
            <span className="text-cv-text font-mono">63, 64, 65</span>
            <ArrowRight size={11} className="text-cv-muted" />
            <span className="text-cv-muted">Voice says:</span>
            <span className="text-cv-text font-mono">"7"</span>
            <ArrowRight size={11} className="text-cv-accent" />
            <span className="text-cv-accent font-mono font-bold">67</span>
            <span className="text-cv-yellow text-[10px] uppercase font-semibold ml-1">inferred</span>
          </div>
          <div className="flex items-center gap-2 px-3 py-1.5 rounded bg-cv-dark border border-cv-border text-xs">
            <span className="text-cv-muted">Recent entries:</span>
            <span className="text-cv-text font-mono">301, 302, 303</span>
            <ArrowRight size={11} className="text-cv-muted" />
            <span className="text-cv-muted">Voice says:</span>
            <span className="text-cv-text font-mono">"4"</span>
            <ArrowRight size={11} className="text-cv-accent" />
            <span className="text-cv-accent font-mono font-bold">304</span>
          </div>
        </div>

        <p className="text-sm text-cv-text/70 mb-2">
          Inferred numbers flash <span className="text-cv-yellow font-semibold">yellow</span> with an "inferred" badge so you always know when the system made a guess.
          The badge fades after 3 seconds. If the guess was wrong, just click the number and fix it.
        </p>

        <h4 className="text-xs text-cv-muted uppercase tracking-wider font-semibold mt-4 mb-2">When it does NOT activate</h4>
        <div className="text-sm text-cv-text/70 space-y-1">
          <div className="flex items-start gap-2">
            <CornerDownRight size={12} className="text-cv-muted mt-1 flex-shrink-0" />
            <span>Fewer than 2 entries in the batch (not enough context)</span>
          </div>
          <div className="flex items-start gap-2">
            <CornerDownRight size={12} className="text-cv-muted mt-1 flex-shrink-0" />
            <span>The spoken number is already 10+ (only single digits get corrected)</span>
          </div>
          <div className="flex items-start gap-2">
            <CornerDownRight size={12} className="text-cv-muted mt-1 flex-shrink-0" />
            <span>No consistent decade pattern in the last 5 entries</span>
          </div>
          <div className="flex items-start gap-2">
            <CornerDownRight size={12} className="text-cv-muted mt-1 flex-shrink-0" />
            <span>Recent entries are all single digits (1, 2, 3...) — no decade to snap to</span>
          </div>
        </div>
      </Section>

      <Section icon={Zap} title="Correction Learning">
        <p className="text-sm text-cv-text/80 mb-3">
          CardVoice learns from your edits. When you manually correct a misheard number
          (e.g., changing "7" to "67" while in the 60s range), it remembers.
        </p>
        <Step num={1}>Voice hears "7" in the context of 60s cards.</Step>
        <Step num={2}>You edit 7 to 67 in the batch.</Step>
        <Step num={3}>After <strong className="text-cv-accent">2 corrections</strong> of the same pattern, it auto-corrects next time.</Step>
        <Tip>Corrections are stored in your browser (localStorage) and persist across sessions. They're tied to the decade context, so "7 in the 60s" is separate from "7 in the 300s".</Tip>
      </Section>
    </>
  );
}

function SetsTab() {
  return (
    <>
      <Section icon={Check} title="Commit & Save Workflow" defaultOpen>
        <p className="text-sm text-cv-text/80 mb-4">
          CardVoice uses a two-step process so you can log different card types (inserts, parallels) in a single session:
        </p>

        <div className="space-y-3 mb-4">
          <div className="flex items-start gap-3">
            <div className="p-1.5 rounded bg-cv-accent/10 flex-shrink-0 mt-0.5">
              <Mic size={14} className="text-cv-accent" />
            </div>
            <div>
              <div className="text-sm text-cv-text font-semibold">Speak / type card numbers</div>
              <div className="text-xs text-cv-text/60">Numbers land in the Current Batch with editable rows</div>
            </div>
          </div>
          <div className="flex items-center pl-4">
            <ChevronRight size={14} className="text-cv-muted" />
          </div>
          <div className="flex items-start gap-3">
            <div className="p-1.5 rounded bg-cv-accent/10 flex-shrink-0 mt-0.5">
              <Check size={14} className="text-cv-accent" />
            </div>
            <div>
              <div className="text-sm text-cv-text font-semibold">COMMIT the batch</div>
              <div className="text-xs text-cv-text/60">Locks the batch with its Insert Type + Parallel. Change those settings, then speak the next group.</div>
            </div>
          </div>
          <div className="flex items-center pl-4">
            <ChevronRight size={14} className="text-cv-muted" />
          </div>
          <div className="flex items-start gap-3">
            <div className="p-1.5 rounded bg-cv-accent/10 flex-shrink-0 mt-0.5">
              <Database size={14} className="text-cv-accent" />
            </div>
            <div>
              <div className="text-sm text-cv-text font-semibold">Save to Set</div>
              <div className="text-xs text-cv-text/60">Writes all committed batches to the database. Cards with matching numbers get their quantity added.</div>
            </div>
          </div>
        </div>

        <Warn>If you navigate away or refresh before saving, uncommitted and committed batches are lost. CardVoice will warn you, but make sure to Save to Set when you're done.</Warn>
      </Section>

      <Section icon={Settings} title="Config Bar Options">
        <div className="space-y-3">
          <div className="flex items-start gap-3">
            <div className="p-1 rounded bg-cv-dark border border-cv-border flex-shrink-0 mt-0.5">
              <Database size={12} className="text-cv-accent" />
            </div>
            <div>
              <div className="text-sm text-cv-text font-semibold">Active Set</div>
              <div className="text-xs text-cv-text/60">Which set to save cards into. You must select one before the mic activates.</div>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <div className="p-1 rounded bg-cv-dark border border-cv-border flex-shrink-0 mt-0.5">
              <Hash size={12} className="text-cv-accent" />
            </div>
            <div>
              <div className="text-sm text-cv-text font-semibold">Card # Prefix</div>
              <div className="text-xs text-cv-text/60">
                Prepended to every card number on commit. Use for insert prefixes like <KeyBadge>BP-</KeyBadge> or <KeyBadge>US</KeyBadge>.
                Voice/manual entry stays numeric — the prefix is added automatically.
              </div>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <div className="p-1 rounded bg-cv-dark border border-cv-border flex-shrink-0 mt-0.5">
              <ListChecks size={12} className="text-cv-accent" />
            </div>
            <div>
              <div className="text-sm text-cv-text font-semibold">Insert Type</div>
              <div className="text-xs text-cv-text/60">
                Categorizes cards: Base, Prospects, Rated Rookie, Chrome, etc.
                Cards with different insert types are tracked separately in the database.
              </div>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <div className="p-1 rounded bg-cv-dark border border-cv-border flex-shrink-0 mt-0.5">
              <Zap size={12} className="text-cv-yellow" />
            </div>
            <div>
              <div className="text-sm text-cv-text font-semibold">Parallel</div>
              <div className="text-xs text-cv-text/60">
                Card variant: Gold, Blue /150, Refractor, etc. Leave blank for base cards.
                Like insert type, parallels are tracked as separate entries.
              </div>
            </div>
          </div>
        </div>
      </Section>

      <Section icon={Database} title="Managing Sets">
        <div className="space-y-3">
          <div>
            <h4 className="text-sm text-cv-text font-semibold mb-1">Creating a set</h4>
            <p className="text-xs text-cv-text/60">
              Go to <Link to="/sets" className="text-cv-accent hover:underline">My Sets</Link> and click <strong>New Set</strong>.
              Enter a name, year, and brand. Or create one directly from the Voice Entry dropdown.
            </p>
          </div>
          <div>
            <h4 className="text-sm text-cv-text font-semibold mb-1">Importing a CSV checklist</h4>
            <p className="text-xs text-cv-text/60 mb-2">
              On the My Sets page, click <strong>Import CSV</strong>. The file should have headers:
            </p>
            <div className="px-3 py-2 rounded bg-cv-dark border border-cv-border text-xs font-mono text-cv-text/70">
              Card #, Player, Team, RC/SP, Insert Type, Parallel, Qty
            </div>
            <p className="text-xs text-cv-text/60 mt-1">
              The set name is taken from the filename. Cards without a card number and player are skipped.
            </p>
          </div>
          <div>
            <h4 className="text-sm text-cv-text font-semibold mb-1">Viewing & editing cards</h4>
            <p className="text-xs text-cv-text/60">
              Click a set name to see all cards. Use the search bar to filter by card number, player, or team.
              Toggle between <strong>All</strong>, <strong>Have</strong> (qty &gt; 0), and <strong>Need</strong> (qty = 0).
              Click the <Pencil size={10} className="inline text-cv-accent" /> icon on any row to edit all fields inline.
            </p>
          </div>
        </div>
      </Section>

      <Section icon={FileSpreadsheet} title="Exporting Data">
        <div className="space-y-3">
          <div className="flex items-start gap-3">
            <div className="p-1 rounded bg-cv-dark border border-cv-border flex-shrink-0 mt-0.5">
              <Download size={12} className="text-cv-accent" />
            </div>
            <div>
              <div className="text-sm text-cv-text font-semibold">Export CSV (Voice Entry)</div>
              <div className="text-xs text-cv-text/60">Exports committed batches from the current session. Good for quick logs.</div>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <div className="p-1 rounded bg-cv-dark border border-cv-border flex-shrink-0 mt-0.5">
              <FileSpreadsheet size={12} className="text-cv-accent" />
            </div>
            <div>
              <div className="text-sm text-cv-text font-semibold">Export Excel / CSV (Set Detail)</div>
              <div className="text-xs text-cv-text/60">
                From the set detail page, export the full checklist as formatted Excel (.xlsx) or CSV.
                The Excel export includes styled headers and borders. CSV only includes cards with qty &gt; 0
                — useful for eBay variation listings.
              </div>
            </div>
          </div>
        </div>
      </Section>

      <Section icon={Keyboard} title="Tips & Shortcuts">
        <div className="space-y-2 text-sm text-cv-text/80">
          <div className="flex items-start gap-2">
            <ArrowRight size={12} className="text-cv-accent mt-1 flex-shrink-0" />
            <span>Press <KeyBadge>Enter</KeyBadge> in the manual input to add numbers without clicking the button.</span>
          </div>
          <div className="flex items-start gap-2">
            <ArrowRight size={12} className="text-cv-accent mt-1 flex-shrink-0" />
            <span>Use <KeyBadge>count N</KeyBadge> for bulk quantities: "100 count 10" adds card 100 with qty 10.</span>
          </div>
          <div className="flex items-start gap-2">
            <ArrowRight size={12} className="text-cv-accent mt-1 flex-shrink-0" />
            <span>Change the Insert Type between commits to log Base, Prospects, and Inserts in one session.</span>
          </div>
          <div className="flex items-start gap-2">
            <ArrowRight size={12} className="text-cv-accent mt-1 flex-shrink-0" />
            <span>The Prefix field is great for insert sets: set it to <KeyBadge>BP-</KeyBadge> and just speak the numbers.</span>
          </div>
          <div className="flex items-start gap-2">
            <ArrowRight size={12} className="text-cv-accent mt-1 flex-shrink-0" />
            <span>Saying "card 55 q 20" activates the explicit card-quantity parser for precise control.</span>
          </div>
          <div className="flex items-start gap-2">
            <ArrowRight size={12} className="text-cv-accent mt-1 flex-shrink-0" />
            <span>Keep your microphone close. Short, clear number sequences work better than long rambling sentences.</span>
          </div>
        </div>
      </Section>
    </>
  );
}

// ---- Main HowTo page ----

export default function HowTo() {
  const [activeTab, setActiveTab] = useState('start');

  return (
    <div className="max-w-5xl mx-auto">
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-cv-text">How to Use CardVoice</h2>
        <p className="text-sm text-cv-muted mt-1">
          Voice-powered sports card inventory. Speak your card numbers, review, commit, save.
        </p>
      </div>

      {/* Tab Nav */}
      <div className="flex items-center gap-1 mb-6 bg-cv-panel rounded-lg border border-cv-border p-1">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setActiveTab(id)}
            className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all flex-1 justify-center
              ${activeTab === id
                ? 'bg-cv-accent/15 text-cv-accent border border-cv-accent/30'
                : 'text-cv-muted hover:text-cv-text hover:bg-cv-dark'
              }`}
          >
            <Icon size={16} />
            <span>{label}</span>
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {activeTab === 'start' && <GettingStartedTab />}
      {activeTab === 'editing' && <EditingTab />}
      {activeTab === 'sets' && <SetsTab />}

      <div className="text-center py-6">
        <Link to="/voice"
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm bg-cv-accent/20 border border-cv-accent/40 text-cv-accent hover:bg-cv-accent/30 transition-all font-medium">
          <Mic size={16} /> Start Voice Entry
        </Link>
      </div>
    </div>
  );
}
