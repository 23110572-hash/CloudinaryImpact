import React from 'react';
import { Home, UploadCloud, Images, MessageCircleHeart, FileBarChart, Settings, LogIn, Lock } from 'lucide-react';

interface NavbarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  isLoggedIn: boolean;
}

export const NAV_ITEMS = [
  { id: 'home', label: 'Home', icon: Home, requiresAuth: false },
  { id: 'upload', label: 'Upload', icon: UploadCloud, requiresAuth: true },
  { id: 'library', label: 'Media Library', icon: Images, requiresAuth: true },
  { id: 'buddy', label: 'Buddy', icon: MessageCircleHeart, requiresAuth: true },
  { id: 'reports', label: 'Reports', icon: FileBarChart, requiresAuth: true },
] as const;

export const Navbar: React.FC<NavbarProps> = ({ activeTab, setActiveTab, isLoggedIn }) => {
  const items = [
    ...NAV_ITEMS,
    { id: 'settings', label: isLoggedIn ? 'Settings' : 'Sign In', icon: isLoggedIn ? Settings : LogIn, requiresAuth: false },
  ];

  return (
    <nav
      aria-label="Main"
      className="flex items-center gap-0.5 sm:gap-1 px-1.5 sm:px-2.5 py-1.5 rounded-full bg-white/85 backdrop-blur-xl border border-sky-200/80 shadow-md shadow-sky-950/5"
    >
      {items.map((item) => {
        const Icon = item.icon;
        const isActive = activeTab === item.id;
        const isLocked = item.requiresAuth && !isLoggedIn;

        return (
          <button
            key={item.id}
            onClick={() => setActiveTab(isLocked ? 'settings' : item.id)}
            title={isLocked ? `Sign in to open ${item.label}` : item.label}
            aria-label={item.label}
            aria-current={isActive ? 'page' : undefined}
            className={`group flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-full font-bold text-xs sm:text-sm transition-all duration-300 ${
              isActive
                ? 'text-white bg-gradient-to-r from-sky-600 to-blue-600 shadow-md shadow-sky-600/25'
                : isLocked
                ? 'text-slate-400 hover:text-slate-600 hover:bg-slate-100/60'
                : 'text-slate-600 hover:text-slate-900 hover:bg-sky-100/70'
            }`}
          >
            <Icon className={`w-4 h-4 sm:w-3.5 sm:h-3.5 transition-transform duration-300 ${isActive ? 'text-white' : 'group-hover:scale-110'}`} />
            {/* Labels collapse on small screens except for the active tab */}
            <span className={`whitespace-nowrap ${isActive ? 'inline' : 'hidden md:inline'}`}>{item.label}</span>
            {isLocked && <Lock className="hidden md:inline w-2.5 h-2.5 text-slate-400" />}
          </button>
        );
      })}
    </nav>
  );
};
