import React, { useEffect, useRef, useState } from 'react';
import {
  UploadCloud, Images, MessageCircleHeart, FileBarChart, ArrowRight,
} from 'lucide-react';
import { ArcGalleryHero } from './ui/arc-gallery-hero-component';

interface HomeSectionProps {
  isLoggedIn: boolean;
  mediaCount: number;
  folderCount: number;
  onNavigate: (tab: string) => void;
}

const HERO_IMAGES = [
  'https://cdn.21st.dev/assets/mirror/70/706df1e921d12b172a0f531bd7e376496acadd61faff14d909d8a02c81330ff6.jpg',
  'https://cdn.21st.dev/assets/mirror/f2/f205346f850085c841beb3a7ca6115bb8aaf8268992606812b207a1993c5769f.jpg',
  'https://cdn.21st.dev/assets/mirror/cf/cf273032d791a8a5d4c6579eae14a92438cdb4a0efb97ad3363d9a4e99b3cea2.jpg',
  'https://cdn.21st.dev/assets/mirror/ab/ab5b8c7b79915a038d1eb60c3b67468cafa0be6ad4525baf1f4904223f2b2c5d.jpg',
  'https://cdn.21st.dev/assets/mirror/60/60a7f8d08136b1422100d95f84edff22bfe37eadc5655023bab5d88158f7acfb.jpg',
  'https://cdn.21st.dev/assets/mirror/e9/e91ba427ad4aee72869842eb6bd37de4d0ec78e07be4c8ba9ba4266ed2f833ec.jpg',
  'https://cdn.21st.dev/assets/mirror/d9/d9980577799353c7dd153d43d99276acb67999f8d2d898f4326be59ce0ec0ced.jpg',
  'https://cdn.21st.dev/assets/mirror/92/92931de16fc02b8fe1d4a37b9c5fc044ff41c05503efd5b25f3ad3f4e9e4f0f3.jpg',
  'https://cdn.21st.dev/assets/mirror/ef/ef1586fd2e6679c8f96172c4308504b6ef4610332ee3ca468b242cb61b9788e2.jpg',
  'https://cdn.21st.dev/assets/mirror/73/734a64693f90f24f82a6950a3d4b69ee5991fc348444b91cb647bc9a253537ad.jpg',
  'https://cdn.21st.dev/assets/mirror/ed/ed77b585b4531d14b2a228904f42d14e01ad1ad2812a15f8441a08e7117d50b2.jpg',
  'https://cdn.21st.dev/assets/mirror/12/128a44d18db06f84d5f5497fe517e20542499146cf23574c8cb625374b93871d.jpg',
];

/** Adds `is-visible` once the element scrolls into view (paired with the `.reveal` CSS class). */
function useReveal<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          obs.disconnect();
        }
      },
      { threshold: 0.15 }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);
  return { ref, visible };
}

const Reveal: React.FC<{ children: React.ReactNode; delay?: number; className?: string }> = ({ children, delay = 0, className = '' }) => {
  const { ref, visible } = useReveal<HTMLDivElement>();
  return (
    <div ref={ref} className={`reveal ${visible ? 'is-visible' : ''} ${className}`} style={{ transitionDelay: `${delay}ms` }}>
      {children}
    </div>
  );
};

const STEPS = [
  { tab: 'upload', icon: UploadCloud, title: 'Upload', color: 'from-sky-500 to-sky-600', text: 'Drop field photos into a project folder and tag them Before, During or After. Cloudinary optimizes and auto-tags them; EXIF GPS and timestamps are extracted.' },
  { tab: 'library', icon: Images, title: 'Media Library', color: 'from-blue-500 to-blue-600', text: 'Browse everything by folder, phase, location and AI-detected signals. Search finds photos by what is in them.' },
  { tab: 'buddy', icon: MessageCircleHeart, title: 'Buddy', color: 'from-indigo-500 to-indigo-600', text: 'Ask in plain language: "which photos have GPS?", "show before photos of the solar site". Attach a photo to ask about it.' },
  { tab: 'reports', icon: FileBarChart, title: 'Reports', color: 'from-violet-500 to-violet-600', text: 'Compare before & after with a slider and AI change analysis, then generate donor-ready reports that link to every source asset.' },
];

export const HomeSection: React.FC<HomeSectionProps> = ({ isLoggedIn, mediaCount, folderCount, onNavigate }) => {
  const pipeline = useReveal<HTMLDivElement>();

  return (
    <div className="space-y-6">
      <ArcGalleryHero images={HERO_IMAGES} onUploadClick={() => onNavigate('upload')} onExploreClick={() => onNavigate('library')} />

      {/* Signed-in quick stats */}
      {isLoggedIn && (
        <Reveal className="max-w-3xl mx-auto px-4">
          <div className="grid grid-cols-2 gap-3">
            <button onClick={() => onNavigate('library')} className="group p-5 rounded-3xl bg-white/90 border border-sky-100 shadow-sm hover:shadow-lg hover:-translate-y-1 transition-all text-left">
              <div className="text-3xl font-extrabold text-slate-900">{mediaCount}</div>
              <div className="text-sm font-semibold text-slate-500 flex items-center gap-1">Assets in your library <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-1 transition-transform" /></div>
            </button>
            <button onClick={() => onNavigate('library')} className="group p-5 rounded-3xl bg-white/90 border border-sky-100 shadow-sm hover:shadow-lg hover:-translate-y-1 transition-all text-left">
              <div className="text-3xl font-extrabold text-sky-600">{folderCount}</div>
              <div className="text-sm font-semibold text-slate-500 flex items-center gap-1">Project folders <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-1 transition-transform" /></div>
            </button>
          </div>
        </Reveal>
      )}

      {/* How it works */}
      <section className="max-w-6xl mx-auto px-4 py-12">
        <Reveal className="text-center mb-12">
          <span className="inline-block px-3 py-1 rounded-full bg-sky-100 text-sky-800 text-xs font-extrabold uppercase tracking-widest mb-3">How it works</span>
          <h3 className="text-2xl sm:text-4xl font-extrabold text-slate-900">From raw field media to proof of impact</h3>
          <p className="mt-2 text-base sm:text-lg text-slate-600 max-w-2xl mx-auto">
            Built for NGOs, governments and sustainability teams who need evidence they can search, verify and share.
          </p>
        </Reveal>

        <div ref={pipeline.ref} className="relative">
          {/* Connecting line that draws itself when the section enters the viewport */}
          <div className="hidden md:block absolute top-8 left-[12.5%] right-[12.5%] h-1 rounded-full bg-sky-100 overflow-hidden">
            <div className={`h-full origin-left bg-gradient-to-r from-sky-500 via-indigo-500 to-violet-500 ${pipeline.visible ? 'animate-draw-line' : 'scale-x-0'}`} />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            {STEPS.map((s, i) => {
              const Icon = s.icon;
              return (
                <Reveal key={s.tab} delay={i * 150}>
                  <button
                    onClick={() => onNavigate(s.tab)}
                    className="group relative w-full text-left md:text-center"
                  >
                    <div className={`relative z-10 w-16 h-16 md:mx-auto rounded-2xl bg-gradient-to-br ${s.color} text-white flex items-center justify-center shadow-lg transition-all duration-500 group-hover:scale-110 group-hover:rotate-6 group-hover:shadow-xl`}>
                      <Icon className="w-7 h-7" />
                      <span className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-white text-slate-900 text-xs font-extrabold flex items-center justify-center shadow">{i + 1}</span>
                    </div>
                    <div className="mt-4 p-5 rounded-3xl bg-white/90 border border-sky-100 shadow-sm transition-all duration-300 group-hover:shadow-xl group-hover:-translate-y-1 group-hover:border-sky-300">
                      <h4 className="text-lg font-extrabold text-slate-900">{s.title}</h4>
                      <p className="mt-1.5 text-sm text-slate-600 leading-relaxed">{s.text}</p>
                      <span className="mt-3 inline-flex items-center gap-1 text-xs font-bold text-sky-700">
                        {isLoggedIn ? `Open ${s.title}` : 'Sign in to start'}
                        <ArrowRight className="w-3.5 h-3.5 transition-transform group-hover:translate-x-1" />
                      </span>
                    </div>
                  </button>
                </Reveal>
              );
            })}
          </div>
        </div>
      </section>

      {/* Buddy teaser: an animated preview conversation on an even light cream card (same tone edge to edge) */}
      <section className="max-w-5xl mx-auto px-4 pb-12">
        <Reveal>
          <div className="grid md:grid-cols-2 gap-8 items-center p-6 sm:p-10 rounded-[2rem] bg-[#fef6e0] text-slate-900 border border-amber-100 shadow-xl shadow-amber-900/5">
            <div>
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/80 border border-amber-200 text-sky-800 text-xs font-bold mb-4"><MessageCircleHeart className="w-3.5 h-3.5" /> Buddy</span>
              <h3 className="text-2xl sm:text-3xl font-extrabold leading-tight">Just ask your media library</h3>
              <p className="mt-3 text-slate-600 leading-relaxed">No filters or folder digging. Ask about dates, places, phases or what is in the photos and get the matching evidence back.</p>
              <button onClick={() => onNavigate('buddy')} className="mt-6 px-6 py-3 rounded-full bg-gradient-to-r from-sky-600 to-blue-600 text-white font-bold text-sm hover:from-sky-700 hover:to-blue-700 shadow-md shadow-sky-600/25 transition-all inline-flex items-center gap-2">
                Talk to Buddy <ArrowRight className="w-4 h-4" />
              </button>
            </div>
            <MockChat />
          </div>
        </Reveal>
      </section>
    </div>
  );
};

const MOCK = [
  { role: 'user', text: 'Which before photos from the reforestation site have GPS?' },
  { role: 'bot', text: 'I found 6 before photos in Reforestation & Canopy, all geotagged near the same hillside. 4 have matching after photos you can compare.' },
  { role: 'user', text: 'Make a donor report for that folder' },
  { role: 'bot', text: 'Done. The report covers 14 assets and links every claim back to its source photo.' },
];

/** Loops a short example conversation to preview what Buddy does (illustrative, not user data). */
const MockChat: React.FC = () => {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    const t = setTimeout(() => setShown((n) => (n >= MOCK.length + 2 ? 0 : n + 1)), shown === 0 ? 600 : 1700);
    return () => clearTimeout(t);
  }, [shown]);

  return (
    <div className="relative space-y-3 min-h-[260px]" aria-hidden="true">
      {MOCK.slice(0, Math.min(shown, MOCK.length)).map((m, i) => (
        <div key={i} className={`flex animate-fade-in ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
          <div className={`max-w-[85%] px-4 py-2.5 rounded-2xl text-sm shadow-sm ${m.role === 'user' ? 'bg-sky-600 text-white rounded-br-md' : 'bg-white text-slate-700 border border-amber-100 rounded-bl-md'}`}>
            {m.text}
          </div>
        </div>
      ))}
      {shown > 0 && shown < MOCK.length && MOCK[shown]?.role === 'bot' && (
        <div className="flex gap-1 px-4 py-3 w-fit rounded-2xl bg-white border border-amber-100">
          {[0, 1, 2].map((d) => <span key={d} className="w-1.5 h-1.5 rounded-full bg-sky-500 animate-bounce" style={{ animationDelay: `${d * 150}ms` }} />)}
        </div>
      )}
    </div>
  );
};
