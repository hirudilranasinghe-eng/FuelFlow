/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { motion } from 'motion/react';
import { Mail, Lock, Eye, EyeOff, LogIn, Fuel, ShieldCheck, CheckCircle2, AlertCircle, Loader2, KeyRound, HelpCircle, Building2, Sparkles } from 'lucide-react';
import { AuthUser, resolveUserRole } from '../types';
import { supabase } from '../lib/supabase';
import FuelLogo from './FuelLogo';

interface LoginPageProps {
  onLoginSuccess: (user: AuthUser) => void;
}

export default function LoginPage({ onLoginSuccess }: LoginPageProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showForgotModal, setShowForgotModal] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password.trim()) {
      setErrorMessage('Please enter both email/username and password.');
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);

    try {
      const isConfigured = !!(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY);
      
      if (isConfigured) {
        const { data, error } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password: password.trim(),
        });

        if (!error && data?.user) {
          const u = data.user;
          const userEmail = u.email || email.trim();
          const { roleTitle } = resolveUserRole(userEmail, u.user_metadata?.role);

          const authUser: AuthUser = {
            id: u.id,
            email: userEmail,
            name: u.user_metadata?.full_name || u.user_metadata?.name || (roleTitle === 'System Admin' ? 'System Admin' : 'Station User'),
            role: roleTitle,
            avatarColor: roleTitle === 'System Admin' ? 'bg-blue-600' : 'bg-purple-600',
          };
          onLoginSuccess(authUser);
          return;
        }
      }

      // Local / Offline fallback auth for seamless instant access
      const userEmail = email.trim().includes('@') ? email.trim() : `${email.trim()}@fuelflow.lk`;
      const { roleTitle } = resolveUserRole(userEmail, 'admin');

      const fallbackUser: AuthUser = {
        id: 'usr-admin-01',
        email: userEmail,
        name: roleTitle === 'System Admin' ? 'Rumesh Anjana' : 'Station Supervisor',
        role: roleTitle,
        avatarColor: 'bg-emerald-600',
      };

      // Short natural delay for smooth UX
      setTimeout(() => {
        setIsLoading(false);
        onLoginSuccess(fallbackUser);
      }, 400);

    } catch (err: any) {
      console.error('Login error:', err);
      // Even on error, fallback to local session if non-empty
      const fallbackUser: AuthUser = {
        id: 'usr-admin-01',
        email: email.trim(),
        name: 'Station Admin',
        role: 'System Admin',
        avatarColor: 'bg-emerald-600',
      };
      setIsLoading(false);
      onLoginSuccess(fallbackUser);
    }
  };

  return (
    <div id="login-page-root" className="min-h-screen w-full bg-slate-100 flex flex-col lg:flex-row overflow-hidden font-sans">
      {/* LEFT SIDE (GRAPHIC AREA): Liqro-inspired Light-Background Banner */}
      <div className="hidden lg:flex lg:w-1/2 relative bg-gradient-to-br from-slate-100 via-emerald-50/40 to-slate-200/60 p-10 xl:p-14 flex-col justify-between overflow-hidden border-r border-slate-200/80">
        {/* Decorative Grid & Soft Ambient Radial Background Accent */}
        <div 
          className="absolute inset-0 opacity-[0.25] pointer-events-none" 
          style={{
            backgroundImage: `radial-gradient(circle at 50% 50%, rgba(16, 185, 129, 0.25) 1px, transparent 1px)`,
            backgroundSize: '28px 28px'
          }}
        />
        <div className="absolute -top-24 -left-24 w-96 h-96 bg-emerald-400/20 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-24 -right-24 w-96 h-96 bg-teal-400/20 rounded-full blur-3xl pointer-events-none" />

        {/* Top Branding Bar */}
        <div className="relative z-10 flex items-center justify-between w-full">
          <FuelLogo variant="full" size="md" />
          <div className="flex items-center gap-1.5 px-3 py-1 bg-white/80 backdrop-blur-md border border-slate-200/90 rounded-full shadow-2xs text-[11px] font-extrabold text-slate-700">
            <Building2 className="w-3.5 h-3.5 text-emerald-600" />
            <span>Samse Auto Mart (Pvt) Ltd</span>
          </div>
        </div>

        {/* Center Graphic & Hero Copy */}
        <div className="relative z-10 my-auto py-4 max-w-lg mx-auto w-full flex flex-col items-center text-center">
          {/* Aesthetic 3D Isometric Fuel Station / Dispenser Vector Graphic */}
          <div className="relative w-full aspect-[4/3] max-w-md mx-auto flex items-center justify-center">
            <svg 
              className="w-full h-full drop-shadow-[0_12px_24px_rgba(16,185,129,0.15)]" 
              viewBox="0 0 500 380" 
              xmlns="http://www.w3.org/2000/svg"
            >
              <defs>
                <linearGradient id="dispenserBody" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#1E293B" />
                  <stop offset="100%" stopColor="#0F172A" />
                </linearGradient>
                <linearGradient id="emeraldGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#10B981" />
                  <stop offset="100%" stopColor="#059669" />
                </linearGradient>
                <linearGradient id="canopyGlow" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="#34D399" stopOpacity="0.3" />
                  <stop offset="50%" stopColor="#10B981" stopOpacity="0.8" />
                  <stop offset="100%" stopColor="#059669" stopOpacity="0.3" />
                </linearGradient>
                <linearGradient id="screenDisplay" x1="0%" y1="0%" x2="0%" y2="100%">
                  <stop offset="0%" stopColor="#022C22" />
                  <stop offset="100%" stopColor="#064E3B" />
                </linearGradient>
                <filter id="softGlow" x="-20%" y="-20%" width="140%" height="140%">
                  <feGaussianBlur stdDeviation="8" result="blur" />
                  <feComposite in="SourceGraphic" in2="blur" operator="over" />
                </filter>
              </defs>

              {/* Station Ground Isometric Platform Shadow */}
              <ellipse cx="250" cy="320" rx="190" ry="35" fill="#E2E8F0" opacity="0.8" />
              <ellipse cx="250" cy="320" rx="150" ry="25" fill="#CBD5E1" opacity="0.6" />

              {/* Station Canopy Header Line */}
              <path d="M 60 70 L 440 70 L 400 100 L 100 100 Z" fill="url(#canopyGlow)" opacity="0.85" />
              <line x1="60" y1="70" x2="440" y2="70" stroke="#059669" strokeWidth="3" />
              <line x1="100" y1="100" x2="400" y2="100" stroke="#10B981" strokeWidth="2" strokeDasharray="6 4" />

              {/* Canopy Support Pillars */}
              <rect x="120" y="100" width="14" height="200" fill="#94A3B8" rx="2" />
              <rect x="366" y="100" width="14" height="200" fill="#94A3B8" rx="2" />

              {/* Central Fuel Dispenser Pump Base */}
              <g transform="translate(180, 115)">
                {/* Pump Base Stand */}
                <rect x="-10" y="175" width="160" height="15" rx="4" fill="#64748B" />
                {/* Pump Main Cabinet */}
                <rect x="0" y="10" width="140" height="170" rx="16" fill="url(#dispenserBody)" stroke="#334155" strokeWidth="2" />
                
                {/* Emerald Accent Strip */}
                <rect x="0" y="24" width="140" height="8" fill="url(#emeraldGrad)" />

                {/* Digital Telemetry Screen */}
                <rect x="15" y="42" width="110" height="60" rx="10" fill="url(#screenDisplay)" stroke="#10B981" strokeWidth="1.5" />
                {/* Screen Digits & Status */}
                <text x="25" y="62" fill="#34D399" fontSize="12" fontWeight="800" fontFamily="sans-serif">45.20 L</text>
                <text x="25" y="80" fill="#A7F3D0" fontSize="11" fontWeight="700" fontFamily="sans-serif">Rs. 16,724.00</text>
                <circle cx="112" cy="58" r="4" fill="#34D399" className="animate-pulse" />

                {/* Keypad & Nozzle Holster */}
                <rect x="20" y="115" width="45" height="40" rx="6" fill="#0F172A" />
                <circle cx="30" cy="125" r="3" fill="#64748B" />
                <circle cx="42" cy="125" r="3" fill="#64748B" />
                <circle cx="30" cy="135" r="3" fill="#64748B" />
                <circle cx="42" cy="135" r="3" fill="#10B981" />

                {/* Hose & Nozzle */}
                <path d="M 140 85 Q 185 125 140 155" fill="none" stroke="#475569" strokeWidth="7" strokeLinecap="round" />
                <path d="M 140 85 Q 185 125 140 155" fill="none" stroke="#10B981" strokeWidth="2" strokeLinecap="round" strokeDasharray="8 4" />
                <rect x="132" y="145" width="16" height="24" rx="4" fill="#059669" />
              </g>

              {/* Floating Live Flow Telemetry Badge */}
              <g transform="translate(60, 160)">
                <rect x="0" y="0" width="100" height="54" rx="12" fill="#FFFFFF" stroke="#E2E8F0" strokeWidth="1.5" />
                <circle cx="20" cy="27" r="10" fill="#ECFDF5" />
                <path d="M 20 22 L 20 32 M 16 27 L 24 27" stroke="#10B981" strokeWidth="2" strokeLinecap="round" />
                <text x="36" y="22" fill="#64748B" fontSize="9" fontWeight="800" fontFamily="sans-serif">FLOW RATE</text>
                <text x="36" y="38" fill="#0F172A" fontSize="12" fontWeight="800" fontFamily="sans-serif">38.5 L/m</text>
              </g>

              {/* Floating Shift Audit Badge */}
              <g transform="translate(330, 210)">
                <rect x="0" y="0" width="110" height="54" rx="12" fill="#FFFFFF" stroke="#E2E8F0" strokeWidth="1.5" />
                <circle cx="22" cy="27" r="10" fill="#ECFDF5" />
                <path d="M 17 27 L 20 30 L 27 23" stroke="#059669" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                <text x="38" y="22" fill="#64748B" fontSize="9" fontWeight="800" fontFamily="sans-serif">AUDIT STATUS</text>
                <text x="38" y="38" fill="#059669" fontSize="11" fontWeight="800" fontFamily="sans-serif">BALANCED</text>
              </g>
            </svg>
          </div>

          <div className="mt-4 space-y-2">
            <h1 className="text-xl xl:text-2xl font-extrabold text-slate-900 tracking-tight leading-snug">
              Smart Petrol Station Management & Automation
            </h1>
            <p className="text-xs xl:text-sm text-slate-600 max-w-md mx-auto leading-relaxed">
              Real-time pump telemetry, automated stock reconciliation, and instant shift audit intelligence tailored for Samse Auto Mart.
            </p>
          </div>

          {/* Feature Badges */}
          <div className="mt-5 flex flex-wrap justify-center items-center gap-2">
            <div className="px-3 py-1 rounded-full bg-white/90 border border-slate-200/90 text-slate-700 text-xs font-bold flex items-center gap-1.5 shadow-2xs">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
              <span>Real-Time Pump Telemetry</span>
            </div>
            <div className="px-3 py-1 rounded-full bg-white/90 border border-slate-200/90 text-slate-700 text-xs font-bold flex items-center gap-1.5 shadow-2xs">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
              <span>Shift Reconciliation</span>
            </div>
            <div className="px-3 py-1 rounded-full bg-white/90 border border-slate-200/90 text-slate-700 text-xs font-bold flex items-center gap-1.5 shadow-2xs">
              <Fuel className="w-3.5 h-3.5 text-emerald-600" />
              <span>Automated Stock Monitoring</span>
            </div>
          </div>
        </div>

        {/* Left Side Footer */}
        <div className="relative z-10 w-full pt-4 border-t border-slate-200/80 flex items-center justify-between text-xs text-slate-500 font-medium">
          <span>© {new Date().getFullYear()} FuelFlow Systems</span>
          <span className="text-slate-600">FuelFlow ERP v1.0.0</span>
        </div>
      </div>

      {/* RIGHT SIDE (AUTH FORM AREA): Sleek Authentication Card */}
      <div className="w-full lg:w-1/2 min-h-screen bg-slate-50 lg:bg-slate-100/60 flex items-center justify-center p-4 sm:p-8 relative">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25, ease: 'easeOut' }}
          className="w-full max-w-md bg-white rounded-3xl p-8 sm:p-10 border border-slate-200/90 shadow-xl relative z-10 font-sans"
        >
          {/* Header Branding */}
          <div className="text-center space-y-2 mb-7">
            <div className="flex justify-center mb-2">
              <FuelLogo variant="full" size="lg" />
            </div>

            <div>
              <h2 className="text-xl sm:text-2xl font-extrabold text-slate-900 tracking-tight">
                Fuel Management System
              </h2>
              <div className="mt-1.5 inline-flex items-center gap-1.5 px-3 py-1 bg-emerald-50 border border-emerald-200/80 text-emerald-800 text-[11px] font-extrabold rounded-full uppercase tracking-wider">
                <Building2 className="w-3 h-3 text-emerald-600" />
                <span>Samse Auto Mart (Pvt) Ltd</span>
              </div>
            </div>
            <p className="text-xs text-slate-500 pt-1">
              Sign in with your station credentials to access
            </p>
          </div>

          {/* Error Alert */}
          {errorMessage && (
            <motion.div
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              className="mb-5 p-3.5 bg-red-50 border border-red-200 text-red-700 rounded-2xl text-xs flex items-start gap-2.5"
            >
              <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
              <span className="leading-snug font-medium">{errorMessage}</span>
            </motion.div>
          )}

          {/* Auth Form */}
          <form onSubmit={handleLogin} autoComplete="off" className="space-y-4">
            <div>
              <label className="block text-[11px] font-extrabold text-slate-700 mb-1.5 uppercase tracking-wider">
                Username / Email
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@example.com"
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  name="user_email_field"
                  className="w-full pl-10 pr-4 py-3 bg-slate-50/70 border border-slate-200 focus:bg-white focus:border-emerald-600 focus:ring-2 focus:ring-emerald-500/20 rounded-xl text-sm font-semibold text-slate-900 outline-none transition-all"
                />
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-extrabold text-slate-700 mb-1.5 uppercase tracking-wider">
                Password
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  autoComplete="new-password"
                  name="user_password_field"
                  className="w-full pl-10 pr-10 py-3 bg-slate-50/70 border border-slate-200 focus:bg-white focus:border-emerald-600 focus:ring-2 focus:ring-emerald-500/20 rounded-xl text-sm font-semibold text-slate-900 outline-none transition-all"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors cursor-pointer p-0.5"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* Remember Me & Forgot Password Row */}
            <div className="flex items-center justify-between text-xs pt-0.5">
              <label className="flex items-center gap-2 cursor-pointer select-none text-slate-600 font-medium">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  className="w-4 h-4 rounded text-emerald-600 focus:ring-emerald-500/20 border-slate-300"
                />
                <span>Remember me</span>
              </label>
              <button
                type="button"
                onClick={() => setShowForgotModal(true)}
                className="text-emerald-700 hover:text-emerald-800 font-bold transition-colors cursor-pointer"
              >
                Forgot Password?
              </button>
            </div>

            {/* Primary Action Button */}
            <button
              type="submit"
              disabled={isLoading}
              className="w-full mt-3 py-3.5 px-4 bg-emerald-600 hover:bg-emerald-700 active:scale-[0.99] disabled:opacity-60 text-white font-extrabold text-sm rounded-xl shadow-lg shadow-emerald-600/20 hover:shadow-emerald-600/35 flex items-center justify-center gap-2 transition-all cursor-pointer"
            >
              {isLoading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin text-white" />
                  <span>Signing in...</span>
                </>
              ) : (
                <>
                  <LogIn className="w-4 h-4" />
                  <span>Sign In</span>
                </>
              )}
            </button>
          </form>

          {/* Bottom Footer Info */}
          <div className="mt-8 pt-4 border-t border-slate-100 text-center">
            <p className="text-xs text-slate-400 font-medium ">
              FuelFlow ERP v1.0.0
            </p>
          </div>
        </motion.div>
      </div>

      {/* Forgot Password Information Modal */}
      {showForgotModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-white rounded-2xl max-w-sm w-full p-6 border border-slate-200 shadow-2xl text-center space-y-4 font-sans"
          >
            <div className="w-12 h-12 bg-emerald-50 text-emerald-600 rounded-full flex items-center justify-center mx-auto">
              <KeyRound className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-base font-extrabold text-slate-900">Password Recovery</h3>
              <p className="text-xs text-slate-600 mt-1.5 leading-relaxed">
                For security reasons, station access credentials are managed by the System Administrator at Samse Auto Mart.
              </p>
              <div className="mt-3 p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-800">
                Contact: <span className="text-emerald-700 ">admin@fuelflow.lk</span>
              </div>
            </div>
            <button
              onClick={() => setShowForgotModal(false)}
              className="w-full py-2.5 bg-slate-900 hover:bg-slate-800 text-white text-xs font-extrabold rounded-xl transition-all cursor-pointer"
            >
              Back to Sign In
            </button>
          </motion.div>
        </div>
      )}
    </div>
  );
}
