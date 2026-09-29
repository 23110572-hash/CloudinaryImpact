import React, { useState, useRef } from 'react';
import { UploadCloud, CheckCircle2, AlertCircle, Sparkles, FolderPlus, Tag, Layers, FileImage, X, ArrowRight, ShieldCheck } from 'lucide-react';
import { api, FolderItem } from '../services/api';

interface UploadSectionProps {
  folders: FolderItem[];
  onUploadSuccess: () => void;
  setActiveTab: (tab: string) => void;
}

// Subtle Web Audio API click synthesizer for tactile haptic feedback
const playHapticTone = (type: 'drop' | 'success') => {
  try {
    const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);

    if (type === 'drop') {
      osc.frequency.setValueAtTime(320, audioCtx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(180, audioCtx.currentTime + 0.08);
      gain.gain.setValueAtTime(0.12, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.08);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.08);
    } else {
      osc.frequency.setValueAtTime(440, audioCtx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(880, audioCtx.currentTime + 0.12);
      gain.gain.setValueAtTime(0.15, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.12);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.12);
    }
  } catch (e) {
    // Audio context not allowed or not supported, ignore silently
  }
};

export const UploadSection: React.FC<UploadSectionProps> = ({ folders, onUploadSuccess, setActiveTab }) => {
  const [isDragging, setIsDragging] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [folderName, setFolderName] = useState<string>('');
  const [selectedPhase, setSelectedPhase] = useState<string>('general');
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [currentStepText, setCurrentStepText] = useState('');
  const [uploadedResults, setUploadedResults] = useState<any[]>([]);
  const [errorMsg, setErrorMsg] = useState('');

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    playHapticTone('drop');
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'));
      setSelectedFiles(prev => [...prev, ...files]);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      playHapticTone('drop');
      const files = Array.from(e.target.files).filter(f => f.type.startsWith('image/'));
      setSelectedFiles(prev => [...prev, ...files]);
      e.target.value = '';
    }
  };

  const removeFile = (index: number) => {
    setSelectedFiles(prev => prev.filter((_, i) => i !== index));
  };

  const startUpload = async () => {
    if (!folderName.trim()) {
      setErrorMsg('Folder name is required. Please enter a folder name above before uploading.');
      return;
    }
    if (selectedFiles.length === 0) {
      setErrorMsg('Please select at least one file to upload.');
      return;
    }
    setIsUploading(true);
    setUploadProgress(10);
    setErrorMsg('');
    setCurrentStepText('Uploading to Cloudinary...');

    const results: any[] = [];
    try {
      for (let i = 0; i < selectedFiles.length; i++) {
        const file = selectedFiles[i];
        setCurrentStepText(`Ingesting file ${i + 1} of ${selectedFiles.length}: ${file.name}`);
        
        // Progress simulation
        setUploadProgress(25 + Math.round(((i + 0.3) / selectedFiles.length) * 45));

        const res = await api.uploadMedia(file, folderName.trim(), '', selectedPhase, (pct) => {
          setUploadProgress(pct);
        });

        setCurrentStepText(`Analyzing ${file.name}...`);
        setUploadProgress(70 + Math.round(((i + 1) / selectedFiles.length) * 25));
        results.push(res);
      }

      setUploadProgress(100);
      setCurrentStepText('All photos uploaded and organized.');
      playHapticTone('success');
      setUploadedResults(results);
      setSelectedFiles([]);
      onUploadSuccess();
    } catch (err: any) {
      setErrorMsg(err.message || 'Upload failed. Please verify backend connection.');
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="relative min-h-[90vh] py-8 overflow-hidden">
      <div className="max-w-4xl mx-auto px-4 relative z-10">
        {/* Section Header */}
        <div className="text-center mb-8">
          <h2 className="text-3xl sm:text-5xl font-extrabold text-slate-900 tracking-tight">
            Drop all your images here
          </h2>
          {/* Subtitle strictly formatted on one line */}
          <p className="mt-3 text-sm sm:text-base lg:text-lg text-slate-700 max-w-5xl mx-auto font-medium sm:whitespace-nowrap">
            We will organize, analyze all your photos for you.
          </p>
        </div>

        {/* Compulsory Folder Name Input (Positioned Upward, Before Images) */}
        <div className="mb-6 bg-white/95 backdrop-blur-xl p-5 rounded-3xl border border-sky-200/80 shadow-md">
          <label className="block text-xs sm:text-sm font-bold uppercase tracking-wider text-slate-700 mb-2 flex items-center gap-2">
            <FolderPlus className="w-4 h-4 text-sky-600" />
            <span>Folder Name <span className="text-rose-500">*</span></span>
          </label>
          <input
            type="text"
            required
            value={folderName}
            onChange={(e) => {
              setFolderName(e.target.value);
              if (errorMsg) setErrorMsg('');
            }}
            placeholder="Enter folder name, e.g. Kenya Reforestation 2026"
            list="upload-folder-suggestions"
            className="w-full px-4 py-3 rounded-2xl border border-slate-300 bg-white text-slate-900 font-semibold text-sm sm:text-base focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-sky-500 placeholder:text-slate-400 shadow-sm"
          />
          <datalist id="upload-folder-suggestions">
            {folders.map((f) => <option key={f.id} value={f.name} />)}
          </datalist>

          <div className="mt-4">
            <div>
              <span className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-2">
                Project phase
              </span>
              <div className="grid grid-cols-4 gap-1.5" role="radiogroup" aria-label="Project phase">
                {[
                  { id: 'before', label: 'Before' },
                  { id: 'during', label: 'During' },
                  { id: 'after', label: 'After' },
                  { id: 'general', label: 'General' },
                ].map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    role="radio"
                    aria-checked={selectedPhase === p.id}
                    onClick={() => setSelectedPhase(p.id)}
                    className={`py-2 rounded-xl text-xs sm:text-sm font-bold border transition-all ${
                      selectedPhase === p.id
                        ? 'bg-sky-600 text-white border-sky-600 shadow-sm'
                        : 'bg-white text-slate-600 border-slate-200 hover:border-sky-300'
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Main Dropzone Card with Haptic-Feel Animation */}
        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`relative border-2 border-dashed rounded-3xl p-8 sm:p-12 text-center cursor-pointer transition-all duration-300 bg-white/90 backdrop-blur-md shadow-md ${
            isDragging
              ? 'border-sky-500 bg-sky-100/90 scale-[1.01] shadow-2xl shadow-sky-400/30'
              : 'border-sky-300/80 hover:bg-sky-50/80 hover:border-sky-400 shadow-sky-950/5'
          }`}
        >
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/*"
            onChange={handleFileChange}
            className="hidden"
          />

          {/* Pulsing Aura */}
          <div className="w-20 h-20 sm:w-24 sm:h-24 mx-auto rounded-full bg-gradient-to-tr from-sky-500 to-blue-600 flex items-center justify-center text-white mb-6 shadow-xl shadow-sky-500/25 group-hover:scale-105 transition-transform">
            <UploadCloud className={`w-10 h-10 sm:w-12 sm:h-12 ${isDragging ? 'animate-bounce' : ''}`} />
          </div>

          <h3 className="text-xl sm:text-2xl font-bold text-slate-900">
            {isDragging ? 'Release to drop your files here!' : 'Click to browse or drag & drop files here'}
          </h3>
        </div>

        {/* Selected Files Queue Preview */}
        {selectedFiles.length > 0 && (
          <div className="mt-6 bg-white/95 backdrop-blur-md rounded-3xl p-5 border border-sky-100 shadow-md">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <FileImage className="w-5 h-5 text-sky-600" />
                <h4 className="font-bold text-base text-slate-900">
                  Staged for Ingestion ({selectedFiles.length} {selectedFiles.length === 1 ? 'file' : 'files'})
                </h4>
              </div>
              <button
                onClick={() => setSelectedFiles([])}
                className="text-xs text-rose-600 hover:underline font-semibold"
              >
                Clear all
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-60 overflow-y-auto pr-1">
              {selectedFiles.map((file, idx) => (
                <div
                  key={idx}
                  className="flex items-center justify-between p-2.5 rounded-xl bg-slate-50 border border-slate-200/80"
                >
                  <div className="flex items-center gap-2.5 overflow-hidden">
                    <div className="w-9 h-9 rounded-lg bg-sky-100 text-sky-700 flex items-center justify-center font-bold text-xs shrink-0">
                      IMG
                    </div>
                    <div className="truncate">
                      <p className="text-sm font-semibold text-slate-900 truncate">{file.name}</p>
                      <p className="text-xs text-slate-500 font-medium">{(file.size / 1024).toFixed(1)} KB</p>
                    </div>
                  </div>
                  <button
                    onClick={() => removeFile(idx)}
                    className="p-1 text-slate-400 hover:text-rose-500 rounded-lg transition-colors"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>

            <div className="mt-5 flex justify-end">
              <button
                onClick={startUpload}
                disabled={isUploading}
                className="px-8 py-3 rounded-full bg-gradient-to-r from-sky-600 to-blue-600 hover:from-sky-700 hover:to-blue-700 text-white font-bold text-sm shadow-lg shadow-sky-600/25 transition-all flex items-center gap-2"
              >
                <Sparkles className="w-4 h-4" />
                <span>Upload &amp; Analyze</span>
              </button>
            </div>
          </div>
        )}

        {/* Live Upload Progress with Haptics Indicator */}
        {isUploading && (
          <div className="mt-6 bg-white/95 rounded-3xl p-6 border border-sky-100 shadow-xl animate-fade-in">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-sky-600 animate-ping" />
                <span>{currentStepText}</span>
              </span>
              <span className="text-sm font-extrabold text-sky-600">{uploadProgress}%</span>
            </div>

            {/* Tactile Progress Bar */}
            <div className="w-full h-3 bg-slate-100 rounded-full overflow-hidden p-0.5">
              <div
                className="h-full bg-gradient-to-r from-sky-500 to-blue-600 rounded-full transition-all duration-300 shadow-sm"
                style={{ width: `${uploadProgress}%` }}
              />
            </div>
          </div>
        )}

        {/* Error Notification */}
        {errorMsg && (
          <div className="mt-6 p-4 rounded-2xl bg-rose-50 border border-rose-200 text-rose-700 flex items-center gap-3 animate-shake">
            <AlertCircle className="w-5 h-5 shrink-0" />
            <p className="text-sm font-semibold">{errorMsg}</p>
          </div>
        )}

        {/* Uploaded Results Summary */}
        {uploadedResults.length > 0 && (
          <div className="mt-6 bg-white/95 rounded-3xl p-6 border border-emerald-100 shadow-lg animate-fade-in">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2 text-emerald-700">
                <CheckCircle2 className="w-6 h-6 text-emerald-600" />
                <h4 className="font-extrabold text-lg text-slate-900">
                  {uploadedResults.length} photo{uploadedResults.length === 1 ? '' : 's'} uploaded
                </h4>
              </div>
              <button
                onClick={() => setActiveTab('library')}
                className="inline-flex items-center gap-1.5 text-xs font-bold text-sky-600 hover:text-sky-800 bg-sky-50 px-3 py-1.5 rounded-full border border-sky-200 transition-colors"
              >
                <span>View in Media Library</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {uploadedResults.map((item, idx) => (
                <div key={idx} className="p-3 rounded-2xl bg-slate-50 border border-slate-200/80 flex items-center gap-3">
                  <img
                    src={item.thumbnail_url || item.secure_url}
                    alt={item.original_name}
                    className="w-14 h-14 rounded-xl object-cover ring-1 ring-slate-200 shrink-0"
                  />
                  <div className="overflow-hidden">
                    <p className="text-xs font-bold text-slate-900 truncate">{item.original_name}</p>
                    <p className="text-[11px] text-sky-700 font-semibold mt-0.5 truncate">
                      Folder: {item.folder?.name || '—'}
                    </p>
                    {item.ai_analysis && (
                      <p className="text-[11px] text-slate-500 line-clamp-1 mt-0.5">
                        {item.ai_analysis.summary}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
