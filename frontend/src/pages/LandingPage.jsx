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
  const [updateInfo, setUpdateInfo] = useState(null);
  const [updateReady, setUpdateReady] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(null);

  useEffect(() => {
    fetch('https://api.github.com/repos/JCHanratty/CardVoice/releases?per_page=3')
      .then(r => r.json())
      .then(data => { if (Array.isArray(data)) setReleases(data); })
      .catch(() => {});

    if (window.electronAPI?.getAppVersion) {
      window.electronAPI.getAppVersion().then(v => setAppVersion(v)).catch(() => {});
    }

    if (window.electronAPI) {
      window.electronAPI.onUpdateAvailable((info) => setUpdateInfo(info));
      window.electronAPI.onDownloadProgress((progress) => setDownloadProgress(progress));
      window.electronAPI.onUpdateDownloaded((info) => {
        setUpdateInfo(info);
        setUpdateReady(true);
        setDownloadProgress(null);
      });
      window.electronAPI.onUpdateError?.(() => {
        setDownloadProgress(null);
        setUpdateInfo(null);
      });
    }
  }, []);

  return (
    <div className="min-h-screen bg-cv-dark flex flex-col">
      {/* Update Modal */}
      {updateReady && updateInfo && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-cv-panel border border-cv-border rounded-2xl p-8 max-w-sm w-full mx-4 shadow-2xl">
            <h2 className="text-xl font-display font-bold text-cv-text text-center mb-1">
              CardVoice v{updateInfo.version}
            </h2>
            <p className="text-sm text-cv-muted text-center mb-6">
              A new version has been downloaded and is ready to install.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => window.electronAPI?.quitAndInstall()}
                className="flex-1 px-4 py-2.5 rounded-xl text-sm font-medium bg-gradient-to-r from-cv-accent to-cv-accent2 text-white hover:shadow-lg hover:shadow-cv-accent/20 transition-all"
              >
                Restart Now
              </button>
              <button
                onClick={() => setUpdateReady(false)}
                className="flex-1 px-4 py-2.5 rounded-xl text-sm font-medium bg-white/5 border border-cv-border/50 text-cv-muted hover:text-cv-text hover:bg-white/10 transition-all"
              >
                Later
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Download progress banner */}
      {updateInfo && !updateReady && (
        <div className="fixed top-0 left-0 right-0 z-50 bg-cv-panel/95 border-b border-cv-gold/30 backdrop-blur-sm">
          <div className="px-4 py-2 flex items-center justify-between">
            <span className="text-sm text-cv-gold font-medium">
              Downloading CardVoice v{updateInfo.version}...
            </span>
            <span className="text-xs text-cv-muted font-mono">
              {downloadProgress ? `${downloadProgress.percent}%` : 'Starting...'}
            </span>
          </div>
          <div className="h-1 bg-cv-border/30">
            <div
              className="h-full bg-gradient-to-r from-cv-accent to-cv-gold transition-all duration-300"
              style={{ width: `${downloadProgress?.percent || 0}%` }}
            />
          </div>
        </div>
      )}
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
