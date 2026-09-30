// In production (Vercel) set VITE_API_URL to the Render backend, e.g. https://cloudinary-impact-api.onrender.com
// Locally it stays empty and Vite's dev proxy forwards /api to localhost:8000.
export const BACKEND_URL = ((import.meta as any).env?.VITE_API_URL || '').replace(/\/+$/, '');
export const API_BASE = `${BACKEND_URL}/api`;

export interface FolderItem {
  id: number;
  name: string;
  slug: string;
  description: string;
  color: string;
  icon: string;
  asset_count: number;
  preview_thumbnails: string[];
  cloudinary_path?: string | null;
  created_at?: string;
}

export interface StorageInfo {
  mode: 'own' | 'platform';
  cloud_name: string;
  root_folder: string;
}

export interface AIAnalysisData {
  summary: string;
  project_category: string;
  activity_detected?: string;
  visual_signals: string[];
  environmental_metrics: Record<string, any>;
  authenticity_score: number;
  confidence: number;
}

export interface MediaAssetItem {
  id: number;
  original_name: string;
  secure_url: string;
  thumbnail_url: string;
  format: string;
  resource_type: string;
  bytes: number;
  width: number;
  height: number;
  captured_at?: string;
  latitude?: number;
  longitude?: number;
  phase: string;
  uploaded_at?: string;
  upload_key?: string | null;
  ai_status: 'analyzed' | 'pending' | 'failed';
  /** Only set on upload responses when AI analysis failed (the photo itself is stored). */
  ai_error?: string | null;
  folder?: {
    id: number;
    name: string;
    color: string;
    icon: string;
    cloudinary_path?: string | null;
  };
  ai_analysis?: AIAnalysisData | null;
}

export interface UserInfo {
  id: number;
  email: string;
  full_name: string;
}

export interface AuthResponse {
  access_token: string;
  token_type: string;
  user: UserInfo;
}

export interface ProviderInfo {
  id: string;
  name: string;
  key_hint?: string;
  models: string[];
}

export interface SettingsData {
  llm_mode: 'system' | 'byok';
  active_provider: string;
  active_model: string;
  masked_keys: Record<string, string>;
  supported_providers: ProviderInfo[];
  system_ai?: { live: boolean; provider: string | null; model: string | null };
  cloudinary: {
    configured: boolean;
    cloud_name: string;
    masked_api_key?: string;
    system_configured?: boolean;
  };
}

export interface ChatAsset {
  id: number;
  original_name: string;
  thumbnail_url: string;
  secure_url: string;
  folder: string | null;
  phase: string;
  captured_at: string | null;
  latitude: number | null;
  longitude: number | null;
  category: string | null;
}

export interface ChatResponse {
  answer: string;
  assets: ChatAsset[];
  steps: Array<{ title: string; detail: string }>;
}

export interface ComparisonResult {
  id: number;
  title: string;
  delta_summary: string;
  impact_score: number;
  metrics_diff: Record<string, any>;
  before_url?: string;
  after_url?: string;
  before_name?: string;
  after_name?: string;
  before_asset?: { id: number; url: string; name: string };
  after_asset?: { id: number; url: string; name: string };
  created_at?: string;
}

export type CreationKind = 'document' | 'social' | 'before_after' | 'reel' | 'pack';

export interface StudioIdea {
  title: string;
  description: string;
  kind: CreationKind;
  audience: string;
  tone: string;
  prompt: string;
  asset_ids: number[];
}

export interface FolderStats {
  total: number;
  images: number;
  analyzed: number;
  not_analyzed: number;
  phases: { before: number; during: number; after: number; general: number };
  geotagged: number;
  date_range: [string, string] | null;
  top_tags: string[];
  themes: string[];
}

export interface FolderIdeas {
  folder_id: number;
  folder_name: string;
  stats: FolderStats;
  theme: string;
  ideas: StudioIdea[];
}

export interface CreationMedia {
  format: string;
  label: string;
  url: string;
}

/** A Studio creation (reports from older versions come back as kind "document"). */
export interface ReportItem {
  id: number;
  title: string;
  kind: CreationKind;
  folder_id: number | null;
  category: string;
  markdown_content: string;
  key_metrics: Array<{ label: string; value: string }>;
  payload: {
    images?: CreationMedia[];
    videos?: CreationMedia[];
    cover_images?: Array<{ id: number; url: string }>;
    source_ids?: number[];
    headline?: string;
    caption?: string;
    post_text?: string;
    hashtags?: string[];
    zip_name?: string;
    idea?: StudioIdea;
  };
  created_at: string;
}

/** Fired when the backend says the session is no longer valid. App listens and signs the user out. */
export const AUTH_EXPIRED_EVENT = 'auth:expired';

function authHeader(): Record<string, string> {
  const token = localStorage.getItem('token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function handleUnauthorized(status: number) {
  if (status === 401 && localStorage.getItem('token')) {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT));
  }
}

async function errorMessage(res: Response): Promise<string> {
  const err = await res.json().catch(() => ({}));
  return typeof err.detail === 'string'
    ? err.detail
    : Array.isArray(err.detail) ? err.detail.map((d: any) => d.msg).join(', ') : `Request failed (${res.status})`;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const isForm = init.body instanceof FormData;
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      ...(isForm ? {} : { 'Content-Type': 'application/json' }),
      ...authHeader(),
      ...(init.headers || {}),
    },
  });
  handleUnauthorized(res.status);
  if (!res.ok) throw new Error(await errorMessage(res));
  return res.json();
}

function storeAuth(data: AuthResponse) {
  if (data.access_token) {
    localStorage.setItem('token', data.access_token);
    localStorage.setItem('user', JSON.stringify(data.user));
  }
  return data;
}

export interface UploadOptions {
  folderId?: number;
  folderName?: string;
  phase?: string;
  customTags?: string;
  /** One id per selected file. Re-sending the same key never stores the photo twice. */
  uploadKey?: string;
  signal?: AbortSignal;
  /** Bytes sent so far for this file (browser → backend). */
  onBytes?: (loaded: number, total: number) => void;
}

export class UploadAbortedError extends Error {
  constructor() {
    super('Upload cancelled');
    this.name = 'UploadAbortedError';
  }
}

/** Upload failure with the HTTP status (0 = the response never arrived, e.g. connection dropped). */
export class UploadHttpError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'UploadHttpError';
    this.status = status;
  }
}

export const api = {
  isLoggedIn(): boolean {
    return !!localStorage.getItem('token');
  },

  async login(email: string, password: string): Promise<AuthResponse> {
    return storeAuth(await request<AuthResponse>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }));
  },

  async register(email: string, password: string, fullName: string): Promise<AuthResponse> {
    return storeAuth(await request<AuthResponse>('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password, full_name: fullName }),
    }));
  },

  async getMe(): Promise<UserInfo | null> {
    if (!localStorage.getItem('token')) return null;
    try {
      return await request<UserInfo>('/auth/me');
    } catch {
      return null;
    }
  },

  getUser(): UserInfo | null {
    try {
      const stored = localStorage.getItem('user');
      return stored && localStorage.getItem('token') ? JSON.parse(stored) : null;
    } catch {
      return null;
    }
  },

  logout(): void {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    sessionStorage.removeItem('buddy_chat');
  },

  getSettings(): Promise<SettingsData> {
    return request<SettingsData>('/settings');
  },

  updateSettings(data: Record<string, any>): Promise<{ status: string; message: string; settings: SettingsData }> {
    return request('/settings', { method: 'PUT', body: JSON.stringify(data) });
  },

  testKey(provider: string, apiKey: string, model?: string): Promise<{ valid: boolean; message: string }> {
    return request('/settings/test-key', {
      method: 'POST',
      body: JSON.stringify({ provider, api_key: apiKey, model }),
    });
  },

  testCloudinary(): Promise<{ valid: boolean; message: string }> {
    return request('/settings/test-cloudinary', { method: 'POST' });
  },

  getFolders(): Promise<FolderItem[]> {
    return request<FolderItem[]>('/media/folders');
  },

  createFolder(name: string): Promise<{ id: number; name: string; cloudinary_path: string }> {
    return request('/media/folders', { method: 'POST', body: JSON.stringify({ name }) });
  },

  deleteFolder(id: number): Promise<any> {
    return request(`/media/folders/${id}`, { method: 'DELETE' });
  },

  getStorage(): Promise<StorageInfo> {
    return request<StorageInfo>('/media/storage');
  },

  syncCloudinary(): Promise<{ new_folders: number; new_assets: number; root_folder: string }> {
    return request('/media/sync', { method: 'POST' });
  },

  getAsset(id: number): Promise<MediaAssetItem> {
    return request<MediaAssetItem>(`/media/${id}`);
  },

  /**
   * Runs AI analysis. If the request itself fails (e.g. the response is lost on a slow connection),
   * the asset's real state is read back, so a finished analysis is never reported as an error.
   */
  async analyzeAsset(id: number): Promise<MediaAssetItem> {
    try {
      return await request<MediaAssetItem>(`/media/${id}/analyze`, { method: 'POST' });
    } catch (e) {
      const current = await request<MediaAssetItem>(`/media/${id}`).catch(() => null);
      if (current?.ai_status === 'analyzed') return current;
      throw e;
    }
  },

  getMedia(params: { folder_id?: number; phase?: string; search?: string } = {}): Promise<MediaAssetItem[]> {
    const query = new URLSearchParams();
    if (params.folder_id) query.append('folder_id', params.folder_id.toString());
    if (params.phase) query.append('phase', params.phase);
    if (params.search) query.append('search', params.search);
    return request<MediaAssetItem[]>(`/media?${query.toString()}`);
  },

  /** Uploads one file. Resolves when it is stored in Cloudinary and AI analysis has run (or failed). */
  uploadMedia(file: File, opts: UploadOptions = {}): Promise<MediaAssetItem> {
    const formData = new FormData();
    formData.append('file', file);
    if (opts.folderId) formData.append('folder_id', String(opts.folderId));
    else if (opts.folderName?.trim()) formData.append('folder_name', opts.folderName.trim());
    if (opts.customTags?.trim()) formData.append('custom_tags', opts.customTags.trim());
    if (opts.uploadKey) formData.append('upload_key', opts.uploadKey);
    formData.append('phase', opts.phase || 'general');

    return new Promise((resolve, reject) => {
      if (opts.signal?.aborted) return reject(new UploadAbortedError());
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${API_BASE}/media/upload`);
      const token = localStorage.getItem('token');
      if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);

      const onAbort = () => xhr.abort();
      opts.signal?.addEventListener('abort', onAbort, { once: true });

      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) opts.onBytes?.(e.loaded, e.total);
      };
      xhr.onload = () => {
        opts.signal?.removeEventListener('abort', onAbort);
        handleUnauthorized(xhr.status);
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(JSON.parse(xhr.responseText));
        } else {
          let msg = `Upload failed (${xhr.status})`;
          try { msg = JSON.parse(xhr.responseText).detail || msg; } catch { /* keep default */ }
          reject(new UploadHttpError(msg, xhr.status));
        }
      };
      xhr.onerror = () => {
        opts.signal?.removeEventListener('abort', onAbort);
        reject(new UploadHttpError('The connection dropped before the server replied', 0));
      };
      xhr.onabort = () => reject(new UploadAbortedError());
      xhr.send(formData);
    });
  },

  /** Which of these upload keys the server actually stored (for uploads whose response was lost). */
  uploadStatus(keys: string[]): Promise<MediaAssetItem[]> {
    return request<MediaAssetItem[]>('/media/upload-status', { method: 'POST', body: JSON.stringify({ keys }) });
  },

  deleteAsset(id: number): Promise<any> {
    return request(`/media/${id}`, { method: 'DELETE' });
  },

  chat(message: string, history: Array<{ role: string; content: string }>, assetId?: number): Promise<ChatResponse> {
    return request<ChatResponse>('/ai/chat', {
      method: 'POST',
      body: JSON.stringify({ message, history, asset_id: assetId ?? null }),
    });
  },

  compareAssets(beforeAssetId: number, afterAssetId: number, title: string): Promise<ComparisonResult> {
    return request<ComparisonResult>('/ai/compare', {
      method: 'POST',
      body: JSON.stringify({ before_asset_id: beforeAssetId, after_asset_id: afterAssetId, title }),
    });
  },

  getComparisons(): Promise<ComparisonResult[]> {
    return request<ComparisonResult[]>('/ai/comparisons');
  },

  // ---------- Studio ----------

  getFolderIdeas(folderId: number, refresh = false): Promise<FolderIdeas> {
    return request<FolderIdeas>(`/studio/folders/${folderId}/ideas${refresh ? '?refresh=true' : ''}`);
  },

  createCreation(body: { folder_id: number; idea?: StudioIdea; request?: string }): Promise<ReportItem> {
    return request<ReportItem>('/studio/create', { method: 'POST', body: JSON.stringify(body) });
  },

  getPackLink(creationId: number): Promise<{ url: string; count: number }> {
    return request(`/studio/creations/${creationId}/pack-link`);
  },

  async downloadFolderCsv(folderId: number): Promise<Blob> {
    const res = await fetch(`${API_BASE}/studio/folders/${folderId}/details.csv`, { headers: authHeader() });
    handleUnauthorized(res.status);
    if (!res.ok) throw new Error(await errorMessage(res));
    return res.blob();
  },

  getReports(): Promise<ReportItem[]> {
    return request<ReportItem[]>('/reports');
  },

  deleteReport(id: number): Promise<any> {
    return request(`/reports/${id}`, { method: 'DELETE' });
  },
};
