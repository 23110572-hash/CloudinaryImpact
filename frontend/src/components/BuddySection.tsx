import React, { useEffect, useRef, useState } from 'react';
import {
  MessageCircleHeart, Send, Paperclip, X, Sparkles, MapPin, Calendar, RotateCcw, ChevronDown, Zap, AlertCircle, Image as ImageIcon,
} from 'lucide-react';
import { api, ChatAsset, MediaAssetItem, SettingsData } from '../services/api';
import { Markdown } from './ui/Markdown';

interface BuddySectionProps {
  media: MediaAssetItem[];
  attachedAsset: MediaAssetItem | null;
  onAttach: (asset: MediaAssetItem | null) => void;
  settings: SettingsData | null;
  onNavigate: (tab: string) => void;
}

interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
  assets?: ChatAsset[];
  steps?: Array<{ title: string; detail: string }>;
  provider?: string;
  attachment?: { id: number; name: string; thumb: string };
  error?: boolean;
}

const STORAGE_KEY = 'buddy_chat';

const SUGGESTIONS = [
  'How many photos have GPS location?',
  'Show me all my before photos',
  'Which folder has the most photos?',
  'What did we capture this month?',
  'Find photos with trees or planting',
  'Give me a quick overview of my library',
];

const THINKING_STEPS = ['Reading your library…', 'Searching metadata…', 'Writing an answer…'];

export const BuddySection: React.FC<BuddySectionProps> = ({ media, attachedAsset, onAttach, settings, onNavigate }) => {
  const [turns, setTurns] = useState<ChatTurn[]>(() => {
    try {
      return JSON.parse(sessionStorage.getItem(STORAGE_KEY) || '[]');
    } catch {
      return [];
    }
  });
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [thinkingIdx, setThinkingIdx] = useState(0);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [openSteps, setOpenSteps] = useState<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(turns.slice(-40)));
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [turns, loading]);

  useEffect(() => {
    if (!loading) return;
    setThinkingIdx(0);
    const t = setInterval(() => setThinkingIdx((i) => Math.min(i + 1, THINKING_STEPS.length - 1)), 1100);
    return () => clearInterval(t);
  }, [loading]);

  useEffect(() => {
    if (attachedAsset) inputRef.current?.focus();
  }, [attachedAsset]);

  const aiLive = settings?.llm_mode === 'byok'
    ? !!settings?.masked_keys?.[settings.active_provider]
    : !!settings?.system_ai?.live;
  const aiLabel = settings?.llm_mode === 'byok'
    ? `${settings.active_provider} · ${settings.active_model}`
    : settings?.system_ai?.live ? `System · ${settings.system_ai.model}` : 'Metadata search only';

  const send = async (text?: string) => {
    const message = (text ?? input).trim();
    if (!message || loading) return;

    const history = turns.filter((t) => !t.error).map((t) => ({ role: t.role, content: t.content }));
    const userTurn: ChatTurn = {
      role: 'user',
      content: message,
      attachment: attachedAsset
        ? { id: attachedAsset.id, name: attachedAsset.original_name, thumb: attachedAsset.thumbnail_url || attachedAsset.secure_url }
        : undefined,
    };
    setTurns((prev) => [...prev, userTurn]);
    setInput('');
    setLoading(true);

    try {
      const res = await api.chat(message, history, attachedAsset?.id);
      setTurns((prev) => [...prev, {
        role: 'assistant', content: res.answer, assets: res.assets, steps: res.steps, provider: res.provider_used,
      }]);
    } catch (e: any) {
      setTurns((prev) => [...prev, { role: 'assistant', content: `Sorry, that didn't work: ${e.message}`, error: true }]);
    } finally {
      setLoading(false);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  const attachById = (id: number) => {
    const found = media.find((m) => m.id === id);
    if (found) onAttach(found);
  };

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="text-center mb-6">
        <div className="inline-flex items-center gap-2 px-3.5 py-1 rounded-full bg-indigo-100 text-indigo-800 text-sm font-bold mb-3 border border-indigo-200 shadow-sm">
          <MessageCircleHeart className="w-4 h-4 text-indigo-600" />
          <span>Buddy</span>
        </div>
        <h2 className="text-3xl sm:text-5xl font-extrabold text-slate-900 tracking-tight">Ask anything about your media</h2>
        <p className="mt-2 text-base sm:text-lg text-slate-600 max-w-2xl mx-auto">
          Plain language questions about folders, dates, locations, phases and what's in your photos.
          Attach a photo to ask about it directly.
        </p>
      </div>

      <div className="bg-white/90 backdrop-blur-xl rounded-3xl border border-sky-100 shadow-lg shadow-sky-950/5 overflow-hidden flex flex-col h-[70vh] min-h-[520px]">
        {/* Status bar */}
        <div className="flex items-center justify-between gap-3 px-4 sm:px-5 py-3 border-b border-slate-100 bg-white/70">
          <div className="flex items-center gap-2 text-xs font-bold text-slate-600 min-w-0">
            <span className="relative flex h-2.5 w-2.5 shrink-0">
              {aiLive && <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60" />}
              <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${aiLive ? 'bg-emerald-500' : 'bg-amber-400'}`} />
            </span>
            <span className="truncate">{aiLabel}</span>
            {!aiLive && (
              <button onClick={() => onNavigate('settings')} className="text-sky-700 underline underline-offset-2 shrink-0">
                Connect AI
              </button>
            )}
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <span className="hidden sm:inline text-xs font-semibold text-slate-400">{media.length} assets indexed</span>
            {turns.length > 0 && (
              <button
                onClick={() => setTurns([])}
                className="text-xs font-bold text-slate-500 hover:text-rose-600 flex items-center gap-1 transition-colors"
                title="Start a new conversation"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>New chat</span>
              </button>
            )}
          </div>
        </div>

        {/* Messages */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 sm:px-6 py-6 space-y-5" aria-live="polite">
          {turns.length === 0 && !loading && (
            <div className="h-full flex flex-col items-center justify-center text-center">
              <div className="w-16 h-16 rounded-3xl bg-gradient-to-tr from-sky-500 to-indigo-600 text-white flex items-center justify-center shadow-xl shadow-indigo-500/25 mb-4 animate-float">
                <Sparkles className="w-8 h-8" />
              </div>
              <p className="font-bold text-slate-900 text-lg">What would you like to know?</p>
              <p className="text-sm text-slate-500 mt-1 mb-5">
                {media.length ? 'Try one of these to get started' : 'Upload some photos first, then come back and ask.'}
              </p>
              <div className="flex flex-wrap justify-center gap-2 max-w-2xl">
                {SUGGESTIONS.map((s, i) => (
                  <button
                    key={s}
                    onClick={() => send(s)}
                    disabled={!media.length}
                    className="px-3.5 py-2 rounded-full bg-slate-50 hover:bg-sky-50 border border-slate-200 hover:border-sky-300 text-sm text-slate-700 hover:text-sky-800 font-medium transition-all hover:-translate-y-0.5 disabled:opacity-40 disabled:hover:translate-y-0 opacity-0 animate-fade-in"
                    style={{ animationDelay: `${i * 70}ms`, animationFillMode: 'forwards' }}
                  >
                    {s}
                  </button>
                ))}
              </div>
              {!media.length && (
                <button onClick={() => onNavigate('upload')} className="mt-5 px-5 py-2 rounded-full bg-sky-600 text-white text-sm font-bold hover:bg-sky-700">
                  Upload photos
                </button>
              )}
            </div>
          )}

          {turns.map((t, idx) => (
            <div key={idx} className={`flex gap-3 animate-fade-in ${t.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              {t.role === 'assistant' && (
                <div className={`w-8 h-8 rounded-xl shrink-0 flex items-center justify-center ${t.error ? 'bg-rose-100 text-rose-600' : 'bg-gradient-to-tr from-sky-500 to-indigo-600 text-white'}`}>
                  {t.error ? <AlertCircle className="w-4 h-4" /> : <Sparkles className="w-4 h-4" />}
                </div>
              )}
              <div className={`max-w-[85%] ${t.role === 'user' ? 'items-end' : 'items-start'} flex flex-col gap-2`}>
                {t.attachment && (
                  <div className="flex items-center gap-2 px-2 py-1.5 rounded-xl bg-sky-50 border border-sky-100 text-xs font-semibold text-sky-800">
                    <img src={t.attachment.thumb} alt="" className="w-8 h-8 rounded-lg object-cover" />
                    <span className="truncate max-w-[180px]">{t.attachment.name}</span>
                  </div>
                )}
                <div
                  className={`px-4 py-3 rounded-2xl text-sm sm:text-[15px] ${
                    t.role === 'user'
                      ? 'bg-gradient-to-r from-sky-600 to-blue-600 text-white rounded-br-md whitespace-pre-wrap'
                      : t.error
                      ? 'bg-rose-50 border border-rose-200 text-rose-700 rounded-bl-md'
                      : 'bg-slate-50 border border-slate-200/70 rounded-bl-md'
                  }`}
                >
                  {t.role === 'user' ? t.content : <Markdown content={t.content} />}
                </div>

                {t.assets && t.assets.length > 0 && (
                  <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 w-full">
                    {t.assets.map((a, i) => (
                      <button
                        key={a.id}
                        onClick={() => attachById(a.id)}
                        title={`Attach ${a.original_name} and ask about it`}
                        className="group relative aspect-square rounded-xl overflow-hidden border border-slate-200 bg-slate-100 opacity-0 animate-fade-in"
                        style={{ animationDelay: `${i * 60}ms`, animationFillMode: 'forwards' }}
                      >
                        <img src={a.thumbnail_url} alt={a.original_name} className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110" loading="lazy" />
                        <div className="absolute inset-x-0 bottom-0 p-1.5 bg-gradient-to-t from-slate-900/80 to-transparent text-left">
                          <p className="text-[10px] font-bold text-white truncate">{a.original_name}</p>
                          <div className="flex items-center gap-1.5 text-[9px] text-white/80">
                            {a.captured_at && <span className="flex items-center gap-0.5"><Calendar className="w-2.5 h-2.5" />{a.captured_at.slice(0, 10)}</span>}
                            {a.latitude != null && <MapPin className="w-2.5 h-2.5" />}
                          </div>
                        </div>
                        <span className="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded-md bg-white/90 text-[9px] font-extrabold uppercase text-slate-700">{a.phase}</span>
                      </button>
                    ))}
                  </div>
                )}

                {t.steps && t.steps.length > 0 && (
                  <div className="text-xs">
                    <button
                      onClick={() => setOpenSteps(openSteps === idx ? null : idx)}
                      className="flex items-center gap-1 font-semibold text-slate-400 hover:text-slate-600"
                      aria-expanded={openSteps === idx}
                    >
                      <Zap className="w-3 h-3" />
                      <span>How I answered{t.provider ? ` · ${t.provider}` : ''}</span>
                      <ChevronDown className={`w-3 h-3 transition-transform ${openSteps === idx ? 'rotate-180' : ''}`} />
                    </button>
                    {openSteps === idx && (
                      <ol className="mt-2 space-y-1 pl-4 border-l-2 border-sky-100 animate-fade-in">
                        {t.steps.map((s, i) => (
                          <li key={i} className="text-slate-500"><span className="font-bold text-slate-700">{s.title}:</span> {s.detail}</li>
                        ))}
                      </ol>
                    )}
                  </div>
                )}
              </div>
            </div>
          ))}

          {loading && (
            <div className="flex gap-3 animate-fade-in">
              <div className="w-8 h-8 rounded-xl shrink-0 flex items-center justify-center bg-gradient-to-tr from-sky-500 to-indigo-600 text-white">
                <Sparkles className="w-4 h-4" />
              </div>
              <div className="px-4 py-3 rounded-2xl rounded-bl-md bg-slate-50 border border-slate-200/70 flex items-center gap-3">
                <span className="flex gap-1">
                  {[0, 1, 2].map((d) => (
                    <span key={d} className="w-2 h-2 rounded-full bg-sky-500 animate-bounce" style={{ animationDelay: `${d * 150}ms` }} />
                  ))}
                </span>
                <span className="text-sm text-slate-500 font-medium">{THINKING_STEPS[thinkingIdx]}</span>
              </div>
            </div>
          )}
        </div>

        {/* Composer */}
        <div className="border-t border-slate-100 p-3 sm:p-4 bg-white/80 relative">
          {pickerOpen && (
            <div className="absolute bottom-full left-3 right-3 mb-2 p-3 rounded-2xl bg-white border border-sky-100 shadow-2xl animate-fade-in z-20">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Attach a photo from your library</span>
                <button onClick={() => setPickerOpen(false)} className="p-1 text-slate-400 hover:text-slate-700" aria-label="Close picker">
                  <X className="w-4 h-4" />
                </button>
              </div>
              {media.length ? (
                <div className="grid grid-cols-5 sm:grid-cols-8 gap-2 max-h-52 overflow-y-auto">
                  {media.map((m) => (
                    <button
                      key={m.id}
                      onClick={() => { onAttach(m); setPickerOpen(false); }}
                      className={`aspect-square rounded-lg overflow-hidden border-2 transition-all hover:scale-105 ${attachedAsset?.id === m.id ? 'border-sky-600' : 'border-transparent'}`}
                      title={m.original_name}
                    >
                      <img src={m.thumbnail_url || m.secure_url} alt={m.original_name} className="w-full h-full object-cover" loading="lazy" />
                    </button>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-slate-500 py-4 text-center">No photos yet.</p>
              )}
            </div>
          )}

          {attachedAsset && (
            <div className="mb-2 inline-flex items-center gap-2 pl-1.5 pr-2 py-1.5 rounded-xl bg-sky-50 border border-sky-200 text-xs font-semibold text-sky-800 animate-fade-in">
              <img src={attachedAsset.thumbnail_url || attachedAsset.secure_url} alt="" className="w-7 h-7 rounded-lg object-cover" />
              <span className="truncate max-w-[200px]">{attachedAsset.original_name}</span>
              <button onClick={() => onAttach(null)} className="p-0.5 hover:text-rose-600" aria-label="Remove attached photo">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          <div className="flex items-end gap-2">
            <button
              onClick={() => setPickerOpen((o) => !o)}
              className={`p-3 rounded-2xl border transition-colors ${pickerOpen ? 'bg-sky-100 border-sky-300 text-sky-700' : 'border-slate-200 text-slate-500 hover:bg-slate-50'}`}
              title="Attach a photo"
              aria-label="Attach a photo from your library"
            >
              {attachedAsset ? <ImageIcon className="w-5 h-5" /> : <Paperclip className="w-5 h-5" />}
            </button>
            <label htmlFor="buddy-input" className="sr-only">Message Buddy</label>
            <textarea
              id="buddy-input"
              ref={inputRef}
              rows={1}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder={attachedAsset ? 'Ask about this photo…' : 'Ask about your photos, e.g. "which photos were taken in March?"'}
              className="flex-1 resize-none max-h-40 px-4 py-3 rounded-2xl border border-slate-200 bg-white text-sm sm:text-[15px] text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500"
            />
            <button
              onClick={() => send()}
              disabled={loading || !input.trim()}
              className="p-3 rounded-2xl bg-gradient-to-r from-sky-600 to-indigo-600 text-white shadow-md shadow-sky-600/25 hover:shadow-lg transition-all disabled:opacity-40 disabled:shadow-none"
              aria-label="Send message"
            >
              <Send className="w-5 h-5" />
            </button>
          </div>
          <p className="mt-1.5 text-[11px] text-slate-400 text-center">Enter to send · Shift+Enter for a new line</p>
        </div>
      </div>
    </div>
  );
};
