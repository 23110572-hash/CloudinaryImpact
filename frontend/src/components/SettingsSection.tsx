import React, { useEffect, useState } from 'react';
import {
  Key, Check, ShieldCheck, AlertCircle, RefreshCw, Cpu, Cloud, CheckCircle2, User, Mail, Lock,
  LogIn, UserPlus, LogOut, Eye, EyeOff, Zap, Trash2,
} from 'lucide-react';
import { api, SettingsData, UserInfo } from '../services/api';

interface SettingsSectionProps {
  settings: SettingsData | null;
  currentUser: UserInfo | null;
  onUserChanged: (user: UserInfo | null) => void;
  onSettingsSaved: (s: SettingsData) => void;
  onSignOut: () => void;
}

const inputCls =
  'w-full py-2.5 rounded-xl border border-slate-200 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500 bg-slate-50/50';

type Status = { ok: boolean; message: string } | null;

const StatusLine: React.FC<{ status: Status }> = ({ status }) =>
  status ? (
    <div className={`text-xs font-bold flex items-center gap-1.5 animate-fade-in ${status.ok ? 'text-emerald-700' : 'text-rose-600'}`} role="status">
      {status.ok ? <Check className="w-4 h-4 shrink-0" /> : <AlertCircle className="w-4 h-4 shrink-0" />}
      <span>{status.message}</span>
    </div>
  ) : null;

/* ------------------------------------------------------------------ */
/* Sign in / Register (shown only when signed out)                     */
/* ------------------------------------------------------------------ */
const AuthCard: React.FC<{ onUserChanged: (u: UserInfo) => void }> = ({ onUserChanged }) => {
  const [mode, setMode] = useState<'signin' | 'register'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [fullName, setFullName] = useState('');
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState<'form' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (mode === 'register') {
      if (!fullName.trim()) return setError('Please enter your name.');
      if (password.length < 6) return setError('Password must be at least 6 characters.');
      if (password !== confirm) return setError('Passwords do not match.');
    }
    setLoading('form');
    try {
      const res = mode === 'signin'
        ? await api.login(email.trim(), password)
        : await api.register(email.trim(), password, fullName.trim());
      onUserChanged(res.user);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(null);
    }
  };

  return (
    <div className="max-w-md mx-auto bg-white/95 backdrop-blur-xl rounded-3xl p-6 sm:p-8 border border-sky-100 shadow-lg shadow-sky-950/5 space-y-6">
      <div className="text-center">
        <h2 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
          {mode === 'signin' ? 'Welcome back' : 'Create your account'}
        </h2>
        <p className="mt-1 text-sm text-slate-500">Your media, Buddy chats and reports stay private to your account.</p>
      </div>

      <div className="grid grid-cols-2 p-1 rounded-full bg-slate-100" role="tablist">
        {(['signin', 'register'] as const).map((m) => (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={mode === m}
            onClick={() => { setMode(m); setError(null); }}
            className={`py-2 rounded-full text-sm font-bold flex items-center justify-center gap-1.5 transition-all duration-300 ${mode === m ? 'bg-white text-sky-700 shadow' : 'text-slate-500'}`}
          >
            {m === 'signin' ? <LogIn className="w-4 h-4" /> : <UserPlus className="w-4 h-4" />}
            {m === 'signin' ? 'Sign In' : 'Register'}
          </button>
        ))}
      </div>

      {error && (
        <div className="p-3 rounded-2xl bg-rose-50 border border-rose-200 text-rose-700 text-sm font-semibold flex items-center gap-2 animate-fade-in" role="alert">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <form onSubmit={submit} className="space-y-4">
        {mode === 'register' && (
          <div className="relative animate-fade-in">
            <label htmlFor="auth-name" className="sr-only">Full name</label>
            <User className="w-4 h-4 text-slate-400 absolute left-3.5 top-3.5" />
            <input id="auth-name" type="text" autoComplete="name" placeholder="Full name" value={fullName} onChange={(e) => setFullName(e.target.value)} className={`${inputCls} pl-10 pr-4`} />
          </div>
        )}
        <div className="relative">
          <label htmlFor="auth-email" className="sr-only">Email</label>
          <Mail className="w-4 h-4 text-slate-400 absolute left-3.5 top-3.5" />
          <input id="auth-email" type="email" required autoComplete="email" placeholder="Email address" value={email} onChange={(e) => setEmail(e.target.value)} className={`${inputCls} pl-10 pr-4`} />
        </div>
        <div className="relative">
          <label htmlFor="auth-pass" className="sr-only">Password</label>
          <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-3.5" />
          <input
            id="auth-pass"
            type={show ? 'text' : 'password'}
            required
            autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
            placeholder={mode === 'signin' ? 'Password' : 'Password (6+ characters)'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={`${inputCls} pl-10 pr-10`}
          />
          <button type="button" onClick={() => setShow(!show)} className="absolute right-3.5 top-3 text-slate-400 hover:text-slate-600" aria-label={show ? 'Hide password' : 'Show password'}>
            {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        </div>
        {mode === 'register' && (
          <div className="relative animate-fade-in">
            <label htmlFor="auth-confirm" className="sr-only">Confirm password</label>
            <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-3.5" />
            <input id="auth-confirm" type={show ? 'text' : 'password'} autoComplete="new-password" placeholder="Confirm password" value={confirm} onChange={(e) => setConfirm(e.target.value)} className={`${inputCls} pl-10 pr-4`} />
          </div>
        )}
        <button
          type="submit"
          disabled={!!loading}
          className="w-full py-3 rounded-full bg-gradient-to-r from-sky-600 to-blue-600 hover:from-sky-700 hover:to-blue-700 text-white font-bold text-sm shadow-md shadow-sky-600/20 transition-all flex items-center justify-center gap-2 disabled:opacity-60"
        >
          {loading === 'form' ? <RefreshCw className="w-4 h-4 animate-spin" /> : mode === 'signin' ? <LogIn className="w-4 h-4" /> : <UserPlus className="w-4 h-4" />}
          {mode === 'signin' ? 'Sign In' : 'Create Account'}
        </button>
      </form>
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* Settings (shown only when signed in)                                */
/* ------------------------------------------------------------------ */
export const SettingsSection: React.FC<SettingsSectionProps> = ({ settings, currentUser, onUserChanged, onSettingsSaved, onSignOut }) => {
  const [llmMode, setLlmMode] = useState<'system' | 'byok'>('system');
  const [provider, setProvider] = useState('openrouter');
  const [model, setModel] = useState('');
  const [keyInput, setKeyInput] = useState<Record<string, string>>({});
  const [showKey, setShowKey] = useState(false);

  const [cloudName, setCloudName] = useState('');
  const [cloudKey, setCloudKey] = useState('');
  const [cloudSecret, setCloudSecret] = useState('');

  const [testing, setTesting] = useState<'llm' | 'cloud' | null>(null);
  const [llmStatus, setLlmStatus] = useState<Status>(null);
  const [cloudStatus, setCloudStatus] = useState<Status>(null);
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<Status>(null);

  // Keep the form in sync with what the server has (settings load after mount, and after each save)
  useEffect(() => {
    if (!settings) return;
    setLlmMode(settings.llm_mode || 'system');
    setProvider(settings.active_provider || 'openrouter');
    setModel(settings.active_model || '');
    setCloudName(settings.cloudinary?.cloud_name || '');
    setKeyInput({});
    setCloudKey('');
    setCloudSecret('');
  }, [settings]);

  if (!currentUser) {
    return (
      <div className="px-4 py-10">
        <AuthCard onUserChanged={onUserChanged} />
      </div>
    );
  }

  const providers = settings?.supported_providers || [];
  const current = providers.find((p) => p.id === provider);
  const savedKey = settings?.masked_keys?.[provider];
  const hasKey = !!savedKey || !!keyInput[provider]?.trim();
  const systemAI = settings?.system_ai;

  const selectProvider = (id: string) => {
    setProvider(id);
    const p = providers.find((x) => x.id === id);
    // Keep the saved model when returning to the saved provider, otherwise suggest the first one
    setModel(id === settings?.active_provider ? settings.active_model : p?.models[0] || '');
    setLlmStatus(null);
  };

  const testLlmKey = async () => {
    setTesting('llm');
    setLlmStatus(null);
    try {
      const r = await api.testKey(provider, keyInput[provider] || '', model);
      setLlmStatus({ ok: r.valid, message: r.message });
    } catch (e: any) {
      setLlmStatus({ ok: false, message: e.message });
    } finally {
      setTesting(null);
    }
  };

  const testCloud = async () => {
    setTesting('cloud');
    setCloudStatus(null);
    try {
      const r = await api.testCloudinary();
      setCloudStatus({ ok: r.valid, message: r.message });
    } catch (e: any) {
      setCloudStatus({ ok: false, message: e.message });
    } finally {
      setTesting(null);
    }
  };

  const save = async (extra: Record<string, any> = {}) => {
    setSaveStatus(null);
    if (llmMode === 'byok' && !hasKey && !extra.remove_keys) {
      setSaveStatus({ ok: false, message: `Add a ${current?.name || provider} API key, or switch to System Managed.` });
      return;
    }
    const cloudFields = [cloudName.trim(), cloudKey.trim(), cloudSecret.trim()];
    const alreadyConfigured = !!settings?.cloudinary?.configured;
    if (!extra.clear_cloudinary && (cloudKey.trim() || cloudSecret.trim() || (!alreadyConfigured && cloudName.trim()))) {
      if (!alreadyConfigured && cloudFields.some((f) => !f)) {
        setSaveStatus({ ok: false, message: 'Cloudinary needs all three: Cloud Name, API Key and API Secret.' });
        return;
      }
    }

    setSaving(true);
    try {
      const res = await api.updateSettings({
        llm_mode: llmMode,
        active_provider: provider,
        active_model: model.trim() || current?.models[0],
        api_keys: keyInput,
        cloudinary_cloud_name: cloudName.trim() || undefined,
        cloudinary_api_key: cloudKey.trim() || undefined,
        cloudinary_api_secret: cloudSecret.trim() || undefined,
        ...extra,
      });
      onSettingsSaved(res.settings);
      setSaveStatus({ ok: true, message: 'Settings saved.' });
      setTimeout(() => setSaveStatus(null), 3500);
    } catch (e: any) {
      setSaveStatus({ ok: false, message: e.message });
    } finally {
      setSaving(false);
    }
  };

  const removeKey = () => {
    if (!window.confirm(`Remove the saved ${current?.name} key?`)) return;
    save({ remove_keys: [provider], llm_mode: llmMode === 'byok' ? 'system' : llmMode });
  };

  const disconnectCloudinary = () => {
    if (!window.confirm('Disconnect your Cloudinary account? New uploads will use the platform Cloudinary account.')) return;
    save({ clear_cloudinary: true, cloudinary_cloud_name: undefined, cloudinary_api_key: undefined, cloudinary_api_secret: undefined });
  };

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 space-y-6">
      {/* Profile */}
      <div className="bg-white/95 rounded-3xl p-6 border border-sky-100 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-4 min-w-0">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-sky-600 to-blue-600 text-white font-extrabold text-xl flex items-center justify-center shadow-md shadow-sky-500/20 shrink-0">
            {(currentUser.full_name || currentUser.email).charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0">
            <h3 className="text-lg font-extrabold text-slate-900 truncate">{currentUser.full_name}</h3>
            <p className="text-sm text-slate-600 flex items-center gap-1.5 truncate"><Mail className="w-3.5 h-3.5 text-slate-400" />{currentUser.email}</p>
          </div>
        </div>
        <button onClick={onSignOut} className="self-start sm:self-center px-4 py-2 rounded-xl border border-rose-200 bg-rose-50/80 hover:bg-rose-100 text-rose-700 font-bold text-sm flex items-center gap-2">
          <LogOut className="w-4 h-4" /> Sign Out
        </button>
      </div>

      {!settings ? (
        <div className="bg-white/90 rounded-3xl p-8 border border-sky-100 text-center text-slate-500 text-sm">
          <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2" /> Loading settings…
        </div>
      ) : (
        <>
          {/* AI model */}
          <section className="bg-white/95 rounded-3xl p-6 sm:p-8 border border-sky-100 shadow-sm space-y-6">
            <div>
              <h3 className="text-xl font-extrabold text-slate-900 flex items-center gap-2"><Cpu className="w-5 h-5 text-sky-600" /> AI model</h3>
              <p className="mt-1 text-sm text-slate-500">Powers photo analysis, Buddy, comparisons and reports.</p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3" role="radiogroup" aria-label="AI mode">
              {([
                { id: 'system', title: 'System Managed', badge: systemAI?.live ? 'Live' : 'Not configured', desc: systemAI?.live ? `Uses the platform's ${systemAI.provider} key (${systemAI.model}). Nothing to set up.` : 'No platform AI key is set on this server. Add your own key below to use AI features.' },
                { id: 'byok', title: 'Bring Your Own Key', badge: 'Custom', desc: 'Use your own OpenRouter, OpenAI, Gemini, Claude or Groq key and pick the model.' },
              ] as const).map((opt) => {
                const active = llmMode === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => { setLlmMode(opt.id); setSaveStatus(null); }}
                    className={`text-left p-4 rounded-2xl border-2 transition-all duration-300 ${active ? 'border-sky-600 bg-sky-50/70 shadow-sm' : 'border-slate-200 hover:border-slate-300 bg-white'}`}
                  >
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="font-extrabold text-slate-900 flex items-center gap-1.5">
                        {opt.id === 'system' ? <Zap className="w-4 h-4 text-sky-600" /> : <Key className="w-4 h-4 text-indigo-600" />}
                        {opt.title}
                      </span>
                      <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${
                        opt.id === 'byok' ? 'bg-indigo-100 text-indigo-800' : systemAI?.live ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
                      }`}>{opt.badge}</span>
                    </div>
                    <p className="text-xs text-slate-600 leading-relaxed">{opt.desc}</p>
                  </button>
                );
              })}
            </div>

            {llmMode === 'byok' && (
              <div className="p-5 rounded-2xl bg-slate-50 border border-slate-200 space-y-5 animate-fade-in">
                <div>
                  <span className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-2">Provider</span>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {providers.map((p) => {
                      const sel = provider === p.id;
                      const configured = !!settings.masked_keys?.[p.id];
                      return (
                        <button key={p.id} type="button" onClick={() => selectProvider(p.id)} aria-pressed={sel}
                          className={`p-2.5 rounded-xl border text-left transition-all ${sel ? 'border-indigo-600 bg-indigo-600 text-white shadow-sm' : 'border-slate-200 bg-white hover:bg-slate-100 text-slate-800'}`}>
                          <div className="text-sm font-bold truncate">{p.name}</div>
                          <div className={`text-[10px] mt-0.5 ${sel ? 'text-white/80' : configured ? 'text-emerald-600' : 'text-slate-400'}`}>
                            {configured ? '● Key saved' : '○ No key'}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <label htmlFor="byok-model" className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1.5">Model</label>
                  <input id="byok-model" list="byok-model-options" value={model} onChange={(e) => setModel(e.target.value)} placeholder={current?.models[0]}
                    className="w-full p-2.5 rounded-xl border border-slate-200 bg-white text-slate-800 font-semibold text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                  <datalist id="byok-model-options">{current?.models.map((m) => <option key={m} value={m} />)}</datalist>
                  <p className="mt-1 text-[11px] text-slate-500">Pick a suggestion or type any vision-capable model id your provider supports.</p>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label htmlFor="byok-key" className="text-xs font-bold uppercase tracking-wider text-slate-600">{current?.name} API key</label>
                    {savedKey && (
                      <span className="flex items-center gap-2 text-xs text-slate-500 font-mono">
                        Saved: {savedKey}
                        <button onClick={removeKey} className="text-rose-500 hover:text-rose-700" aria-label="Remove saved key"><Trash2 className="w-3.5 h-3.5" /></button>
                      </span>
                    )}
                  </div>
                  <div className="relative">
                    <input
                      id="byok-key"
                      type={showKey ? 'text' : 'password'}
                      autoComplete="off"
                      placeholder={savedKey ? 'Enter a new key to replace the saved one' : current?.key_hint || 'API key'}
                      value={keyInput[provider] || ''}
                      onChange={(e) => { setKeyInput({ ...keyInput, [provider]: e.target.value }); setLlmStatus(null); }}
                      className="w-full p-2.5 pr-10 rounded-xl border border-slate-200 bg-white text-slate-800 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                    <button type="button" onClick={() => setShowKey(!showKey)} className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-600" aria-label={showKey ? 'Hide key' : 'Show key'}>
                      {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                  <p className="mt-1 text-[11px] text-slate-500">Keys are stored on the server for your account and never shown again in full.</p>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <button type="button" onClick={testLlmKey} disabled={testing === 'llm' || !hasKey}
                    className="px-3.5 py-1.5 rounded-xl border border-indigo-200 bg-white hover:bg-indigo-50 text-indigo-700 font-bold text-xs flex items-center gap-1.5 disabled:opacity-50">
                    {testing === 'llm' ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <ShieldCheck className="w-3.5 h-3.5" />}
                    Test key
                  </button>
                  <StatusLine status={llmStatus} />
                </div>
              </div>
            )}
          </section>

          {/* Cloudinary */}
          <section className="bg-white/95 rounded-3xl p-6 sm:p-8 border border-sky-100 shadow-sm space-y-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="text-xl font-extrabold text-slate-900 flex items-center gap-2"><Cloud className="w-5 h-5 text-sky-600" /> Cloudinary account</h3>
                <p className="mt-1 text-sm text-slate-500">
                  {settings.cloudinary.configured
                    ? `Uploads go to your cloud "${settings.cloudinary.cloud_name}".`
                    : settings.cloudinary.system_configured
                    ? 'Optional. Uploads currently go to the platform Cloudinary account.'
                    : 'Not connected. Uploads are stored locally on the server until you connect Cloudinary.'}
                </p>
              </div>
              <span className={`text-[11px] font-bold px-2.5 py-1 rounded-full ${settings.cloudinary.configured ? 'bg-emerald-100 text-emerald-800' : settings.cloudinary.system_configured ? 'bg-sky-100 text-sky-800' : 'bg-amber-100 text-amber-800'}`}>
                {settings.cloudinary.configured ? 'Your account' : settings.cloudinary.system_configured ? 'Platform account' : 'Not configured'}
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label htmlFor="cl-name" className="block text-xs font-bold text-slate-600 mb-1">Cloud name</label>
                <input id="cl-name" type="text" autoComplete="off" placeholder="e.g. my-ngo-cloud" value={cloudName} onChange={(e) => setCloudName(e.target.value)} className={`${inputCls} px-3`} />
              </div>
              <div>
                <label htmlFor="cl-key" className="block text-xs font-bold text-slate-600 mb-1">API key</label>
                <input id="cl-key" type="password" autoComplete="off" placeholder={settings.cloudinary.masked_api_key || 'API key'} value={cloudKey} onChange={(e) => setCloudKey(e.target.value)} className={`${inputCls} px-3 font-mono`} />
              </div>
              <div>
                <label htmlFor="cl-secret" className="block text-xs font-bold text-slate-600 mb-1">API secret</label>
                <input id="cl-secret" type="password" autoComplete="off" placeholder={settings.cloudinary.configured ? '•••••••• (saved)' : 'API secret'} value={cloudSecret} onChange={(e) => setCloudSecret(e.target.value)} className={`${inputCls} px-3 font-mono`} />
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <button type="button" onClick={testCloud} disabled={testing === 'cloud' || (!settings.cloudinary.configured && !settings.cloudinary.system_configured)}
                className="px-3.5 py-1.5 rounded-xl border border-sky-200 bg-white hover:bg-sky-50 text-sky-700 font-bold text-xs flex items-center gap-1.5 disabled:opacity-50"
                title="Tests the saved credentials">
                {testing === 'cloud' ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <ShieldCheck className="w-3.5 h-3.5" />}
                Test connection
              </button>
              {settings.cloudinary.configured && (
                <button type="button" onClick={disconnectCloudinary} className="px-3.5 py-1.5 rounded-xl text-rose-600 hover:bg-rose-50 font-bold text-xs flex items-center gap-1.5">
                  <Trash2 className="w-3.5 h-3.5" /> Disconnect
                </button>
              )}
              <StatusLine status={cloudStatus} />
            </div>
          </section>

          {/* Save bar */}
          <div className="sticky bottom-4 z-20 flex items-center justify-between gap-3 bg-white/90 backdrop-blur-xl rounded-2xl px-4 py-3 border border-sky-100 shadow-lg">
            <div className="min-w-0">
              {saveStatus ? <StatusLine status={saveStatus} /> : <span className="text-xs text-slate-500">Changes apply after you save.</span>}
            </div>
            <button onClick={() => save()} disabled={saving}
              className="px-6 py-2.5 rounded-full bg-gradient-to-r from-sky-600 to-blue-600 hover:from-sky-700 hover:to-blue-700 text-white font-bold text-sm shadow-sm flex items-center gap-2 shrink-0 disabled:opacity-60">
              {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
              Save
            </button>
          </div>
        </>
      )}
    </div>
  );
};
