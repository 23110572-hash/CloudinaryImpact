import React, { useEffect, useMemo, useState } from 'react';
import {
  SplitSquareVertical, FileText, History, ArrowRightLeft, Sparkles, RefreshCw, TrendingUp, Download,
  Copy, Check, Printer, Trash2, AlertCircle, ChevronLeft, Wand2, Share2, Film, Package, Folder, Send, MapPin, Calendar, Images,
} from 'lucide-react';
import {
  api, ComparisonResult, CreationKind, FolderIdeas, FolderItem, MediaAssetItem, ReportItem, StudioIdea,
} from '../services/api';
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

type Tab = 'studio' | 'compare' | 'history';

const KIND_META: Record<CreationKind, { label: string; icon: React.ElementType; tone: string }> = {
  document: { label: 'Written piece', icon: FileText, tone: 'bg-sky-100 text-sky-800' },
  social: { label: 'Social post', icon: Share2, tone: 'bg-pink-100 text-pink-800' },
  before_after: { label: 'Before & After', icon: SplitSquareVertical, tone: 'bg-amber-100 text-amber-800' },
  reel: { label: 'Highlight reel', icon: Film, tone: 'bg-violet-100 text-violet-800' },
  pack: { label: 'Photo pack', icon: Package, tone: 'bg-emerald-100 text-emerald-800' },
};

/** One-click starters. The AI still decides the purpose, audience and wording from the folder itself. */
const QUICK: Array<{ kind: CreationKind; text: string }> = [
  { kind: 'document', text: 'Write the most useful report or story for this folder' },
  { kind: 'social', text: 'Make a ready-to-post social image with a caption' },
  { kind: 'before_after', text: 'Make a before and after story' },
  { kind: 'reel', text: 'Make a short highlight reel of the best photos' },
  { kind: 'pack', text: 'Pack all original photos with a spreadsheet of their details' },
];

const KindBadge: React.FC<{ kind: CreationKind }> = ({ kind }) => {
  const m = KIND_META[kind] || KIND_META.document;
  const Icon = m.icon;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-extrabold ${m.tone}`}>
      <Icon className="w-3 h-3" /> {m.label}
    </span>
  );
};

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
      <label htmlFor={id} className={`block text-xs font-bold uppercase tracking-wider mb-2 ${tone === 'amber' ? 'text-amber-700' : 'text-emerald-700'}`}>{label}</label>
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
            <option key={m.id} value={m.id}>[{m.phase.toUpperCase()}] {m.original_name}{m.folder ? ` · ${m.folder.name}` : ''}</option>
          ))}
        </select>
      </div>
    </div>
  );
};

const saveBlob = (blob: Blob, name: string) => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
};

const slug = (s: string) => s.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'creation';

/**
 * Written pieces made before this update carried a metadata header and a source-file list.
 * Show just the piece: drop those header lines and everything from "## Source photos" on.
 */
const cleanDocument = (md: string) =>
  md
    .split(/\n##\s+(Source photos|Evidence appendix)/i)[0]
    .split('\n')
    .filter((line) => !/^\*\*(Folder|For|Photos|Prepared for|Scope|Evidence period|Generated with):\*\*/i.test(line.trim()))
    .join('\n')
    .trim();

const EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp', 'video/mp4': 'mp4' };

/** Real file download (not a new tab). Social/before-after images are fetched as JPG for easy sharing. */
async function downloadMedia(url: string, baseName: string) {
  const res = await fetch(url.replace('/f_auto/', '/f_jpg/'));
  if (!res.ok) throw new Error(`Download failed (${res.status})`);
  const blob = await res.blob();
  saveBlob(blob, `${baseName}.${EXT[blob.type] || url.split('?')[0].split('.').pop() || 'bin'}`);
}

export const ReportsSection: React.FC<ReportsSectionProps> = ({
  media, folders, selectedBefore, selectedAfter, onChangeBefore, onChangeAfter, onNavigate,
}) => {
  const [tab, setTab] = useState<Tab>('studio');

  // ---------- Studio ----------
  const usableFolders = useMemo(() => folders.filter((f) => f.asset_count > 0), [folders]);
  const [folderId, setFolderId] = useState<number | null>(null);
  const [ideas, setIdeas] = useState<FolderIdeas | null>(null);
  const [ideasLoading, setIdeasLoading] = useState(false);
  const [ideasError, setIdeasError] = useState<string | null>(null);
  const [requestText, setRequestText] = useState('');
  const [creatingKey, setCreatingKey] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [creation, setCreation] = useState<ReportItem | null>(null);
  const [copied, setCopied] = useState(false);
  const [packBusy, setPackBusy] = useState<'zip' | 'csv' | null>(null);
  const [packError, setPackError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const download = async (url: string, name: string) => {
    setDownloading(url);
    setDownloadError(null);
    try {
      await downloadMedia(url, name);
    } catch (e: any) {
      setDownloadError(e.message);
    } finally {
      setDownloading(null);
    }
  };

  const downloadButton = (url: string, name: string, label: string) => (
    <button
      onClick={() => download(url, name)}
      disabled={downloading !== null}
      className="mt-2 inline-flex items-center gap-1 px-3 py-1.5 rounded-full bg-sky-600 hover:bg-sky-700 text-white text-xs font-bold disabled:opacity-60 print:hidden"
    >
      {downloading === url ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
      {downloading === url ? 'Downloading…' : label}
    </button>
  );

  // ---------- Before & After ----------
  const [slider, setSlider] = useState(50);
  const [comparing, setComparing] = useState(false);
  const [comparison, setComparison] = useState<ComparisonResult | null>(null);
  const [compareError, setCompareError] = useState<string | null>(null);
  const [pastComparisons, setPastComparisons] = useState<ComparisonResult[]>([]);

  const before = selectedBefore ?? media.find((m) => m.phase === 'before') ?? media[1] ?? media[0] ?? null;
  const after = selectedAfter ?? media.find((m) => m.phase === 'after' && m.id !== before?.id) ?? media.find((m) => m.id !== before?.id) ?? null;

  // ---------- History ----------
  const [reports, setReports] = useState<ReportItem[]>([]);
  const [viewing, setViewing] = useState<ReportItem | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);

  const loadHistory = async () => {
    setHistoryLoading(true);
    setHistoryError(null);
    try {
      const [r, c] = await Promise.all([api.getReports(), api.getComparisons()]);
      setReports(r);
      setPastComparisons(c);
    } catch (e: any) {
      setHistoryError(e.message);
    } finally {
      setHistoryLoading(false);
    }
  };

  useEffect(() => {
    loadHistory();
  }, []);

  // Coming from the Media Library's compare button opens the Before & After tab
  useEffect(() => {
    if (selectedBefore || selectedAfter) setTab('compare');
  }, [selectedBefore, selectedAfter]);

  const loadIdeas = async (id: number, refresh = false) => {
    setIdeasLoading(true);
    setIdeasError(null);
    if (!refresh) setIdeas(null);
    try {
      setIdeas(await api.getFolderIdeas(id, refresh));
    } catch (e: any) {
      setIdeasError(e.message);
    } finally {
      setIdeasLoading(false);
    }
  };

  const pickFolder = (id: number) => {
    setFolderId(id);
    setCreation(null);
    setCreateError(null);
    setRequestText('');
    loadIdeas(id);
  };

  const create = async (key: string, body: { idea?: StudioIdea; request?: string }) => {
    if (!folderId) return;
    setCreatingKey(key);
    setCreateError(null);
    setPackError(null);
    try {
      const res = await api.createCreation({ folder_id: folderId, ...body });
      setCreation(res);
      loadHistory();
    } catch (e: any) {
      setCreateError(e.message);
    } finally {
      setCreatingKey(null);
    }
  };

  const copyText = async (text: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const openPack = async (r: ReportItem) => {
    // Open the tab inside the click itself: browsers block tabs opened after an await
    const tabRef = window.open('about:blank', '_blank');
    setPackBusy('zip');
    setPackError(null);
    try {
      const { url } = await api.getPackLink(r.id);
      if (tabRef) {
        tabRef.opener = null;
        tabRef.location.href = url;
      } else {
        // Pop-ups fully disabled: the ZIP is served as a download, so this page stays where it is
        const a = document.createElement('a');
        a.href = url;
        a.rel = 'noreferrer';
        a.click();
      }
    } catch (e: any) {
      tabRef?.close();
      setPackError(e.message);
    } finally {
      setPackBusy(null);
    }
  };

  const downloadCsv = async (r: ReportItem) => {
    if (!r.folder_id) return;
    setPackBusy('csv');
    setPackError(null);
    try {
      saveBlob(await api.downloadFolderCsv(r.folder_id), `${slug(r.category || r.title)}-details.csv`);
    } catch (e: any) {
      setPackError(e.message);
    } finally {
      setPackBusy(null);
    }
  };

  const deleteReport = async (id: number) => {
    if (!window.confirm('Delete this creation?')) return;
    try {
      await api.deleteReport(id);
      if (creation?.id === id) setCreation(null);
      if (viewing?.id === id) setViewing(null);
      loadHistory();
    } catch (e: any) {
      setHistoryError(e.message);
    }
  };

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

  const tabs: Array<{ id: Tab; label: string; icon: React.ElementType }> = [
    { id: 'studio', label: 'Studio', icon: Wand2 },
    { id: 'compare', label: 'Before & After', icon: SplitSquareVertical },
    { id: 'history', label: `History${reports.length ? ` (${reports.length})` : ''}`, icon: History },
  ];

  // Plain render function (not a nested component) so state changes like "Copied" don't remount it
  const renderCreation = (r: ReportItem, onBack?: () => void) => {
    const p = r.payload || {};
    return (
      <div className="bg-white/95 p-5 sm:p-8 rounded-3xl border border-emerald-200 shadow-lg animate-fade-in print:shadow-none print:border-0">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-slate-100 mb-6 print:hidden">
          <div className="flex items-center gap-2 min-w-0">
            {onBack && (
              <button onClick={onBack} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500" aria-label="Back">
                <ChevronLeft className="w-4 h-4" />
              </button>
            )}
            <KindBadge kind={r.kind} />
            <span className="text-xs text-slate-400 truncate">{r.category} · {new Date(r.created_at).toLocaleString()}</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {r.markdown_content && (
              <button onClick={() => copyText(r.markdown_content)} className="px-3 py-1.5 rounded-full border border-slate-200 text-xs font-bold text-slate-700 hover:bg-slate-50 flex items-center gap-1.5">
                {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                {copied ? 'Copied' : r.kind === 'social' ? 'Copy post text' : 'Copy'}
              </button>
            )}
            {(r.kind === 'document' || r.kind === 'before_after') && (
              <>
                <button onClick={() => saveBlob(new Blob([r.markdown_content], { type: 'text/markdown' }), `${slug(r.title)}.md`)} className="px-3 py-1.5 rounded-full border border-slate-200 text-xs font-bold text-slate-700 hover:bg-slate-50 flex items-center gap-1.5">
                  <Download className="w-3.5 h-3.5" /> .md
                </button>
                <button onClick={() => window.print()} className="px-3 py-1.5 rounded-full bg-slate-900 text-white text-xs font-bold hover:bg-slate-800 flex items-center gap-1.5">
                  <Printer className="w-3.5 h-3.5" /> Print / PDF
                </button>
              </>
            )}
          </div>
        </div>

        {r.kind !== 'document' && r.kind !== 'before_after' && <h3 className="text-2xl font-extrabold text-slate-900 tracking-tight mb-4">{r.title}</h3>}

        {p.cover_images && p.cover_images.length > 0 && (
          <div className="grid grid-cols-3 gap-2 mb-6">
            {p.cover_images.map((c) => <img key={c.id} src={c.url} alt="" className="w-full aspect-[4/3] object-cover rounded-2xl border border-slate-100" />)}
          </div>
        )}

        {p.videos && p.videos.length > 0 && (
          <div className="mb-5 space-y-3">
            {p.videos.map((v) => (
              <div key={v.url}>
                <video src={v.url} controls loop muted playsInline className="w-full max-w-xl mx-auto rounded-2xl bg-slate-950" />
                {downloadButton(v.url, `${slug(r.title)}-${v.format}`, `Download ${v.label}`)}
              </div>
            ))}
          </div>
        )}

        {p.images && p.images.length > 0 && (
          <div className={`mb-6 grid gap-4 ${p.images.length > 1 ? 'sm:grid-cols-2' : ''} items-start`}>
            {p.images.map((img) => (
              <figure key={img.url} className="rounded-2xl overflow-hidden border border-slate-100 bg-slate-50">
                <img src={img.url} alt={`${r.title} (${img.label})`} className={`w-full object-contain bg-slate-950 ${img.format === 'story' ? 'max-h-[34rem]' : ''}`} loading="lazy" />
                <figcaption className="flex items-center justify-between gap-2 px-3 py-2 text-xs font-bold text-slate-600">
                  <span>{img.label}</span>
                  {downloadButton(img.url, `${slug(r.title)}-${img.format}`, 'Download')}
                </figcaption>
              </figure>
            ))}
          </div>
        )}

        {r.kind !== 'document' && r.key_metrics?.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
            {r.key_metrics.map((m, i) => (
              <div key={m.label} className="p-4 rounded-2xl bg-gradient-to-br from-sky-50 to-white border border-sky-100 opacity-0 animate-fade-in" style={{ animationDelay: `${i * 80}ms`, animationFillMode: 'forwards' }}>
                <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">{m.label}</div>
                <div className="text-lg font-extrabold text-sky-700 mt-1 break-words">{m.value}</div>
              </div>
            ))}
          </div>
        )}

        {r.kind === 'pack' && (
          <div className="mb-5 flex flex-wrap gap-3 print:hidden">
            <button onClick={() => openPack(r)} disabled={packBusy !== null} className="px-5 py-2.5 rounded-full bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-bold flex items-center gap-2 disabled:opacity-60">
              {packBusy === 'zip' ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Package className="w-4 h-4" />} Download originals (ZIP)
            </button>
            <button onClick={() => downloadCsv(r)} disabled={packBusy !== null || !r.folder_id} className="px-5 py-2.5 rounded-full border border-emerald-300 text-emerald-800 hover:bg-emerald-50 text-sm font-bold flex items-center gap-2 disabled:opacity-60">
              {packBusy === 'csv' ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />} Details (CSV)
            </button>
            <p className="w-full text-xs text-slate-500">The ZIP is built by Cloudinary from the untouched originals. Each click makes a fresh link that works for one hour.</p>
            {packError && <p className="w-full text-sm text-rose-600 font-semibold flex items-center gap-1.5"><AlertCircle className="w-4 h-4" />{packError}</p>}
          </div>
        )}

        {r.kind === 'social' ? (
          <div className="p-4 rounded-2xl bg-slate-50 border border-slate-100 whitespace-pre-wrap text-sm text-slate-700 leading-relaxed">{r.markdown_content}</div>
        ) : r.kind === 'reel' || r.kind === 'pack' ? (
          <p className="text-slate-600">{r.markdown_content}</p>
        ) : (
          <Markdown content={r.kind === 'document' ? cleanDocument(r.markdown_content) : r.markdown_content} />
        )}
        {downloadError && <p className="mt-3 text-sm text-rose-600 font-semibold flex items-center gap-1.5 print:hidden"><AlertCircle className="w-4 h-4" />{downloadError}</p>}
      </div>
    );
  };

  if (!media.length) {
    return (
      <div className="max-w-md mx-auto px-4 py-16 text-center">
        <div className="bg-white/90 p-8 rounded-3xl border border-sky-100 shadow-sm space-y-4">
          <FileText className="w-10 h-10 mx-auto text-sky-600" />
          <h3 className="text-2xl font-extrabold text-slate-900">No photos yet</h3>
          <p className="text-sm text-slate-600">Upload a folder of photos and the Studio will suggest what to make from it.</p>
          <button onClick={() => onNavigate('upload')} className="px-6 py-2.5 rounded-full bg-sky-600 text-white text-sm font-bold hover:bg-sky-700">Upload photos</button>
        </div>
      </div>
    );
  }

  const selectedFolder = folders.find((f) => f.id === folderId) || null;
  const s = ideas?.stats;

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      <div className="text-center mb-6 print:hidden">
        <h2 className="text-3xl sm:text-5xl font-extrabold text-slate-900 tracking-tight">Reports &amp; Stories</h2>
        <p className="mt-2 text-base sm:text-lg text-slate-600 sm:whitespace-nowrap">Pick a folder and we'll suggest what to make from it, or just ask.</p>
      </div>

      <div className="flex justify-center mb-8 print:hidden">
        <div className="inline-flex p-1 rounded-full bg-white/85 border border-sky-100 shadow-sm" role="tablist">
          {tabs.map((t) => {
            const Icon = t.icon;
            const on = tab === t.id;
            return (
              <button
                key={t.id}
                role="tab"
                aria-selected={on}
                onClick={() => setTab(t.id)}
                className={`px-4 py-2 rounded-full text-sm font-bold flex items-center gap-1.5 transition-all duration-300 ${on ? 'bg-slate-900 text-white shadow' : 'text-slate-600 hover:text-slate-900'}`}
              >
                <Icon className="w-4 h-4" />
                <span className={on ? '' : 'hidden sm:inline'}>{t.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {tab === 'studio' && (
        <div key="studio" className="animate-fade-in space-y-6">
          {/* 1. Folder */}
          <section aria-labelledby="studio-folder" className="print:hidden">
            <h3 id="studio-folder" className="text-sm font-extrabold uppercase tracking-widest text-slate-500 mb-3 flex items-center gap-1.5">
              <Folder className="w-4 h-4 text-sky-600" /> 1 · Choose a folder
            </h3>
            {usableFolders.length === 0 ? (
              <p className="text-sm text-slate-500">No folders with photos yet.</p>
            ) : (
              <div className="flex gap-3 overflow-x-auto pb-2 no-scrollbar">
                {usableFolders.map((f) => {
                  const on = f.id === folderId;
                  return (
                    <button
                      key={f.id}
                      onClick={() => pickFolder(f.id)}
                      aria-pressed={on}
                      className={`shrink-0 w-52 text-left rounded-2xl border overflow-hidden transition-all ${on ? 'border-sky-600 ring-2 ring-sky-600 shadow-lg' : 'border-sky-100 bg-white/90 hover:border-sky-300 hover:-translate-y-0.5 shadow-sm'}`}
                    >
                      <div className="grid grid-cols-4 h-14 bg-slate-100">
                        {f.preview_thumbnails.slice(0, 4).map((t, i) => <img key={i} src={t} alt="" className="w-full h-full object-cover" loading="lazy" />)}
                      </div>
                      <div className={`px-3 py-2 ${on ? 'bg-sky-600 text-white' : 'bg-white'}`}>
                        <p className="font-bold text-sm truncate">{f.name}</p>
                        <p className={`text-xs ${on ? 'text-white/80' : 'text-slate-500'}`}>{f.asset_count} photo{f.asset_count === 1 ? '' : 's'}</p>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </section>

          {selectedFolder && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
              {/* 2. Ideas + request */}
              <div className="lg:col-span-5 space-y-4 print:hidden">
                <section className="bg-white/95 p-5 rounded-3xl border border-sky-100 shadow-sm">
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <h3 className="text-sm font-extrabold uppercase tracking-widest text-slate-500 flex items-center gap-1.5">
                      <Sparkles className="w-4 h-4 text-indigo-600" /> 2 · What we can make
                    </h3>
                    {ideas && (
                      <button onClick={() => loadIdeas(selectedFolder.id, true)} disabled={ideasLoading} className="text-xs font-bold text-sky-700 hover:underline flex items-center gap-1 disabled:opacity-50">
                        <RefreshCw className={`w-3 h-3 ${ideasLoading ? 'animate-spin' : ''}`} /> New ideas
                      </button>
                    )}
                  </div>

                  {s && (
                    <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs font-semibold text-slate-500 mb-3">
                      <span className="flex items-center gap-1"><Images className="w-3 h-3" />{s.total} photos</span>
                      {s.geotagged > 0 && <span className="flex items-center gap-1"><MapPin className="w-3 h-3" />{s.geotagged} with GPS</span>}
                      {s.date_range && <span className="flex items-center gap-1"><Calendar className="w-3 h-3" />{s.date_range[0]} → {s.date_range[1]}</span>}
                      {(s.phases.before > 0 || s.phases.after > 0) && <span>{s.phases.before} before · {s.phases.after} after</span>}
                      {s.not_analyzed > 0 && <span className="text-amber-700">{s.not_analyzed} not analyzed</span>}
                    </div>
                  )}
                  {ideas?.theme && <p className="text-sm text-slate-700 italic mb-3">“{ideas.theme}”</p>}

                  {ideasLoading && !ideas && (
                    <div className="space-y-2" aria-label="Reading the folder">
                      <p className="text-xs font-semibold text-slate-500">Reading the photos in this folder…</p>
                      {[0, 1, 2].map((i) => <div key={i} className="h-20 rounded-2xl bg-gradient-to-r from-slate-100 via-sky-100 to-slate-100 bg-[length:200%_100%] animate-shimmer" />)}
                    </div>
                  )}
                  {ideasError && (
                    <div className="p-3 rounded-2xl bg-rose-50 border border-rose-200 text-sm text-rose-700 font-semibold space-y-2">
                      <p className="flex items-start gap-1.5"><AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />{ideasError}</p>
                      <div className="flex gap-3">
                        <button onClick={() => loadIdeas(selectedFolder.id, true)} className="underline">Retry</button>
                        {ideasError.toLowerCase().includes('analyz') && <button onClick={() => onNavigate('library')} className="underline">Open Media Library</button>}
                        {ideasError.toLowerCase().includes('ai key') && <button onClick={() => onNavigate('settings')} className="underline">Open Settings</button>}
                      </div>
                    </div>
                  )}

                  {ideas && (
                    <ul className="space-y-2.5">
                      {ideas.ideas.map((idea, i) => {
                        const key = `idea-${i}`;
                        return (
                          <li key={key} className="p-3.5 rounded-2xl border border-slate-200 bg-white hover:border-sky-300 transition-colors opacity-0 animate-fade-in" style={{ animationDelay: `${i * 90}ms`, animationFillMode: 'forwards' }}>
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <KindBadge kind={idea.kind} />
                                <p className="mt-1.5 font-bold text-slate-900 leading-snug">{idea.title}</p>
                                {idea.description && <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">{idea.description}</p>}
                              </div>
                              <button
                                onClick={() => create(key, { idea })}
                                disabled={creatingKey !== null}
                                className="shrink-0 px-3.5 py-2 rounded-full bg-gradient-to-r from-sky-600 to-blue-600 text-white text-xs font-bold shadow-sm disabled:opacity-50 flex items-center gap-1"
                              >
                                {creatingKey === key ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Wand2 className="w-3.5 h-3.5" />}
                                Create
                              </button>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </section>

                <section className="bg-white/95 p-5 rounded-3xl border border-sky-100 shadow-sm">
                  <label htmlFor="studio-request" className="text-sm font-extrabold uppercase tracking-widest text-slate-500 mb-2 flex items-center gap-1.5">
                    <Send className="w-4 h-4 text-sky-600" /> Or tell us what you need
                  </label>
                  <textarea
                    id="studio-request"
                    rows={3}
                    value={requestText}
                    onChange={(e) => setRequestText(e.target.value)}
                    maxLength={1200}
                    placeholder='e.g. "1-page update for the district officer with the 3 best photos"'
                    className="w-full resize-none p-3 rounded-2xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                  />
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {QUICK.filter((q) => q.kind !== 'before_after' || !s || (s.phases.before > 0 && s.phases.after > 0)).map((q) => (
                      <button key={q.kind} onClick={() => setRequestText(q.text)} className="px-2.5 py-1 rounded-full bg-slate-50 hover:bg-sky-50 border border-slate-200 hover:border-sky-300 text-xs font-semibold text-slate-700">
                        {KIND_META[q.kind].label}
                      </button>
                    ))}
                  </div>
                  <button
                    onClick={() => create('request', { request: requestText.trim() })}
                    disabled={!requestText.trim() || creatingKey !== null}
                    className="mt-3 w-full py-3 rounded-full bg-gradient-to-r from-sky-600 to-blue-600 hover:from-sky-700 hover:to-blue-700 text-white font-bold text-sm shadow-md shadow-sky-600/25 flex items-center justify-center gap-2 disabled:opacity-50"
                  >
                    {creatingKey === 'request' ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
                    {creatingKey === 'request' ? 'Creating…' : 'Create it'}
                  </button>
                </section>
              </div>

              {/* 3. Result */}
              <div className="lg:col-span-7">
                {createError && (
                  <div role="alert" className="mb-4 p-4 rounded-2xl bg-rose-50 border border-rose-200 text-sm text-rose-700 font-semibold flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />{createError}
                  </div>
                )}
                {creatingKey ? (
                  <div className="bg-white/90 p-8 rounded-3xl border border-sky-100 space-y-3">
                    <p className="text-sm font-bold text-slate-600 flex items-center gap-2"><Sparkles className="w-4 h-4 text-indigo-600 animate-pulse" /> Creating from your photos…</p>
                    {[80, 60, 95, 70, 85, 50].map((w, i) => (
                      <div key={i} className="h-4 rounded-full bg-gradient-to-r from-slate-100 via-sky-100 to-slate-100 bg-[length:200%_100%] animate-shimmer" style={{ width: `${w}%` }} />
                    ))}
                  </div>
                ) : creation ? (
                  renderCreation(creation)
                ) : (
                  <div className="bg-white/70 border-2 border-dashed border-sky-200 rounded-3xl p-12 text-center text-slate-500 print:hidden">
                    <Wand2 className="w-10 h-10 mx-auto mb-3 text-sky-400" />
                    <p className="font-semibold">Pick an idea or describe what you need.</p>
                    <p className="text-xs mt-1">Everything links back to the original photos in Cloudinary.</p>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

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
                    <input type="range" min={0} max={100} value={slider} onChange={(e) => setSlider(Number(e.target.value))} aria-label="Before and after slider" className="absolute inset-0 w-full h-full opacity-0 cursor-ew-resize z-20" />
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
                    <span className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-emerald-100 text-emerald-800 text-sm font-extrabold">
                      <TrendingUp className="w-4 h-4" /> Change score {comparison.impact_score}/10
                    </span>
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
                </div>
              )}
            </>
          )}
        </div>
      )}

      {tab === 'history' && viewing && (
        // Opened in place, so creations whose folder is gone (or older reports without one) still open
        <div key="history-view" className="animate-fade-in">{renderCreation(viewing, () => setViewing(null))}</div>
      )}

      {tab === 'history' && !viewing && (
        <div key="history" className="animate-fade-in space-y-8">
          {historyLoading && <p className="text-center text-slate-500 text-sm">Loading…</p>}
          {historyError && (
            <p className="text-center text-sm text-rose-600 font-semibold">
              {historyError} <button onClick={loadHistory} className="underline">Retry</button>
            </p>
          )}

          <section>
            <h3 className="text-lg font-extrabold text-slate-900 mb-3">Creations</h3>
            {reports.length === 0 ? (
              <p className="text-sm text-slate-500">Nothing created yet. Open the Studio tab to start.</p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {reports.map((r, i) => (
                  <div key={r.id} className="p-4 rounded-2xl bg-white/95 border border-sky-100 shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all flex items-start justify-between gap-3 opacity-0 animate-fade-in" style={{ animationDelay: `${i * 50}ms`, animationFillMode: 'forwards' }}>
                    <button className="text-left flex-1 min-w-0" onClick={() => setViewing(r)}>
                      <KindBadge kind={r.kind} />
                      <p className="mt-1 font-bold text-slate-900 truncate">{r.title}</p>
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
