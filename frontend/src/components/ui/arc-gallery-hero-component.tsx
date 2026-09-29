import React, { useEffect, useState } from 'react';
import { ArrowUpRight, Sparkles, FolderTree } from 'lucide-react';

export type ArcGalleryHeroProps = {
  images: string[];
  startAngle?: number;
  endAngle?: number;
  radiusLg?: number;
  radiusMd?: number;
  radiusSm?: number;
  cardSizeLg?: number;
  cardSizeMd?: number;
  cardSizeSm?: number;
  className?: string;
  onExploreClick?: () => void;
  onUploadClick?: () => void;
};

const ROTATING_WORDS = ['images', 'field evidence', 'impact stories', 'reports'];

export const ArcGalleryHero: React.FC<ArcGalleryHeroProps> = ({
  images,
  startAngle = 18,
  endAngle = 162,
  radiusLg = 490,
  radiusMd = 370,
  radiusSm = 250,
  cardSizeLg = 125,
  cardSizeMd = 100,
  cardSizeSm = 75,
  className = '',
  onExploreClick,
  onUploadClick,
}) => {
  const [dimensions, setDimensions] = useState({
    radius: radiusLg,
    cardSize: cardSizeLg,
  });

  useEffect(() => {
    const handleResize = () => {
      const width = window.innerWidth;
      if (width < 640) {
        setDimensions({ radius: radiusSm, cardSize: cardSizeSm });
      } else if (width < 1024) {
        setDimensions({ radius: radiusMd, cardSize: cardSizeMd });
      } else {
        setDimensions({ radius: radiusLg, cardSize: cardSizeLg });
      }
    };

    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [radiusLg, radiusMd, radiusSm, cardSizeLg, cardSizeMd, cardSizeSm]);

  const [wordIdx, setWordIdx] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setWordIdx((i) => (i + 1) % ROTATING_WORDS.length), 2600);
    return () => clearInterval(t);
  }, []);

  const count = Math.max(images.length, 2);
  const step = (endAngle - startAngle) / (count - 1);

  return (
    <section className={`relative overflow-hidden min-h-[90vh] flex flex-col justify-start pt-6 pb-16 ${className}`}>
      {/* Background Ring Arc Container */}
      <div
        className="relative z-10 mx-auto w-full select-none"
        style={{
          height: dimensions.radius * 1.15,
        }}
      >
        {/* Pivot at bottom center */}
        <div className="absolute left-1/2 bottom-0 -translate-x-1/2">
          {images.map((src, i) => {
            const angle = startAngle + step * i;
            const angleRad = (angle * Math.PI) / 180;
            const x = Math.cos(angleRad) * dimensions.radius;
            const y = Math.sin(angleRad) * dimensions.radius;

            return (
              <div
                key={i}
                className="absolute opacity-0 animate-fade-in-up transition-all duration-300 group cursor-pointer"
                style={{
                  width: dimensions.cardSize,
                  height: dimensions.cardSize,
                  left: `calc(50% + ${x}px)`,
                  bottom: `${y}px`,
                  transform: `translate(-50%, 50%)`,
                  animationDelay: `${i * 70}ms`,
                  animationFillMode: 'forwards',
                  zIndex: count - i,
                }}
              >
                {/* Separate wrapper so the idle float doesn't fight the positioning/rotation transforms */}
                <div
                  className="w-full h-full animate-float"
                  style={{ animationDelay: `${(i % 6) * -0.8}s`, animationDuration: `${4.5 + (i % 4) * 0.6}s` }}
                >
                <div
                  className="relative rounded-2xl shadow-xl shadow-sky-950/10 overflow-hidden ring-2 ring-white/90 bg-white/95 transition-all duration-500 group-hover:scale-110 group-hover:shadow-2xl group-hover:shadow-sky-500/30 group-hover:ring-sky-400 w-full h-full"
                  style={{ transform: `rotate(${angle / 4}deg)` }}
                >
                  <img
                    src={src}
                    alt={`Field Asset ${i + 1}`}
                    className="block w-full h-full object-cover"
                    draggable={false}
                    loading="eager"
                    onError={(e) => {
                      (e.target as HTMLImageElement).src = `https://cdn.21st.dev/assets/mirror/43/43787263c53801c9064e1f3209488a5f4bd83986c0bb01223176c57bb99f959b.svg`;
                    }}
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-slate-900/30 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Hero Typography & CTA positioned below the Arc */}
      <div className="relative z-10 flex-1 flex items-center justify-center px-4 -mt-24 sm:-mt-36 md:-mt-44 lg:-mt-52">
        <div
          className="text-center max-w-3xl px-4 opacity-0 animate-fade-in"
          style={{ animationDelay: '500ms', animationFillMode: 'forwards' }}
        >
          {/* Status Badge */}
          <div className="inline-flex items-center px-4 py-1.5 rounded-full bg-white/80 backdrop-blur-md border border-sky-300/70 text-sky-800 text-sm font-bold mb-6 shadow-sm">
            <span>Turn field photos into proof of impact</span>
          </div>

          {/* User Requested Tagline: Workplace for all your images */}
          <h1 className="text-4xl sm:text-6xl lg:text-7xl font-extrabold tracking-tight text-slate-900 leading-[1.12]">
            Workplace for all your{' '}
            <span className="inline-block [perspective:600px]" aria-live="polite">
              <span
                key={wordIdx}
                className="inline-block animate-word-in bg-gradient-to-r from-sky-600 via-blue-600 to-indigo-600 bg-[length:200%_auto] bg-clip-text text-transparent"
              >
                {ROTATING_WORDS[wordIdx]}
              </span>
            </span>
          </h1>

          {/* User Requested Subtitle */}
          <p className="mt-5 text-xl sm:text-2xl text-slate-700 font-semibold max-w-2xl mx-auto leading-relaxed">
            Drop all your images here, we will organise for you with AI-driven signals, verification, and instant impact reporting.
          </p>

          {/* Action Buttons */}
          <div className="mt-9 flex flex-col sm:flex-row items-center justify-center gap-4">
            <button
              onClick={onUploadClick}
              className="group w-full sm:w-auto px-8 py-4 rounded-full bg-gradient-to-r from-sky-600 to-blue-600 text-white font-bold text-lg hover:from-sky-700 hover:to-blue-700 transition-all duration-200 shadow-lg shadow-sky-600/25 hover:shadow-xl hover:shadow-sky-600/35 transform hover:-translate-y-0.5 flex items-center justify-center gap-2.5"
            >
              <Sparkles className="w-5 h-5" />
              <span>Drop Images &amp; Organize</span>
              <ArrowUpRight className="w-5 h-5 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
            </button>
            <button
              onClick={onExploreClick}
              className="w-full sm:w-auto px-8 py-4 rounded-full border-2 border-sky-300/80 bg-white/90 hover:bg-sky-50 text-slate-800 font-bold text-lg transition-all duration-200 shadow-sm flex items-center justify-center gap-2"
            >
              <FolderTree className="w-5 h-5 text-sky-600" />
              <span>Open Media Library</span>
            </button>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes fade-in-up {
          from {
            opacity: 0;
            transform: translate(-50%, 65%);
          }
          to {
            opacity: 1;
            transform: translate(-50%, 50%);
          }
        }
        @keyframes fade-in {
          from {
            opacity: 0;
            transform: translateY(14px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        .animate-fade-in-up {
          animation: fade-in-up 0.85s cubic-bezier(0.16, 1, 0.3, 1);
        }
        .animate-fade-in {
          animation: fade-in 0.8s ease-out;
        }
      `}</style>
    </section>
  );
};
