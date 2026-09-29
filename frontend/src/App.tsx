import React, { useCallback, useEffect, useState } from 'react';
import { LogOut, Lock } from 'lucide-react';
import { Navbar } from './components/Navbar';
import { HomeSection } from './components/HomeSection';
import { UploadSection } from './components/UploadSection';
import { ManagementSection } from './components/ManagementSection';
import { BuddySection } from './components/BuddySection';
import { ReportsSection } from './components/ReportsSection';
import { SettingsSection } from './components/SettingsSection';
import { ShaderBackground } from './components/ui/b-shader';
import { api, AUTH_EXPIRED_EVENT, FolderItem, MediaAssetItem, SettingsData, UserInfo } from './services/api';

const PROTECTED_TABS = new Set(['upload', 'library', 'buddy', 'reports']);

const SignInRequired: React.FC<{ onSignIn: () => void }> = ({ onSignIn }) => (
  <div className="max-w-md mx-auto px-4 py-16 text-center animate-fade-in">
    <div className="bg-white/90 backdrop-blur-xl p-8 rounded-3xl border border-sky-100 shadow-sm space-y-4">
      <div className="w-12 h-12 mx-auto rounded-2xl bg-sky-100 text-sky-700 flex items-center justify-center">
        <Lock className="w-6 h-6" />
      </div>
      <h3 className="text-2xl font-extrabold text-slate-900 tracking-tight">Sign in to continue</h3>
      <p className="text-sm text-slate-600">Your media, Buddy chats and reports are private to your account.</p>
      <button
        onClick={onSignIn}
        className="w-full py-3 rounded-full bg-gradient-to-r from-sky-600 to-blue-600 hover:from-sky-700 hover:to-blue-700 text-white font-bold text-sm shadow-sm transition-all"
      >
        Sign In / Create Account
      </button>
    </div>
  </div>
);

export default function App() {
  const [activeTab, setActiveTab] = useState<string>('home');
  const [folders, setFolders] = useState<FolderItem[]>([]);
  const [media, setMedia] = useState<MediaAssetItem[]>([]);
  const [settings, setSettings] = useState<SettingsData | null>(null);
  const [currentUser, setCurrentUser] = useState<UserInfo | null>(api.getUser());
  const [loadError, setLoadError] = useState<string | null>(null);

  // Cross-page selections
  const [agentAsset, setAgentAsset] = useState<MediaAssetItem | null>(null);
  const [compareBefore, setCompareBefore] = useState<MediaAssetItem | null>(null);
  const [compareAfter, setCompareAfter] = useState<MediaAssetItem | null>(null);

  const clearData = useCallback(() => {
    setFolders([]);
    setMedia([]);
    setSettings(null);
    setAgentAsset(null);
    setCompareBefore(null);
    setCompareAfter(null);
  }, []);

  const loadData = useCallback(async () => {
    if (!api.isLoggedIn()) {
      clearData();
      return;
    }
    try {
      const [f, m, s] = await Promise.all([api.getFolders(), api.getMedia(), api.getSettings()]);
      setFolders(f);
      setMedia(m);
      setSettings(s);
      setLoadError(null);
    } catch (e: any) {
      console.error('Data load error', e);
      setLoadError(e.message || 'Could not reach the server.');
    }
  }, [clearData]);

  const handleSignOut = useCallback(() => {
    api.logout();
    setCurrentUser(null);
    clearData();
    setActiveTab('home');
  }, [clearData]);

  useEffect(() => {
    api.getMe().then((user) => {
      setCurrentUser(user);
      if (user) loadData();
    });
    const onExpired = () => {
      setCurrentUser(null);
      clearData();
    };
    window.addEventListener(AUTH_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, onExpired);
  }, [loadData, clearData]);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [activeTab]);

  const go = (tab: string) => setActiveTab(PROTECTED_TABS.has(tab) && !currentUser ? 'settings' : tab);

  const handleSelectForCompare = (asset: MediaAssetItem, role: 'before' | 'after') => {
    if (role === 'before') setCompareBefore(asset);
    else setCompareAfter(asset);
    setActiveTab('reports');
  };

  const handleSelectForAgent = (asset: MediaAssetItem) => {
    setAgentAsset(asset);
    setActiveTab('buddy');
  };

  const handleDeleteAsset = async (id: number) => {
    if (!window.confirm('Delete this media asset? This cannot be undone.')) return;
    try {
      await api.deleteAsset(id);
      setMedia((prev) => prev.filter((m) => m.id !== id));
      if (agentAsset?.id === id) setAgentAsset(null);
      if (compareBefore?.id === id) setCompareBefore(null);
      if (compareAfter?.id === id) setCompareAfter(null);
      loadData();
    } catch (e: any) {
      window.alert(`Delete failed: ${e.message}`);
    }
  };

  const needsAuth = PROTECTED_TABS.has(activeTab) && !currentUser;

  return (
    <div className="min-h-screen text-slate-800 flex flex-col font-sans relative overflow-x-hidden">
      <div className="fixed inset-0 z-0 pointer-events-none overflow-hidden">
        <ShaderBackground className="w-full h-full" />
      </div>

      {/* Top bar: logo, navbar and account share one row and scroll away with the page (nothing floats over content).
          Below xl the logo stacks above the navbar. */}
      <header className="relative z-40 w-full px-2 sm:px-4 xl:px-6 pt-3">
        <div className="flex flex-col items-center gap-3 xl:grid xl:grid-cols-[1fr_auto_1fr] xl:gap-4">
          <button
            onClick={() => setActiveTab('home')}
            className="xl:justify-self-start hover:scale-105 transition-transform"
            title="Cloudinary Impact Home"
            aria-label="Go to home"
          >
            {/* logo.png has wide transparent margins; object-cover trims them so the box hugs the artwork and centres on the navbar */}
            <img
              src="/logo.png"
              alt="Cloudinary Impact"
              className="block w-[168px] sm:w-48 xl:w-60 2xl:w-72 aspect-[5/1] object-cover object-[center_43%] drop-shadow-sm"
            />
          </button>

          <Navbar activeTab={activeTab} setActiveTab={go} isLoggedIn={!!currentUser} />

          {currentUser && (
            <div className="hidden xl:flex justify-self-end items-center gap-2 animate-fade-in">
              <span className="text-xs font-bold text-slate-700 bg-white/80 backdrop-blur-md px-3 py-1.5 rounded-full border border-sky-100 shadow-sm max-w-[180px] truncate">
                {currentUser.full_name || currentUser.email}
              </span>
              <button
                onClick={handleSignOut}
                className="px-3.5 py-1.5 rounded-full bg-white/90 hover:bg-rose-50 text-rose-600 hover:text-rose-700 border border-rose-200/80 text-xs font-bold flex items-center gap-1.5 shadow-sm transition-all"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>Sign Out</span>
              </button>
            </div>
          )}
        </div>
      </header>

      {loadError && currentUser && (
        <div className="relative z-10 max-w-xl mx-auto mt-6 px-4">
          <div className="p-3 rounded-2xl bg-rose-50 border border-rose-200 text-rose-700 text-sm font-semibold flex items-center justify-between gap-3">
            <span>{loadError}</span>
            <button onClick={loadData} className="underline font-bold">Retry</button>
          </div>
        </div>
      )}

      <main className="flex-1 pb-16 relative z-10">
        {/* key={activeTab} re-mounts the page so its entrance animation replays on every switch */}
        <div key={activeTab} className="animate-fade-in">
          {needsAuth && <SignInRequired onSignIn={() => setActiveTab('settings')} />}

          {activeTab === 'home' && (
            <HomeSection isLoggedIn={!!currentUser} mediaCount={media.length} folderCount={folders.length} onNavigate={go} />
          )}

          {activeTab === 'upload' && currentUser && (
            <UploadSection folders={folders} onUploadSuccess={loadData} setActiveTab={setActiveTab} />
          )}

          {activeTab === 'library' && currentUser && (
            <ManagementSection
              folders={folders}
              media={media}
              onDeleteAsset={handleDeleteAsset}
              onSelectForUnderstand={handleSelectForAgent}
              onSelectForCompare={handleSelectForCompare}
              setActiveTab={setActiveTab}
              onRefreshData={loadData}
            />
          )}

          {activeTab === 'buddy' && currentUser && (
            <BuddySection
              media={media}
              attachedAsset={agentAsset}
              onAttach={setAgentAsset}
              settings={settings}
              onNavigate={go}
            />
          )}

          {activeTab === 'reports' && currentUser && (
            <ReportsSection
              media={media}
              folders={folders}
              selectedBefore={compareBefore}
              selectedAfter={compareAfter}
              onChangeBefore={setCompareBefore}
              onChangeAfter={setCompareAfter}
              onNavigate={go}
            />
          )}

          {activeTab === 'settings' && (
            <SettingsSection
              settings={settings}
              currentUser={currentUser}
              onUserChanged={(user) => {
                setCurrentUser(user);
                if (user) loadData();
                else clearData();
              }}
              onSettingsSaved={setSettings}
              onSignOut={handleSignOut}
            />
          )}
        </div>
      </main>

      {/* Slim strip: tagline pinned to the left corner, "Built on Cloudinary" to the right corner */}
      <footer className="mt-auto border-t border-sky-200/70 bg-white/90 backdrop-blur-md py-4 px-4 xl:px-6 text-slate-700 relative z-10">
        <div className="flex flex-col md:flex-row items-center justify-between gap-x-6 gap-y-2 text-center md:text-left">
          <div className="flex flex-col sm:flex-row items-center gap-3 sm:gap-4">
            <img src="/logo.png" alt="Cloudinary Impact" className="w-[200px] sm:w-[240px] shrink-0 aspect-[5/1] object-cover object-[center_43%]" />
            <span className="text-lg sm:text-xl font-bold">AI-Powered Impact &amp; Sustainability Media Platform</span>
          </div>
          <span className="text-lg sm:text-xl font-extrabold text-slate-900">Built on Cloudinary</span>
        </div>
      </footer>
    </div>
  );
}
