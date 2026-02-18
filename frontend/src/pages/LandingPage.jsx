import React from 'react';
import { Link } from 'react-router-dom';
import { Mic, Database, ArrowRight, Shield, Zap, BarChart3 } from 'lucide-react';
import Logo from '../components/Logo';

export default function LandingPage() {
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

      {/* Features Row */}
      <div className="px-6 pb-20">
        <div className="max-w-4xl mx-auto grid grid-cols-1 sm:grid-cols-3 gap-6">
          <div className="text-center group">
            <div className="w-14 h-14 rounded-2xl bg-cv-accent/10 border border-cv-accent/20 flex items-center justify-center mx-auto mb-4 group-hover:bg-cv-accent/20 group-hover:border-cv-accent/40 transition-all duration-300">
              <Mic size={24} className="text-cv-accent" />
            </div>
            <h3 className="font-display text-cv-text font-semibold text-base mb-2">Voice Logging</h3>
            <p className="text-xs text-cv-muted leading-relaxed">
              Say card numbers out loud. Voice recognition logs them instantly with smart context inference.
            </p>
          </div>

          <div className="text-center group">
            <div className="w-14 h-14 rounded-2xl bg-cv-gold/10 border border-cv-gold/20 flex items-center justify-center mx-auto mb-4 group-hover:bg-cv-gold/20 group-hover:border-cv-gold/40 transition-all duration-300">
              <BarChart3 size={24} className="text-cv-gold" />
            </div>
            <h3 className="font-display text-cv-text font-semibold text-base mb-2">Price Tracking</h3>
            <p className="text-xs text-cv-muted leading-relaxed">
              Track portfolio value with eBay price data. Set-level and per-card pricing with historical charts.
            </p>
          </div>

          <div className="text-center group">
            <div className="w-14 h-14 rounded-2xl bg-cv-accent2/10 border border-cv-accent2/20 flex items-center justify-center mx-auto mb-4 group-hover:bg-cv-accent2/20 group-hover:border-cv-accent2/40 transition-all duration-300">
              <Database size={24} className="text-cv-accent2" />
            </div>
            <h3 className="font-display text-cv-text font-semibold text-base mb-2">Full Checklists</h3>
            <p className="text-xs text-cv-muted leading-relaxed">
              Paste Beckett checklists with auto-parsing. Sections, parallels, and card counts detected automatically.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
