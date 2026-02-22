import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Mic, ArrowRight, Zap } from 'lucide-react';
import Logo from '../components/Logo';

function fmtDateLong(d) {
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function LandingPage() {
  const [releases, setReleases] = useState([]);
  const [appVersion, setAppVersion] = useState(null);

  useEffect(() => {
    fetch('https://api.github.com/repos/JCHanratty/CardVoice/releases?per_page=3')
      .then(r => r.json())
      .then(data => { if (Array.isArray(data)) setReleases(data); })
      .catch(() => {});

    if (window.electronAPI?.getAppVersion) {
      window.electronAPI.getAppVersion().then(v => setAppVersion(v)).catch(() => {});
    }
  }, []);

  return (
    <div className="min-h-screen bg-cv-dark flex flex-col">
      {/* Accent bar */}
      <div className="accent-bar" />

      {/* Hero Section */}
      <div className="flex-1 flex flex-col items-center justify-center relative overflow-hidden px-6 py-20">
        {/* Background effects */}
        <div className="absolute inset-0 hero-grid opacity-[0.02]" />
        <div className="absolute -top-40 -right-40 w-[500px] h-[500px] bg-cv-accent/8 rounded-full blur-[120px] pointer-events-none" />
        <div className="absolute -bottom-40 -left-40 w-[400px] h-[400px] bg-cv-gold/6 rounded-full blur-[120px] pointer-events-none" />
        <div className="absolute top-1/3 left-1/2 -translate-x-1/2 w-[300px] h-[300px] bg-cv-accent2/5 rounded-full blur-[100px] pointer-events-none" />

        <div className="relative fade-in-up text-center max-w-3xl mx-auto">
          {/* Logo */}
          <div className="mb-8 relative inline-block">
            <div className="absolute inset-0 blur-3xl bg-cv-accent/15 rounded-full scale-[2] pointer-events-none" />
            <div className="vault-glow rounded-full p-4 relative">
              <Logo size={120} />
            </div>
          </div>

          {/* Title */}
          <h1 className="text-5xl sm:text-6xl lg:text-7xl font-display font-bold text-cv-text tracking-tight mb-4">
            Card<span className="text-gold-shimmer">Voice</span>
          </h1>

          {/* Tagline */}
          <p className="text-cv-muted text-lg sm:text-xl max-w-xl mx-auto mb-4 leading-relaxed font-light">
            The hands-free way to manage your sports card collection.
          </p>
          <p className="text-cv-muted/70 text-sm max-w-md mx-auto mb-12">
            Speak your cards, parse checklists, track what you own.
            Built for serious collectors.
          </p>

          {/* CTA Buttons */}
          <div className="flex flex-wrap items-center justify-center gap-4">
            <Link to="/dashboard"
              className="group flex items-center gap-2.5 px-8 py-3.5 rounded-xl text-sm font-semibold bg-gradient-to-r from-cv-accent to-cv-accent2 text-white hover:shadow-lg hover:shadow-cv-accent/25 transition-all duration-300">
              Enter the Vault <ArrowRight size={18} className="group-hover:translate-x-1 transition-transform" />
            </Link>
            <Link to="/voice"
              className="flex items-center gap-2.5 px-8 py-3.5 rounded-xl text-sm font-semibold border border-cv-gold/30 text-cv-gold hover:bg-cv-gold/10 hover:border-cv-gold/50 transition-all duration-300">
              <Mic size={18} /> Start Voice Entry
            </Link>
          </div>
        </div>
      </div>

      {/* What's New */}
      {releases.length > 0 && (
        <div className="px-6 pb-16">
          <div className="max-w-2xl mx-auto">
            <h2 className="text-sm font-semibold text-cv-muted uppercase tracking-widest mb-4 text-center font-display flex items-center justify-center gap-2">
              <Zap size={14} className="text-cv-gold" />
              What's New
              {appVersion && <span className="text-[0.7rem] font-mono text-cv-muted/60 ml-2">v{appVersion}</span>}
            </h2>
            <div className="space-y-3">
              {releases.slice(0, 3).map(release => (
                <div key={release.id} className="p-4 rounded-xl bg-cv-panel/40 border border-cv-border/30">
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="text-cv-gold font-mono text-sm font-bold">{release.tag_name}</span>
                    <span className="text-cv-muted text-xs">
                      {fmtDateLong(release.published_at)}
                    </span>
                  </div>
                  <p className="text-cv-text text-sm leading-relaxed whitespace-pre-wrap">
                    {(release.body || 'No release notes.').slice(0, 300)}
                    {(release.body || '').length > 300 ? '...' : ''}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
