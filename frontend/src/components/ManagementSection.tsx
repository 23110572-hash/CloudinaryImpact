import React, { useEffect, useMemo, useState } from 'react';
import {
  Folder, FolderPlus, Search, Tag, Calendar, MapPin, Sparkles, SplitSquareVertical, Trash2, ExternalLink,
  Image as ImageIcon, RefreshCw, X, AlertCircle, Check, UploadCloud, Images,
} from 'lucide-react';
import { api, FolderItem, MediaAssetItem } from '../services/api';

interface ManagementSectionProps {
  folders: FolderItem[];
  media: MediaAssetItem[];
  onDeleteAsset: (id: number) => void;
  onSelectForUnderstand: (asset: MediaAssetItem) => void;
  onSelectForCompare: (asset: MediaAssetItem, role: 'before' | 'after') => void;
  setActiveTab: (tab: string) => void;
  onRefreshData?: () => void;
}

interface Facet {
  key: string;
  label: string;
  count: number;
  group: 'phase' | 'status' | 'theme' | 'tag';
}

const PHASE_LABEL: Record<string, string> = { before: 'Before', during: 'During', after: 'After', general: 'General' };

const phaseStyle = (p: string) =>
  p === 'before' ? 'bg-amber-500 text-white'
  : p === 'after' ? 'bg-emerald-600 text-white'
  : p === 'during' ? 'bg-sky-600 text-white'
  : 'bg-slate-800/80 text-white';

const fmtDate = (d?: string) => (d ? new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : null);
const fmtSize = (b: number) => (b > 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

/** Does this asset carry the given facet key? Keys: phase:x, status:gps, status:needs-ai, theme:x, tag:x */
export function hasFacet(a: MediaAssetItem, key: string): boolean {
  const [group, ...rest] = key.split(':');
  const value = rest.join(':');
  if (group === 'phase') return a.phase === value;
  if (group === 'status') return value === 'gps' ? a.latitude != null : a.ai_status !== 'analyzed';
  if (group === 'theme') return a.ai_analysis?.project_category === value;
  if (group === 'tag') return !!a.ai_analysis?.visual_signals?.includes(value);
  return false;
}

/** Every filterable attribute in a set of photos, with counts, most useful first. */
export function buildFacets(list: MediaAssetItem[]): Facet[] {
  const counts = new Map<string, Facet>();
  const bump = (key: string, label: string, group: Facet['group']) => {
    const f = counts.get(key) || { key, label, count: 0, group };
    f.count += 1;
    counts.set(key, f);
  };
  for (const a of list) {
    bump(`phase:${a.phase}`, PHASE_LABEL[a.phase] || a.phase, 'phase');
    if (a.latitude != null) bump('status:gps', 'Has GPS', 'status');
    if (a.ai_status !== 'analyzed') bump('status:needs-ai', 'Not analyzed', 'status');
    if (a.ai_analysis?.project_category) bump(`theme:${a.ai_analysis.project_category}`, a.ai_analysis.project_category, 'theme');
    for (const t of new Set(a.ai_analysis?.visual_signals || [])) bump(`tag:${t}`, t, 'tag');
  }
  const order = { phase: 0, status: 1, theme: 2, tag: 3 };
  return [...counts.values()].sort((x, y) => order[x.group] - order[y.group] || y.count - x.count || x.label.localeCompare(y.label));
}

const TAG_PREVIEW = 18;

export const ManagementSection: React.FC<ManagementSectionProps> = ({
  folders, media, onDeleteAsset, onSelectForUnderstand, onSelectForCompare, setActiveTab, onRefreshData,
}) => {
  const [folderId, setFolderId] = useState<number | null>(folders[0]?.id ?? null);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState<string[]>([]);
  const [showAllTags, setShowAllTags] = useState(false);
  const [detail, setDetail] = useState<MediaAssetItem | null>(null);

  const [syncing, setSyncing] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);
  const [analyzingId, setAnalyzingId] = useState<number | null>(null);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(t);
  }, [notice]);

  // Drop the folder selection if that folder disappears
  useEffect(() => {
    if (folderId && !folders.some((f) => f.id === folderId)) setFolderId(folders[0]?.id ?? null);
  }, [folders, folderId]);

  // Filters belong to a folder; reset them when switching
  useEffect(() => {
    setActive([]);
    setQuery('');
    setShowAllTags(false);
  }, [folderId]);

  const inFolder = useMemo(() => (folderId ? media.filter((m) => m.folder?.id === folderId) : media), [media, folderId]);
  const facets = useMemo(() => buildFacets(inFolder), [inFolder]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return inFolder.filter((m) => {
      if (!active.every((k) => hasFacet(m, k))) return false;
      if (!q) return true;
      const an = m.ai_analysis;
      return [m.original_name, an?.summary, an?.project_category, an?.activity_detected, ...(an?.visual_signals || [])]
        .some((v) => v && String(v).toLowerCase().includes(q));
    });
  }, [inFolder, active, query]);

  const currentFolder = folders.find((f) => f.id === folderId) || null;
  const nonTag = facets.filter((f) => f.group !== 'tag');
  const tags = facets.filter((f) => f.group === 'tag');
  const visibleTags = showAllTags ? tags : tags.slice(0, TAG_PREVIEW);
  const toggle = (key: string) => setActive((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));

  const sync = async () => {
    setSyncing(true);
    try {
      const r = await api.syncCloudinary();
      onRefreshData?.();
      setNotice({
        ok: true,
        text: r.new_assets || r.new_folders
          ? `Imported ${r.new_assets} photo(s) and ${r.new_folders} folder(s) from Cloudinary.`
          : 'Everything is already in sync with Cloudinary.',
      });
    } catch (e: any) {
      setNotice({ ok: false, text: e.message });
    } finally {
      setSyncing(false);
    }
  };

  const createFolder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    setBusy(true);
    try {
      const f = await api.createFolder(newName.trim());
      setNewName('');
      setCreating(false);
      onRefreshData?.();
      setFolderId(f.id);
      setNotice({ ok: true, text: `Folder "${f.name}" created in Cloudinary.` });
    } catch (e: any) {
      setNotice({ ok: false, text: e.message });
    } finally {
      setBusy(false);
    }
  };

  const deleteFolder = async (f: FolderItem) => {
    if (!window.confirm(`Delete the empty folder "${f.name}"?`)) return;
    try {
      await api.deleteFolder(f.id);
      onRefreshData?.();
    } catch (e: any) {
      setNotice({ ok: false, text: e.message });
    }
  };

  const analyze = async (a: MediaAssetItem) => {
    setAnalyzingId(a.id);
    try {
      const updated = await api.analyzeAsset(a.id);
      if (detail?.id === a.id) setDetail(updated);
      onRefreshData?.();
    } catch (e: any) {
      setNotice({ ok: false, text: e.message });
    } finally {
      setAnalyzingId(null);
    }
  };

  const chip = (f: Facet) => {
    const on = active.includes(f.key);
    return (
      <button
        key={f.key}
        onClick={() => toggle(f.key)}
        aria-pressed={on}
        className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold border transition-all ${
          on ? 'bg-sky-600 text-white border-sky-600 shadow-sm'
          : f.group === 'phase' ? 'bg-white text-slate-700 border-slate-200 hover:border-sky-300'
          : f.group === 'status' ? 'bg-emerald-50 text-emerald-800 border-emerald-200 hover:border-emerald-400'
          : f.group === 'theme' ? 'bg-indigo-50 text-indigo-800 border-indigo-200 hover:border-indigo-400'
          : 'bg-sky-50 text-sky-800 border-sky-100 hover:border-sky-300'
        }`}
      >
        {f.group === 'tag' && <Tag className="w-2.5 h-2.5" />}
        {f.group === 'status' && f.key === 'status:gps' && <MapPin className="w-2.5 h-2.5" />}
        <span className="capitalize">{f.label}</span>
        <span className={on ? 'text-white/80' : 'text-slate-400'}>{f.count}</span>
      </button>
    );
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-6">
        <div>
          <h2 className="text-3xl sm:text-4xl font-extrabold text-slate-900 tracking-tight">Media Library</h2>
          <p className="mt-1 text-base sm:text-lg text-slate-600">Pick a folder, then search or filter by any tag.</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button onClick={() => setCreating(true)} className="px-4 py-2.5 rounded-xl bg-white hover:bg-sky-50 text-sky-700 font-bold text-sm flex items-center gap-1.5 border border-sky-200 shadow-sm">
            <FolderPlus className="w-4 h-4" /> New folder
          </button>
          <button
            onClick={sync}
            disabled={syncing}
            className="px-4 py-2.5 rounded-xl bg-white hover:bg-sky-50 text-sky-700 font-bold text-sm flex items-center gap-1.5 border border-sky-200 shadow-sm disabled:opacity-60"
            title="Import photos you added to your Cloudinary folder outside this app"
          >
            <RefreshCw className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`} /> Sync
          </button>
          <button onClick={() => setActiveTab('upload')} className="px-4 py-2.5 rounded-xl bg-gradient-to-r from-sky-600 to-blue-600 text-white font-bold text-sm flex items-center gap-1.5 shadow-md shadow-sky-600/20">
            <UploadCloud className="w-4 h-4" /> Upload
          </button>
        </div>
      </div>

      {notice && (
        <div role="status" className={`mb-6 p-3 rounded-2xl text-sm font-semibold flex items-center gap-2 animate-fade-in ${notice.ok ? 'bg-emerald-50 border border-emerald-200 text-emerald-800' : 'bg-rose-50 border border-rose-200 text-rose-700'}`}>
          {notice.ok ? <Check className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
          {notice.text}
        </div>
      )}

      {creating && (
        <form onSubmit={createFolder} className="mb-6 p-4 rounded-2xl bg-white border border-sky-200 shadow-sm flex flex-col sm:flex-row gap-3 animate-fade-in">
          <label htmlFor="new-folder" className="sr-only">Folder name</label>
          <input
            id="new-folder"
            autoFocus
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            maxLength={80}
            placeholder="Folder name, e.g. Kenya Reforestation 2026"
            className="flex-1 px-4 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
          />
          <div className="flex gap-2">
            <button type="submit" disabled={busy || !newName.trim()} className="px-5 py-2.5 rounded-xl bg-sky-600 text-white text-sm font-bold disabled:opacity-50">
              {busy ? 'Creating…' : 'Create'}
            </button>
            <button type="button" onClick={() => { setCreating(false); setNewName(''); }} className="px-4 py-2.5 rounded-xl text-slate-600 text-sm font-bold hover:bg-slate-100">
              Cancel
            </button>
          </div>
        </form>
      )}

      {media.length === 0 && folders.length === 0 ? (
        <div className="text-center py-16 bg-white/80 rounded-3xl border border-dashed border-sky-200 p-8">
          <ImageIcon className="w-12 h-12 text-sky-400 mx-auto mb-3" />
          <h4 className="text-xl font-bold text-slate-800">Your library is empty</h4>
          <p className="text-sm text-slate-500 mt-1 max-w-md mx-auto">Upload your first photos. They'll be stored in your own folder in Cloudinary and appear here.</p>
          <button onClick={() => setActiveTab('upload')} className="mt-5 px-6 py-2.5 rounded-full bg-sky-600 text-white font-bold text-sm shadow-md hover:bg-sky-700">Upload photos</button>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[17rem_1fr] gap-6 items-start">
          {/* Folder list: stacked sidebar on desktop, dropdown on phones */}
          <div className="lg:hidden">
            <label htmlFor="folder-select" className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1.5">Folder</label>
            <select
              id="folder-select"
              value={folderId ?? ''}
              onChange={(e) => setFolderId(e.target.value ? Number(e.target.value) : null)}
              className="w-full p-3 rounded-2xl border border-sky-200 bg-white text-sm font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500"
            >
              <option value="">All photos ({media.length})</option>
              {folders.map((f) => <option key={f.id} value={f.id}>{f.name} ({f.asset_count})</option>)}
            </select>
          </div>

          <nav aria-label="Folders" className="hidden lg:block sticky top-6 bg-white/90 backdrop-blur-xl rounded-3xl border border-sky-100 shadow-sm p-2 max-h-[calc(100vh-3rem)] overflow-y-auto">
            <p className="px-3 pt-2 pb-2 text-xs font-extrabold uppercase tracking-widest text-slate-500 flex items-center gap-1.5">
              <Folder className="w-3.5 h-3.5 text-sky-600" /> Folders ({folders.length})
            </p>
            <button
              onClick={() => setFolderId(null)}
              aria-current={folderId === null ? 'true' : undefined}
              className={`w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-2xl text-left text-sm font-bold transition-all ${folderId === null ? 'bg-sky-600 text-white shadow-md shadow-sky-600/20' : 'text-slate-700 hover:bg-sky-50'}`}
            >
              <span className="flex items-center gap-2 min-w-0"><Images className="w-4 h-4 shrink-0" /><span className="truncate">All photos</span></span>
              <span className={`text-xs ${folderId === null ? 'text-white/80' : 'text-slate-400'}`}>{media.length}</span>
            </button>
            <ul className="mt-1 space-y-1">
              {folders.map((f) => {
                const sel = folderId === f.id;
                return (
                  <li key={f.id} className="group relative">
                    <button
                      onClick={() => setFolderId(f.id)}
                      aria-current={sel ? 'true' : undefined}
                      className={`w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-2xl text-left text-sm font-bold transition-all ${sel ? 'bg-sky-600 text-white shadow-md shadow-sky-600/20' : 'text-slate-700 hover:bg-sky-50'}`}
                    >
                      <span className="flex items-center gap-2 min-w-0">
                        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: f.color || '#0284c7' }} />
                        <span className="truncate" title={f.name}>{f.name}</span>
                      </span>
                      <span className={`text-xs ${sel ? 'text-white/80' : 'text-slate-400'} ${f.asset_count === 0 ? 'group-hover:opacity-0' : ''}`}>{f.asset_count}</span>
                    </button>
                    {f.asset_count === 0 && (
                      <button
                        onClick={() => deleteFolder(f)}
                        className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 opacity-0 group-hover:opacity-100 focus:opacity-100"
                        aria-label={`Delete empty folder ${f.name}`}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          </nav>

          {/* Photos of the selected folder */}
          <section aria-label={currentFolder ? `Photos in ${currentFolder.name}` : 'All photos'} className="min-w-0">
            <div className="bg-white/95 p-4 rounded-3xl border border-sky-100 shadow-sm mb-5 space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <h3 className="text-xl font-extrabold text-slate-900 truncate">
                  {currentFolder?.name || 'All photos'}
                  <span className="ml-2 text-sm font-bold text-slate-400">{filtered.length === inFolder.length ? inFolder.length : `${filtered.length} of ${inFolder.length}`}</span>
                </h3>
                <div className="relative w-full sm:w-80">
                  <label htmlFor="lib-search" className="sr-only">Search photos</label>
                  <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    id="lib-search"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search by name, tag or description…"
                    className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                  />
                </div>
              </div>

              {facets.length > 0 && (
                <div className="space-y-2" role="group" aria-label="Filter by tag">
                  <div className="flex flex-wrap gap-1.5">{nonTag.map(chip)}</div>
                  {tags.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {visibleTags.map(chip)}
                      {tags.length > TAG_PREVIEW && (
                        <button onClick={() => setShowAllTags((s) => !s)} className="px-2.5 py-1 rounded-full text-xs font-bold text-sky-700 hover:underline">
                          {showAllTags ? 'Show fewer' : `+${tags.length - TAG_PREVIEW} more`}
                        </button>
                      )}
                    </div>
                  )}
                  {(active.length > 0 || query) && (
                    <button onClick={() => { setActive([]); setQuery(''); }} className="text-xs font-bold text-rose-600 hover:underline flex items-center gap-1">
                      <X className="w-3 h-3" /> Clear filters
                    </button>
                  )}
                </div>
              )}
            </div>

            {inFolder.length === 0 ? (
              <div className="text-center py-14 bg-white/80 rounded-3xl border border-dashed border-sky-200">
                <ImageIcon className="w-10 h-10 text-sky-400 mx-auto mb-2" />
                <p className="font-bold text-slate-700">This folder is empty</p>
                <button onClick={() => setActiveTab('upload')} className="mt-3 text-sm font-bold text-sky-700 hover:underline">Upload photos</button>
              </div>
            ) : filtered.length === 0 ? (
              <div className="text-center py-12 text-slate-500">
                <p className="font-semibold">No photos match these filters.</p>
                <button onClick={() => { setQuery(''); setActive([]); }} className="mt-2 text-sm font-bold text-sky-700 hover:underline">Clear filters</button>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-5">
                {filtered.map((a, i) => (
                  <article
                    key={a.id}
                    className="bg-white rounded-2xl overflow-hidden border border-sky-100 shadow-sm hover:shadow-lg hover:-translate-y-0.5 transition-all duration-300 flex flex-col group opacity-0 animate-fade-in"
                    style={{ animationDelay: `${Math.min(i, 12) * 40}ms`, animationFillMode: 'forwards' }}
                  >
                    <button onClick={() => setDetail(a)} className="relative aspect-[4/3] w-full overflow-hidden bg-slate-100" aria-label={`Open ${a.original_name}`}>
                      <img src={a.thumbnail_url || a.secure_url} alt={a.original_name} loading="lazy" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
                      <span className={`absolute top-2.5 left-2.5 px-2 py-0.5 rounded-full text-[11px] font-extrabold uppercase ${phaseStyle(a.phase)}`}>{a.phase}</span>
                    </button>

                    <div className="p-4 flex-1 flex flex-col">
                      <h4 className="font-bold text-slate-900 truncate" title={a.original_name}>{a.original_name}</h4>
                      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
                        {!folderId && a.folder && <span className="flex items-center gap-1"><Folder className="w-3 h-3" />{a.folder.name}</span>}
                        {(a.captured_at || a.uploaded_at) && (
                          <span className="flex items-center gap-1" title={a.captured_at ? 'Captured (EXIF)' : 'Uploaded'}>
                            <Calendar className="w-3 h-3" />{fmtDate(a.captured_at || a.uploaded_at)}
                          </span>
                        )}
                        {a.latitude != null && <span className="flex items-center gap-1 text-emerald-700"><MapPin className="w-3 h-3" />GPS</span>}
                      </div>

                      {a.ai_analysis ? (
                        <>
                          <p className="mt-2 text-xs text-slate-600 line-clamp-2 leading-relaxed">{a.ai_analysis.summary}</p>
                          {a.ai_analysis.visual_signals?.length > 0 && (
                            <div className="mt-2 flex flex-wrap gap-1">
                              {a.ai_analysis.visual_signals.slice(0, 3).map((s) => (
                                <button
                                  key={s}
                                  onClick={() => !active.includes(`tag:${s}`) && toggle(`tag:${s}`)}
                                  className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-sky-50 text-sky-700 text-[11px] font-semibold border border-sky-100 hover:border-sky-300"
                                  title={`Filter by ${s}`}
                                >
                                  <Tag className="w-2.5 h-2.5" />{s}
                                </button>
                              ))}
                            </div>
                          )}
                        </>
                      ) : (
                        <button
                          onClick={() => analyze(a)}
                          disabled={analyzingId === a.id}
                          className={`mt-2 self-start text-xs font-bold hover:underline flex items-center gap-1 disabled:opacity-60 ${a.ai_status === 'failed' ? 'text-amber-700' : 'text-sky-700'}`}
                        >
                          <Sparkles className={`w-3 h-3 ${analyzingId === a.id ? 'animate-spin' : ''}`} />
                          {analyzingId === a.id ? 'Analyzing…' : a.ai_status === 'failed' ? 'AI analysis failed · Retry' : 'Not analyzed yet · Analyze'}
                        </button>
                      )}

                      <div className="mt-auto pt-3 border-t border-slate-100 flex items-center justify-between">
                        <div className="flex items-center gap-0.5">
                          <button onClick={() => { onSelectForUnderstand(a); setActiveTab('buddy'); }} className="p-2 rounded-xl text-sky-600 hover:bg-sky-50" title="Ask Buddy about this photo" aria-label="Ask Buddy about this photo">
                            <Sparkles className="w-4 h-4" />
                          </button>
                          <button onClick={() => { onSelectForCompare(a, a.phase === 'after' ? 'after' : 'before'); setActiveTab('reports'); }} className="p-2 rounded-xl text-indigo-600 hover:bg-indigo-50" title="Use in a Before & After comparison" aria-label="Use in a Before and After comparison">
                            <SplitSquareVertical className="w-4 h-4" />
                          </button>
                          <a href={a.secure_url} target="_blank" rel="noreferrer" className="p-2 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100" title="Open original" aria-label="Open original">
                            <ExternalLink className="w-4 h-4" />
                          </a>
                        </div>
                        <button onClick={() => onDeleteAsset(a.id)} className="p-2 rounded-xl text-slate-400 hover:text-rose-600 hover:bg-rose-50" title="Delete" aria-label={`Delete ${a.original_name}`}>
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        </div>
      )}

      {/* Detail modal */}
      {detail && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setDetail(null)} role="dialog" aria-modal="true" aria-label={detail.original_name}>
          <div className="bg-white rounded-3xl max-w-3xl w-full max-h-[90vh] overflow-y-auto p-6 sm:p-8 shadow-2xl animate-fade-in" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-4 mb-4">
              <div className="min-w-0">
                <h3 className="text-xl font-bold text-slate-900 truncate">{detail.original_name}</h3>
                <p className="text-sm text-slate-500">{detail.folder?.name || 'No folder'} · <span className="capitalize">{detail.phase}</span></p>
              </div>
              <button onClick={() => setDetail(null)} className="p-2 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100" aria-label="Close">
                <X className="w-5 h-5" />
              </button>
            </div>

            <img src={detail.secure_url} alt={detail.original_name} className="w-full max-h-[26rem] object-contain rounded-2xl bg-slate-950 mb-5" />

            <dl className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
              {[
                ['Captured', fmtDate(detail.captured_at) || 'Not in EXIF'],
                ['Uploaded', fmtDate(detail.uploaded_at) || '—'],
                ['Location', detail.latitude != null ? `${detail.latitude.toFixed(5)}, ${detail.longitude?.toFixed(5)}` : 'No GPS'],
                ['Size', `${detail.width}×${detail.height} · ${fmtSize(detail.bytes || 0)}`],
                ['Format', (detail.format || '—').toUpperCase()],
                ['Stored in', detail.folder?.cloudinary_path || 'Cloudinary'],
              ].map(([k, v]) => (
                <div key={k} className="p-3 rounded-xl bg-slate-50 border border-slate-100 min-w-0">
                  <dt className="text-[11px] font-bold uppercase tracking-wider text-slate-500">{k}</dt>
                  <dd className="font-semibold text-slate-800 truncate" title={String(v)}>{v}</dd>
                </div>
              ))}
            </dl>

            {detail.latitude != null && (
              <a
                href={`https://www.openstreetmap.org/?mlat=${detail.latitude}&mlon=${detail.longitude}#map=15/${detail.latitude}/${detail.longitude}`}
                target="_blank" rel="noreferrer"
                className="mt-3 inline-flex items-center gap-1 text-sm font-bold text-sky-700 hover:underline"
              >
                <MapPin className="w-4 h-4" /> View on map
              </a>
            )}

            {detail.ai_analysis ? (
              <div className="mt-5 p-4 rounded-2xl bg-sky-50/70 border border-sky-100 space-y-3">
                <p className="text-slate-700 leading-relaxed">{detail.ai_analysis.summary}</p>
                {detail.ai_analysis.visual_signals?.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {detail.ai_analysis.visual_signals.map((s) => (
                      <span key={s} className="px-2 py-0.5 rounded-md bg-white text-sky-700 text-xs font-semibold border border-sky-100">{s}</span>
                    ))}
                  </div>
                )}
                {Object.keys(detail.ai_analysis.environmental_metrics || {}).length > 0 && (
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {Object.entries(detail.ai_analysis.environmental_metrics).map(([k, v]) => (
                      <div key={k} className="bg-white p-2.5 rounded-xl border border-sky-100">
                        <div className="text-[11px] text-slate-500 capitalize">{k.replace(/_/g, ' ')}</div>
                        <div className="font-bold text-sky-700">{String(v)}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <button
                onClick={() => analyze(detail)}
                disabled={analyzingId === detail.id}
                className="mt-5 px-4 py-2 rounded-xl bg-sky-600 text-white text-sm font-bold flex items-center gap-1.5 disabled:opacity-60"
              >
                <Sparkles className="w-4 h-4" /> {analyzingId === detail.id ? 'Analyzing…' : detail.ai_status === 'failed' ? 'Retry AI analysis' : 'Analyze with AI'}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
