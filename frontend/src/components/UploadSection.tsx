import React, { useEffect, useRef, useState } from 'react';
import {
  UploadCloud, CheckCircle2, AlertCircle, Sparkles, FolderPlus, FileImage, X, ArrowRight, RotateCcw, Square,
} from 'lucide-react';
import { api, FolderItem, MediaAssetItem, UploadAbortedError } from '../services/api';

interface UploadSectionProps {
  folders: FolderItem[];
  onUploadSuccess: () => void;
  setActiveTab: (tab: string) => void;
}

/** Files sent at the same time. 3 keeps the browser, backend and AI provider busy without throttling. */
const CONCURRENCY = 3;
/** Share of one file's progress that belongs to sending bytes; the rest is Cloudinary storage + AI analysis. */
const SEND_SHARE = 0.3;
const BAR_CELLS = 20;

type ItemStatus = 'queued' | 'sending' | 'processing' | 'done' | 'ai_failed' | 'failed' | 'cancelled';

interface QueueItem {
  key: string;
  file: File;
  status: ItemStatus;
  sent: number; // 0..1 of bytes sent
  error?: string;
  result?: MediaAssetItem;
}

// Subtle Web Audio click for tactile feedback
const playHapticTone = (type: 'drop' | 'success') => {
  try {
    const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    const [f1, f2, g, d] = type === 'drop' ? [320, 180, 0.12, 0.08] : [440, 880, 0.15, 0.12];
    osc.frequency.setValueAtTime(f1, audioCtx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(f2, audioCtx.currentTime + d);
    gain.gain.setValueAtTime(g, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + d);
    osc.start();
    osc.stop(audioCtx.currentTime + d);
  } catch {
    // Audio not allowed; ignore
  }
};

/** Progress of one item as a fraction of its unit (finished items, successful or not, count fully). */
const itemFraction = (it: QueueItem) =>
  it.status === 'done' || it.status === 'ai_failed' || it.status === 'failed' ? 1
  : it.status === 'sending' ? it.sent * SEND_SHARE
  : it.status === 'processing' ? SEND_SHARE
  : 0;

const blockBar = (pct: number) => {
  const filled = Math.round((pct / 100) * BAR_CELLS);
  return { filled: '▓'.repeat(filled), empty: '░'.repeat(BAR_CELLS - filled) };
};

const fmtEta = (s: number) => (s < 60 ? `~${Math.max(1, Math.round(s))}s left` : `~${Math.floor(s / 60)}m ${Math.round(s % 60)}s left`);

export const UploadSection: React.FC<UploadSectionProps> = ({ folders, onUploadSuccess, setActiveTab }) => {
  const [isDragging, setIsDragging] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [folderName, setFolderName] = useState('');
  const [selectedPhase, setSelectedPhase] = useState('general');
  const [items, setItems] = useState<QueueItem[]>([]);
  const [running, setRunning] = useState(false);
  const [startedAt, setStartedAt] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [errorMsg, setErrorMsg] = useState('');
  const [retryingAi, setRetryingAi] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const folderIdRef = useRef<number | null>(null);

  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [running]);

  const addFiles = (list: FileList | null) => {
    if (!list?.length) return;
    playHapticTone('drop');
    const files = Array.from(list).filter((f) => f.type.startsWith('image/'));
    setSelectedFiles((prev) => [...prev, ...files]);
  };

  const patch = (key: string, p: Partial<QueueItem>) =>
    setItems((prev) => prev.map((it) => (it.key === key ? { ...it, ...p } : it)));

  /** Uploads the given items with CONCURRENCY workers. */
  const runQueue = async (queue: QueueItem[], folderId: number) => {
    const controller = new AbortController();
    abortRef.current = controller;
    setRunning(true);
    setStartedAt(Date.now());
    setNow(Date.now());
    let next = 0;

    const worker = async () => {
      while (next < queue.length && !controller.signal.aborted) {
        const it = queue[next++];
        patch(it.key, { status: 'sending', sent: 0, error: undefined });
        try {
          const res = await api.uploadMedia(it.file, {
            folderId,
            phase: selectedPhase,
            signal: controller.signal,
            onBytes: (loaded, total) => patch(it.key, loaded >= total ? { status: 'processing', sent: 1 } : { sent: loaded / total }),
          });
          patch(it.key, res.ai_status === 'failed'
            ? { status: 'ai_failed', result: res, error: res.ai_error || 'AI analysis failed' }
            : { status: 'done', result: res });
        } catch (e: any) {
          patch(it.key, e instanceof UploadAbortedError ? { status: 'cancelled' } : { status: 'failed', error: e.message });
        }
      }
    };

    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker));
    if (controller.signal.aborted) {
      setItems((prev) => prev.map((it) => (it.status === 'queued' ? { ...it, status: 'cancelled' } : it)));
    } else {
      playHapticTone('success');
    }
    setRunning(false);
    abortRef.current = null;
    onUploadSuccess();
  };

  const startUpload = async () => {
    if (!folderName.trim()) {
      setErrorMsg('Folder name is required. Enter a folder name above before uploading.');
      return;
    }
    if (!selectedFiles.length) {
      setErrorMsg('Select at least one photo to upload.');
      return;
    }
    setErrorMsg('');
    let folderId: number;
    try {
      // Create (or reuse) the folder once, so parallel uploads can't create duplicates
      folderId = (await api.createFolder(folderName.trim())).id;
    } catch (e: any) {
      setErrorMsg(e.message);
      return;
    }
    folderIdRef.current = folderId;
    const queue: QueueItem[] = selectedFiles.map((file, i) => ({ key: `${Date.now()}-${i}-${file.name}`, file, status: 'queued', sent: 0 }));
    setItems(queue);
    setSelectedFiles([]);
    await runQueue(queue, folderId);
  };

  const retryFailedUploads = async () => {
    const failed = items.filter((it) => it.status === 'failed' || it.status === 'cancelled').map((it) => ({ ...it, status: 'queued' as ItemStatus, sent: 0 }));
    if (!failed.length || !folderIdRef.current) return;
    setItems((prev) => prev.map((it) => failed.find((f) => f.key === it.key) || it));
    await runQueue(failed, folderIdRef.current);
  };

  const retryAiAnalysis = async () => {
    setRetryingAi(true);
    for (const it of items.filter((x) => x.status === 'ai_failed' && x.result)) {
      try {
        const updated = await api.analyzeAsset(it.result!.id);
        patch(it.key, { status: 'done', result: updated, error: undefined });
      } catch (e: any) {
        patch(it.key, { error: e.message });
      }
    }
    setRetryingAi(false);
    onUploadSuccess();
  };

  // ---------- derived progress ----------
  const total = items.length;
  const doneCount = items.filter((i) => i.status === 'done').length;
  const aiFailed = items.filter((i) => i.status === 'ai_failed');
  const uploadFailed = items.filter((i) => i.status === 'failed' || i.status === 'cancelled');
  const finished = items.filter((i) => ['done', 'ai_failed', 'failed'].includes(i.status)).length;
  const progress = total ? items.reduce((s, it) => s + itemFraction(it), 0) / total : 0;
  const pct = Math.min(100, Math.round(progress * 100));
  const elapsed = (now - startedAt) / 1000;
  // ETA from real throughput, shown once at least one photo has finished
  const eta = running && finished > 0 && progress > 0 && progress < 1 ? (elapsed / progress) * (1 - progress) : null;
  const bar = blockBar(pct);
  const stored = items.filter((i) => i.result);

  return (
    <div className="relative min-h-[90vh] py-8 overflow-hidden">
      <div className="max-w-4xl mx-auto px-4 relative z-10">
        <div className="text-center mb-8">
          <h2 className="text-3xl sm:text-5xl font-extrabold text-slate-900 tracking-tight">Drop all your images here</h2>
          <p className="mt-3 text-sm sm:text-base lg:text-lg text-slate-700 font-medium sm:whitespace-nowrap">
            We will organize and analyze all your photos for you.
          </p>
        </div>

        {/* Folder + phase */}
        <div className="mb-6 bg-white/95 backdrop-blur-xl p-5 rounded-3xl border border-sky-200/80 shadow-md">
          <label htmlFor="upload-folder" className="text-xs sm:text-sm font-bold uppercase tracking-wider text-slate-700 mb-2 flex items-center gap-2">
            <FolderPlus className="w-4 h-4 text-sky-600" />
            <span>Folder Name <span className="text-rose-500">*</span></span>
          </label>
          <input
            id="upload-folder"
            type="text"
            required
            disabled={running}
            value={folderName}
            onChange={(e) => { setFolderName(e.target.value); if (errorMsg) setErrorMsg(''); }}
            placeholder="Enter folder name, e.g. Kenya Reforestation 2026"
            list="upload-folder-suggestions"
            className="w-full px-4 py-3 rounded-2xl border border-slate-300 bg-white text-slate-900 font-semibold text-sm sm:text-base focus:outline-none focus:ring-2 focus:ring-sky-500 placeholder:text-slate-400 shadow-sm disabled:opacity-60"
          />
          <datalist id="upload-folder-suggestions">
            {folders.map((f) => <option key={f.id} value={f.name} />)}
          </datalist>

          <div className="mt-4">
            <span className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-2">Project phase</span>
            <div className="grid grid-cols-4 gap-1.5" role="radiogroup" aria-label="Project phase">
              {['before', 'during', 'after', 'general'].map((p) => (
                <button
                  key={p}
                  type="button"
                  role="radio"
                  aria-checked={selectedPhase === p}
                  disabled={running}
                  onClick={() => setSelectedPhase(p)}
                  className={`py-2 rounded-xl text-xs sm:text-sm font-bold border capitalize transition-all ${
                    selectedPhase === p ? 'bg-sky-600 text-white border-sky-600 shadow-sm' : 'bg-white text-slate-600 border-slate-200 hover:border-sky-300'
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Dropzone */}
        {!running && (
          <div
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={(e) => { e.preventDefault(); setIsDragging(false); }}
            onDrop={(e) => { e.preventDefault(); setIsDragging(false); addFiles(e.dataTransfer.files); }}
            onClick={() => fileInputRef.current?.click()}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') fileInputRef.current?.click(); }}
            role="button"
            tabIndex={0}
            aria-label="Choose photos to upload"
            className={`relative border-2 border-dashed rounded-3xl p-8 sm:p-12 text-center cursor-pointer transition-all duration-300 bg-white/90 backdrop-blur-md shadow-md ${
              isDragging ? 'border-sky-500 bg-sky-100/90 scale-[1.01] shadow-2xl shadow-sky-400/30' : 'border-sky-300/80 hover:bg-sky-50/80 hover:border-sky-400'
            }`}
          >
            <input ref={fileInputRef} type="file" multiple accept="image/*" onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} className="hidden" />
            <div className="w-20 h-20 sm:w-24 sm:h-24 mx-auto rounded-full bg-gradient-to-tr from-sky-500 to-blue-600 flex items-center justify-center text-white mb-6 shadow-xl shadow-sky-500/25">
              <UploadCloud className={`w-10 h-10 sm:w-12 sm:h-12 ${isDragging ? 'animate-bounce' : ''}`} />
            </div>
            <h3 className="text-xl sm:text-2xl font-bold text-slate-900">
              {isDragging ? 'Release to drop your files here!' : 'Click to browse or drag & drop files here'}
            </h3>
          </div>
        )}

        {/* Staged files */}
        {selectedFiles.length > 0 && !running && (
          <div className="mt-6 bg-white/95 backdrop-blur-md rounded-3xl p-5 border border-sky-100 shadow-md">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <FileImage className="w-5 h-5 text-sky-600" />
                <h4 className="font-bold text-base text-slate-900">
                  Ready to upload ({selectedFiles.length} {selectedFiles.length === 1 ? 'photo' : 'photos'})
                </h4>
              </div>
              <button onClick={() => setSelectedFiles([])} className="text-xs text-rose-600 hover:underline font-semibold">Clear all</button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-60 overflow-y-auto pr-1">
              {selectedFiles.map((file, idx) => (
                <div key={`${file.name}-${idx}`} className="flex items-center justify-between p-2.5 rounded-xl bg-slate-50 border border-slate-200/80">
                  <div className="flex items-center gap-2.5 overflow-hidden">
                    <div className="w-9 h-9 rounded-lg bg-sky-100 text-sky-700 flex items-center justify-center font-bold text-xs shrink-0">IMG</div>
                    <div className="truncate">
                      <p className="text-sm font-semibold text-slate-900 truncate">{file.name}</p>
                      <p className="text-xs text-slate-500 font-medium">{(file.size / 1024).toFixed(1)} KB</p>
                    </div>
                  </div>
                  <button onClick={() => setSelectedFiles((prev) => prev.filter((_, i) => i !== idx))} className="p-1 text-slate-400 hover:text-rose-500 rounded-lg" aria-label={`Remove ${file.name}`}>
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
            <div className="mt-5 flex justify-end">
              <button
                onClick={startUpload}
                className="px-8 py-3 rounded-full bg-gradient-to-r from-sky-600 to-blue-600 hover:from-sky-700 hover:to-blue-700 text-white font-bold text-sm shadow-lg shadow-sky-600/25 transition-all flex items-center gap-2"
              >
                <Sparkles className="w-4 h-4" />
                <span>Upload &amp; Analyze</span>
              </button>
            </div>
          </div>
        )}

        {/* Batch progress */}
        {total > 0 && (
          <div className="mt-6 bg-white/95 rounded-3xl p-6 border border-sky-100 shadow-xl animate-fade-in" aria-live="polite">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
              <span className="text-sm font-bold text-slate-900 flex items-center gap-2">
                {running ? <span className="w-2.5 h-2.5 rounded-full bg-sky-600 animate-ping" /> : <CheckCircle2 className="w-4 h-4 text-emerald-600" />}
                {running ? `Uploading to “${folderName.trim()}”` : 'Upload finished'}
              </span>
              {running && (
                <button onClick={() => abortRef.current?.abort()} className="text-xs font-bold text-rose-600 hover:text-rose-700 flex items-center gap-1">
                  <Square className="w-3 h-3" /> Cancel
                </button>
              )}
            </div>

            <div
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={pct}
              aria-label="Upload progress"
              className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono"
            >
              <span className="text-2xl sm:text-3xl tracking-tight leading-none select-none" aria-hidden="true">
                <span className="text-sky-600">{bar.filled}</span>
                <span className="text-slate-300">{bar.empty}</span>
              </span>
              <span className="text-2xl sm:text-3xl font-extrabold text-slate-900 tabular-nums">{pct}%</span>
              <span className="text-sm sm:text-base font-bold text-slate-500 tabular-nums">
                {running ? (eta != null ? fmtEta(eta) : 'estimating…') : `${Math.round(elapsed)}s total`}
              </span>
            </div>

            <p className="mt-3 text-sm font-semibold text-slate-600 tabular-nums">
              {finished}/{total} processed · {doneCount} ready
              {aiFailed.length > 0 && <span className="text-amber-700"> · {aiFailed.length} need AI retry</span>}
              {uploadFailed.length > 0 && <span className="text-rose-600"> · {uploadFailed.length} not uploaded</span>}
            </p>

            {!running && (aiFailed.length > 0 || uploadFailed.length > 0) && (
              <div className="mt-4 space-y-2">
                {[...uploadFailed, ...aiFailed].slice(0, 8).map((it) => (
                  <p key={it.key} className={`text-xs font-semibold flex items-start gap-1.5 ${it.status === 'ai_failed' ? 'text-amber-700' : 'text-rose-600'}`}>
                    <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                    <span><b>{it.file.name}</b>: {it.status === 'cancelled' ? 'cancelled' : it.status === 'ai_failed' ? `stored in Cloudinary, ${it.error}` : it.error}</span>
                  </p>
                ))}
                <div className="flex flex-wrap gap-2 pt-1">
                  {uploadFailed.length > 0 && (
                    <button onClick={retryFailedUploads} className="px-4 py-2 rounded-full bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold flex items-center gap-1.5">
                      <RotateCcw className="w-3.5 h-3.5" /> Retry {uploadFailed.length} upload{uploadFailed.length === 1 ? '' : 's'}
                    </button>
                  )}
                  {aiFailed.length > 0 && (
                    <button onClick={retryAiAnalysis} disabled={retryingAi} className="px-4 py-2 rounded-full bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold flex items-center gap-1.5 disabled:opacity-60">
                      <RotateCcw className={`w-3.5 h-3.5 ${retryingAi ? 'animate-spin' : ''}`} /> Retry AI for {aiFailed.length}
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {errorMsg && (
          <div role="alert" className="mt-6 p-4 rounded-2xl bg-rose-50 border border-rose-200 text-rose-700 flex items-center gap-3">
            <AlertCircle className="w-5 h-5 shrink-0" />
            <p className="text-sm font-semibold">{errorMsg}</p>
          </div>
        )}

        {/* Stored photos */}
        {!running && stored.length > 0 && (
          <div className="mt-6 bg-white/95 rounded-3xl p-6 border border-emerald-100 shadow-lg animate-fade-in">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-6 h-6 text-emerald-600" />
                <h4 className="font-extrabold text-lg text-slate-900">{stored.length} photo{stored.length === 1 ? '' : 's'} uploaded</h4>
              </div>
              <button
                onClick={() => setActiveTab('library')}
                className="inline-flex items-center gap-1.5 text-xs font-bold text-sky-600 hover:text-sky-800 bg-sky-50 px-3 py-1.5 rounded-full border border-sky-200"
              >
                View in Media Library <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 gap-2">
              {stored.slice(0, 32).map((it) => (
                <div key={it.key} className="relative aspect-square rounded-xl overflow-hidden ring-1 ring-slate-200 bg-slate-100" title={it.result!.original_name}>
                  <img src={it.result!.thumbnail_url || it.result!.secure_url} alt={it.result!.original_name} className="w-full h-full object-cover" loading="lazy" />
                  {it.status === 'ai_failed' && <span className="absolute bottom-1 left-1 px-1 rounded bg-amber-500 text-white text-[9px] font-extrabold">AI retry</span>}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
