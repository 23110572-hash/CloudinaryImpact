// In production (Vercel) set VITE_API_URL to the Render backend, e.g. https://cloudinary-impact-api.onrender.com
// Locally it stays empty and Vite's dev proxy forwards /api to localhost:8000.
export const BACKEND_URL = ((import.meta as any).env?.VITE_API_URL || '').replace(/\/+$/, '');
export const API_BASE = `${BACKEND_URL}/api`;

/** Local-fallback uploads are served by the backend at /static/...; make them absolute in production. */
export const assetUrl = (url?: string | null) => (url && url.startsWith('/static/') ? `${BACKEND_URL}${url}` : url || '');

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
  mode: 'own' | 'platform' | 'local';
  cloud_name: string | null;
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
  ai_status?: 'analyzed' | 'pending';
  is_cloudinary?: boolean;
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
  provider_used: string;
  steps: Array<{ title: string; detail: string }>;
}

export interface ComparisonResult {
  id: number;
  title: string;
  delta_summary: string;
  impact_score: number;
  metrics_diff: Record<string, any>;
  simulated?: boolean;
  provider_used?: string;
  before_url?: string;
  after_url?: string;
  before_name?: string;
  after_name?: string;
  before_asset?: { id: number; url: string; name: string };
  after_asset?: { id: number; url: string; name: string };
  created_at?: string;
}

export interface ReportItem {
  id: number;
  title: string;
  category: string;
  markdown_content: string;
  key_metrics: Array<{ label: string; value: string }>;
  created_at: string;
}

/** Fired when the backend says the session is no longer valid. App listens and signs the user out. */
export const AUTH_EXPIRED_EVENT = 'auth:expired';

function authHeader(): Record<string, string> {
  const token = localStorage.getItem('token');
  return token ? { Authorization: `Bearer ${token}` } : {};
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
  if (res.status === 401 && localStorage.getItem('token')) {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT));
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const detail = typeof err.detail === 'string'
      ? err.detail
      : Array.isArray(err.detail) ? err.detail.map((d: any) => d.msg).join(', ') : `Request failed (${res.status})`;
    throw new Error(detail);
  }
  return absolutizeUrls(await res.json());
}

/** Recursively turns backend-relative "/static/..." strings into absolute URLs (no-op when BACKEND_URL is empty). */
function absolutizeUrls<T>(data: T): T {
  if (!BACKEND_URL) return data;
  const walk = (v: any): any => {
    if (typeof v === 'string') return assetUrl(v);
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') {
      for (const k of Object.keys(v)) v[k] = walk(v[k]);
    }
    return v;
  };
  return walk(data);
}

function storeAuth(data: AuthResponse) {
  if (data.access_token) {
    localStorage.setItem('token', data.access_token);
    localStorage.setItem('user', JSON.stringify(data.user));
  }
  return data;
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

  analyzeAsset(id: number): Promise<MediaAssetItem> {
    return request<MediaAssetItem>(`/media/${id}/analyze`, { method: 'POST' });
  },

  getMedia(params: { folder_id?: number; phase?: string; search?: string } = {}): Promise<MediaAssetItem[]> {
    const query = new URLSearchParams();
    if (params.folder_id) query.append('folder_id', params.folder_id.toString());
    if (params.phase) query.append('phase', params.phase);
    if (params.search) query.append('search', params.search);
    return request<MediaAssetItem[]>(`/media?${query.toString()}`);
  },

  uploadMedia(
    file: File,
    folderName?: string,
    customTags?: string,
    phase: string = 'general',
    onProgress?: (pct: number) => void
  ): Promise<any> {
    const formData = new FormData();
    formData.append('file', file);
    if (folderName && folderName.trim()) formData.append('folder_name', folderName.trim());
    if (customTags && customTags.trim()) formData.append('custom_tags', customTags.trim());
    formData.append('phase', phase);

    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${API_BASE}/media/upload`);
      const token = localStorage.getItem('token');
      if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);

      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100));
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(absolutizeUrls(JSON.parse(xhr.responseText)));
        } else {
          let msg = `Upload failed with status ${xhr.status}`;
          try { msg = JSON.parse(xhr.responseText).detail || msg; } catch { /* keep default */ }
          reject(new Error(msg));
        }
      };
      xhr.onerror = () => reject(new Error('Network error during upload'));
      xhr.send(formData);
    });
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

  generateReport(opts: { title: string; folder_id?: number; target_stakeholder: string; tone: string }): Promise<ReportItem> {
    return request<ReportItem>('/reports/generate', { method: 'POST', body: JSON.stringify(opts) });
  },

  getReports(): Promise<ReportItem[]> {
    return request<ReportItem[]>('/reports');
  },

  deleteReport(id: number): Promise<any> {
    return request(`/reports/${id}`, { method: 'DELETE' });
  },
};
