import React, { useEffect, useMemo, useState } from 'react';
import {
  SplitSquareVertical, FileText, History, ArrowRightLeft, Sparkles, RefreshCw, TrendingUp, Download,
  Copy, Check, Printer, Trash2, AlertCircle, ChevronLeft,
} from 'lucide-react';
import { api, ComparisonResult, FolderItem, MediaAssetItem, ReportItem } from '../services/api';
import { Markdown } from './ui/Markdown';

interface ReportsSectionProps {
  media: MediaAssetItem[];
  folders: FolderItem[];
  selectedBefore: MediaAssetItem | null;
  selectedAfter: MediaAssetItem | null;
  onChangeBefore: (a: MediaAssetItem | null) => void;
  onChangeAfter: (a: MediaAssetItem | null) => void;
  onNavigate: (tab: string) => void;
}

type Tab = 'compare' | 'report' | 'history';

const AssetPicker: React.FC<{
  label: string;
  tone: 'amber' | 'emerald';
  media: MediaAssetItem[];
  value: MediaAssetItem | null;
  onChange: (a: MediaAssetItem) => void;
}> = ({ label, tone, media, value, onChange }) => {
  const id = `picker-${tone}`;
  return (
    <div className="bg-white/90 p-4 rounded-2xl border border-sky-100 shadow-sm">
      <label htmlFor={id} className={`block text-xs font-bold uppercase tracking-wider mb-2 ${tone === 'amber' ? 'text-amber-700' : 'text-emerald-700'}`}>
        {label}
      </label>
      <div className="flex items-center gap-3">
        {value && <img src={value.thumbnail_url || value.secure_url} alt="" className="w-12 h-12 rounded-xl object-cover border border-slate-200 shrink-0" />}
        <select
          id={id}
          value={value?.id ?? ''}
          onChange={(e) => {
            const item = media.find((m) => m.id === Number(e.target.value));
            if (item) onChange(item);
          }}
          className="w-full p-2.5 rounded-xl border border-slate-200 text-sm font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500 bg-white"
        >
          {media.map((m) => (
            <option key={m.id} value={m.id}>
              [{m.phase.toUpperCase()}] {m.original_name}{m.folder ? ` · ${m.folder.name}` : ''}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
};

export const ReportsSection: React.FC<ReportsSectionProps> = ({
  media, folders, selectedBefore, selectedAfter, onChangeBefore, onChangeAfter, onNavigate,
}) => {
  const [tab, setTab] = useState<Tab>('compare');

  // ---------- Before & After ----------
  const [slider, setSlider] = useState(50);
  const [comparing, setComparing] = useState(false);
  const [comparison, setComparison] = useState<ComparisonResult | null>(null);
  const [compareError, setCompareError] = useState<string | null>(null);
  const [pastComparisons, setPastComparisons] = useState<ComparisonResult[]>([]);

  const before = selectedBefore ?? media.find((m) => m.phase === 'before') ?? media[1] ?? media[0] ?? null;
  const after = selectedAfter ?? media.find((m) => m.phase === 'after' && m.id !== before?.id) ?? media.find((m) => m.id !== before?.id) ?? null;

  // ---------- Impact report ----------
  const [title, setTitle] = useState('Impact & Sustainability Progress Report');
  const [folderId, setFolderId] = useState<number | ''>('');
  const [audience, setAudience] = useState('Donors & Grant Committee');
  const [tone, setTone] = useState<'donor' | 'technical' | 'campaign'>('donor');
  const [generating, setGenerating] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);
  const [report, setReport] = useState<ReportItem | null>(null);
  const [copied, setCopied] = useState(false);

  // ---------- History ----------
  const [reports, setReports] = useState<ReportItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const localFolders = useMemo(() => folders.filter((f) => f.id < 1000 && f.asset_count > 0), [folders]);

  const loadHistory = async () => {
    setHistoryLoading(true);
    try {
      const [r, c] = await Promise.all([api.getReports(), api.getComparisons()]);
      setReports(r);
      setPastComparisons(c);
    } catch (e) {
      console.error(e);
    } finally {
      setHistoryLoading(false);
    }
  };

  useEffect(() => {
    loadHistory();
  }, []);

  const runComparison = async () => {
    if (!before || !after) return;
    setComparing(true);
    setCompareError(null);
    try {
      const res = await api.compareAssets(before.id, after.id, `${before.folder?.name || 'Project'}: ${before.original_name} → ${after.original_name}`);
      setComparison(res);
      loadHistory();
    } catch (e: any) {
      setCompareError(e.message);
    } finally {
      setComparing(false);
    }
  };

  const generate = async () => {
    setGenerating(true);
    setReportError(null);
    try {
      const res = await api.generateReport({
        title: title.trim() || 'Impact Report',
        folder_id: folderId === '' ? undefined : folderId,
        target_stakeholder: audience.trim() || 'Stakeholders',
        tone,
      });
      setReport(res);
      loadHistory();
    } catch (e: any) {
      setReportError(e.message);
    } finally {
      setGenerating(false);
    }
  };

  const copyReport = async (r: ReportItem) => {
    await navigator.clipboard.writeText(r.markdown_content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const downloadReport = (r: ReportItem) => {
    const blob = new Blob([r.markdown_content], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${r.title.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const deleteReport = async (id: number) => {
    if (!window.confirm('Delete this report?')) return;
    await api.deleteReport(id);
    if (report?.id === id) setReport(null);
    loadHistory();
  };

  const tabs: Array<{ id: Tab; label: string; icon: React.ElementType }> = [
    { id: 'compare', label: 'Before & After', icon: SplitSquareVertical },
    { id: 'report', label: 'Impact Report', icon: FileText },
    { id: 'history', label: `History${reports.length ? ` (${reports.length})` : ''}`, icon: History },
  ];

  // Plain render function (not a nested component) so state changes like "Copied" don't remount it
  const renderReport = (r: ReportItem, onBack?: () => void) => (
    <div className="bg-white/95 p-6 sm:p-8 rounded-3xl border border-emerald-200 shadow-lg animate-fade-in print:shadow-none print:border-0">
      <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-slate-100 mb-6 print:hidden">
        <div className="flex items-center gap-2">
          {onBack && (
            <button onClick={onBack} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500" aria-label="Back to history">
              <ChevronLeft className="w-4 h-4" />
            </button>
          )}
          <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-800">{r.category}</span>
          <span className="text-xs text-slate-400">{new Date(r.created_at).toLocaleString()}</span>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => copyReport(r)} className="px-3 py-1.5 rounded-full border border-slate-200 text-xs font-bold text-slate-700 hover:bg-slate-50 flex items-center gap-1.5">
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
            {copied ? 'Copied' : 'Copy'}
          </button>
          <button onClick={() => downloadReport(r)} className="px-3 py-1.5 rounded-full border border-slate-200 text-xs font-bold text-slate-700 hover:bg-slate-50 flex items-center gap-1.5">
            <Download className="w-3.5 h-3.5" /> .md
          </button>
          <button onClick={() => window.print()} className="px-3 py-1.5 rounded-full bg-slate-900 text-white text-xs font-bold hover:bg-slate-800 flex items-center gap-1.5">
            <Printer className="w-3.5 h-3.5" /> Print / PDF
          </button>
        </div>
      </div>

      {r.key_metrics?.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          {r.key_metrics.map((m, i) => (
            <div key={m.label} className="p-4 rounded-2xl bg-gradient-to-br from-sky-50 to-white border border-sky-100 opacity-0 animate-fade-in" style={{ animationDelay: `${i * 80}ms`, animationFillMode: 'forwards' }}>
              <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">{m.label}</div>
              <div className="text-xl font-extrabold text-sky-700 mt-1">{m.value}</div>
            </div>
          ))}
        </div>
      )}
      <Markdown content={r.markdown_content} />
    </div>
  );

  if (!media.length) {
    return (
      <div className="max-w-md mx-auto px-4 py-16 text-center">
        <div className="bg-white/90 p-8 rounded-3xl border border-sky-100 shadow-sm space-y-4">
          <FileText className="w-10 h-10 mx-auto text-sky-600" />
          <h3 className="text-2xl font-extrabold text-slate-900">No evidence yet</h3>
          <p className="text-sm text-slate-600">Upload before and after photos to compare progress and build impact reports.</p>
          <button onClick={() => onNavigate('upload')} className="px-6 py-2.5 rounded-full bg-sky-600 text-white text-sm font-bold hover:bg-sky-700">Upload photos</button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      <div className="text-center mb-6 print:hidden">
        <h2 className="text-3xl sm:text-5xl font-extrabold text-slate-900 tracking-tight">Reports</h2>
        <p className="mt-2 text-base sm:text-lg text-slate-600 max-w-2xl mx-auto">
          Prove visible change with before &amp; after comparisons, then turn your evidence into donor-ready reports that link back to every source photo.
        </p>
      </div>

      {/* Tabs */}
      <div className="flex justify-center mb-8 print:hidden">
        <div className="inline-flex p-1 rounded-full bg-white/85 border border-sky-100 shadow-sm" role="tablist">
          {tabs.map((t) => {
            const Icon = t.icon;
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                role="tab"
                aria-selected={active}
                onClick={() => setTab(t.id)}
                className={`px-4 py-2 rounded-full text-sm font-bold flex items-center gap-1.5 transition-all duration-300 ${active ? 'bg-slate-900 text-white shadow' : 'text-slate-600 hover:text-slate-900'}`}
              >
                <Icon className="w-4 h-4" />
                <span className={active ? '' : 'hidden sm:inline'}>{t.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {tab === 'compare' && (
        <div key="compare" className="animate-fade-in">
          {media.length < 2 ? (
            <p className="text-center text-slate-600">You need at least two photos to compare. Upload one tagged <b>Before</b> and one tagged <b>After</b>.</p>
          ) : (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                <AssetPicker label="Before (baseline)" tone="amber" media={media} value={before} onChange={onChangeBefore} />
                <AssetPicker label="After (follow-up)" tone="emerald" media={media} value={after} onChange={onChangeAfter} />
              </div>

              {before && after && (
                <div className="bg-white/95 p-4 sm:p-6 rounded-3xl border border-sky-100 shadow-lg">
                  <div className="relative aspect-[16/9] w-full rounded-2xl overflow-hidden select-none bg-slate-950">
                    <img src={after.secure_url} alt={`After: ${after.original_name}`} className="absolute inset-0 w-full h-full object-cover" />
                    <div className="absolute top-4 right-4 px-3 py-1.5 rounded-full bg-emerald-600/90 text-white font-extrabold text-xs uppercase backdrop-blur-md">After</div>
                    <div className="absolute inset-0" style={{ clipPath: `inset(0 ${100 - slider}% 0 0)` }}>
                      <img src={before.secure_url} alt={`Before: ${before.original_name}`} className="absolute inset-0 w-full h-full object-cover" />
                      <div className="absolute top-4 left-4 px-3 py-1.5 rounded-full bg-amber-600/90 text-white font-extrabold text-xs uppercase backdrop-blur-md">Before</div>
                    </div>
                    <div className="absolute top-0 bottom-0 w-1 bg-white shadow-2xl pointer-events-none" style={{ left: `${slider}%` }}>
                      <div className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-11 h-11 rounded-full bg-white shadow-2xl flex items-center justify-center border-2 border-sky-500 animate-pulse-glow">
                        <ArrowRightLeft className="w-5 h-5 text-sky-600" />
                      </div>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={slider}
                      onChange={(e) => setSlider(Number(e.target.value))}
                      aria-label="Before and after slider"
                      className="absolute inset-0 w-full h-full opacity-0 cursor-ew-resize z-20"
                    />
                  </div>

                  <div className="mt-5 flex flex-col sm:flex-row items-center justify-between gap-3">
                    <p className="text-xs text-slate-500">Drag the handle to reveal the change. Same viewpoint photos give the best result.</p>
                    <button
                      onClick={runComparison}
                      disabled={comparing || before.id === after.id}
                      className="w-full sm:w-auto px-7 py-3 rounded-full bg-gradient-to-r from-sky-600 to-blue-600 hover:from-sky-700 hover:to-blue-700 text-white font-bold text-sm shadow-md shadow-sky-600/25 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                    >
                      {comparing ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                      <span>{comparing ? 'Analyzing change…' : 'Analyze change with AI'}</span>
                    </button>
                  </div>
                  {before.id === after.id && <p className="mt-2 text-xs text-rose-600 font-semibold">Pick two different photos.</p>}
                  {compareError && <p className="mt-3 text-sm text-rose-600 font-semibold flex items-center gap-1.5"><AlertCircle className="w-4 h-4" />{compareError}</p>}
                </div>
              )}

              {comparison && (
                <div className="mt-6 bg-white/95 p-6 sm:p-8 rounded-3xl border border-sky-100 shadow-md animate-fade-in">
                  <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-slate-100 mb-5">
                    <h3 className="text-xl font-extrabold text-slate-900">Visible change</h3>
                    {comparison.simulated ? (
                      <span className="px-3 py-1.5 rounded-full bg-amber-100 text-amber-800 text-xs font-bold">Not analyzed · connect AI in Settings</span>
                    ) : (
                      <span className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-emerald-100 text-emerald-800 text-sm font-extrabold">
                        <TrendingUp className="w-4 h-4" /> Impact {comparison.impact_score}/10
                      </span>
                    )}
                  </div>
                  <p className="text-base text-slate-700 leading-relaxed mb-5">{comparison.delta_summary}</p>
                  {comparison.metrics_diff && (
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      {Object.entries(comparison.metrics_diff).map(([k, v], i) => (
                        <div key={k} className="p-4 rounded-2xl bg-sky-50/70 border border-sky-100 opacity-0 animate-fade-in" style={{ animationDelay: `${i * 80}ms`, animationFillMode: 'forwards' }}>
                          <div className="text-xs font-semibold text-slate-500 capitalize">{k.replace(/_/g, ' ')}</div>
                          <div className="text-lg font-extrabold text-sky-700 mt-1">{String(v)}</div>
                        </div>
                      ))}
                    </div>
                  )}
                  <button onClick={() => setTab('report')} className="mt-6 text-sm font-bold text-sky-700 hover:underline flex items-center gap-1">
                    <FileText className="w-4 h-4" /> Include this in an impact report
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {tab === 'report' && (
        <div key="report" className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start animate-fade-in">
          <div className="lg:col-span-4 bg-white/95 p-5 rounded-3xl border border-sky-100 shadow-sm space-y-4 print:hidden lg:sticky lg:top-24">
            <div>
              <label htmlFor="rep-title" className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1.5">Title</label>
              <input id="rep-title" value={title} onChange={(e) => setTitle(e.target.value)} className="w-full p-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500" />
            </div>
            <div>
              <label htmlFor="rep-scope" className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1.5">Scope</label>
              <select id="rep-scope" value={folderId} onChange={(e) => setFolderId(e.target.value ? Number(e.target.value) : '')} className="w-full p-2.5 rounded-xl border border-slate-200 text-sm font-semibold bg-white focus:outline-none focus:ring-2 focus:ring-sky-500">
                <option value="">All projects ({media.length} assets)</option>
                {localFolders.map((f) => <option key={f.id} value={f.id}>{f.name} ({f.asset_count})</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="rep-aud" className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1.5">Audience</label>
              <input id="rep-aud" value={audience} onChange={(e) => setAudience(e.target.value)} className="w-full p-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500" />
            </div>
            <div>
              <span className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1.5">Style</span>
              <div className="grid grid-cols-3 gap-1.5" role="radiogroup" aria-label="Report style">
                {([['donor', 'Donor'], ['technical', 'Audit'], ['campaign', 'Campaign']] as const).map(([id, label]) => (
                  <button key={id} role="radio" aria-checked={tone === id} onClick={() => setTone(id)}
                    className={`py-2 rounded-xl text-xs font-bold border transition-all ${tone === id ? 'bg-sky-600 text-white border-sky-600' : 'bg-white text-slate-600 border-slate-200 hover:border-sky-300'}`}>
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <button onClick={generate} disabled={generating}
              className="w-full py-3 rounded-full bg-gradient-to-r from-sky-600 to-blue-600 hover:from-sky-700 hover:to-blue-700 text-white font-bold text-sm shadow-md shadow-sky-600/25 flex items-center justify-center gap-2 disabled:opacity-60">
              {generating ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
              {generating ? 'Writing report…' : 'Generate report'}
            </button>
            {reportError && <p className="text-sm text-rose-600 font-semibold flex items-start gap-1.5"><AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />{reportError}</p>}
            <p className="text-[11px] text-slate-500 leading-relaxed">Reports use only your real metadata and comparisons, and end with an appendix linking every source asset for traceability.</p>
          </div>

          <div className="lg:col-span-8">
            {generating ? (
              <div className="bg-white/90 p-8 rounded-3xl border border-sky-100 space-y-3">
                {[80, 60, 95, 70, 85, 50].map((w, i) => (
                  <div key={i} className="h-4 rounded-full bg-gradient-to-r from-slate-100 via-sky-100 to-slate-100 bg-[length:200%_100%] animate-shimmer" style={{ width: `${w}%` }} />
                ))}
              </div>
            ) : report ? (
              renderReport(report)
            ) : (
              <div className="bg-white/70 border-2 border-dashed border-sky-200 rounded-3xl p-12 text-center text-slate-500">
                <FileText className="w-10 h-10 mx-auto mb-3 text-sky-400" />
                <p className="font-semibold">Pick a scope and style, then generate.</p>
              </div>
            )}
          </div>
        </div>
      )}

      {tab === 'history' && (
        <div key="history" className="animate-fade-in space-y-8">
          {historyLoading && <p className="text-center text-slate-500 text-sm">Loading…</p>}

          <section>
            <h3 className="text-lg font-extrabold text-slate-900 mb-3">Impact reports</h3>
            {reports.length === 0 ? (
              <p className="text-sm text-slate-500">No reports yet.</p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {reports.map((r, i) => (
                  <div key={r.id} className="p-4 rounded-2xl bg-white/95 border border-sky-100 shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all flex items-start justify-between gap-3 opacity-0 animate-fade-in" style={{ animationDelay: `${i * 50}ms`, animationFillMode: 'forwards' }}>
                    <button className="text-left flex-1 min-w-0" onClick={() => { setReport(r); setTab('report'); }}>
                      <p className="font-bold text-slate-900 truncate">{r.title}</p>
                      <p className="text-xs text-slate-500 mt-0.5">{r.category} · {new Date(r.created_at).toLocaleDateString()}</p>
                    </button>
                    <button onClick={() => deleteReport(r.id)} className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50" aria-label={`Delete ${r.title}`}>
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section>
            <h3 className="text-lg font-extrabold text-slate-900 mb-3">Before &amp; after comparisons</h3>
            {pastComparisons.length === 0 ? (
              <p className="text-sm text-slate-500">No comparisons yet.</p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {pastComparisons.map((c) => (
                  <div key={c.id} className="p-3 rounded-2xl bg-white/95 border border-sky-100 shadow-sm flex gap-3">
                    <div className="flex shrink-0">
                      <img src={c.before_url} alt="Before" className="w-14 h-14 rounded-l-xl object-cover" />
                      <img src={c.after_url} alt="After" className="w-14 h-14 rounded-r-xl object-cover" />
                    </div>
                    <div className="min-w-0">
                      <p className="font-bold text-sm text-slate-900 truncate">{c.title}</p>
                      <p className="text-xs text-slate-500 line-clamp-2">{c.delta_summary}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
};
