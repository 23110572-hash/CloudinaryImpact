"use client";

import React, { useEffect, useRef } from "react";

/**
 * Serene Light Blue Volumetric Cloud Engine
 * - Pure, refreshing light blue sky palette (zero dark blue / zero harsh blurs)
 * - Organic cumulus cloud clusters with horizontal aerodynamic stretching
 * - 60 FPS continuous wind drift with vertical harmonic breathing
 * - Full-bleed coverage with zero top/bottom gaps
 */
export function ShaderBackground({ className }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) return;

    let rafId = 0;
    let disposed = false;
    const startTime = performance.now();

    // Mouse coordinates (normalized 0..1) with spring easing
    const mouse = { x: 0.5, y: 0.5, targetX: 0.5, targetY: 0.5 };

    const handleMouseMove = (e: MouseEvent) => {
      mouse.targetX = e.clientX / window.innerWidth;
      mouse.targetY = e.clientY / window.innerHeight;
    };
    window.addEventListener("mousemove", handleMouseMove, { passive: true });

    // Compound Cloud Formation definition
    interface CloudCluster {
      xRatio: number;      // 0..1 relative horizontal position
      yRatio: number;      // 0..1 relative vertical position
      scale: number;       // cluster size scale
      speedX: number;      // horizontal wind speed
      waveAmp: number;     // vertical wave amplitude in px
      waveFreq: number;    // vertical oscillation frequency
      phase: number;       // initial phase
      subPuffs: {
        dx: number;        // relative x offset in cluster
        dy: number;        // relative y offset in cluster
        radius: number;    // puff radius in px
        colorStop0: string;// center color
        colorStop1: string;// outer transparent color
      }[];
    }

    const clusters: CloudCluster[] = [];

    // Light Blue & Soft White Cloud Color Palette
    const lightPuffPalette = [
      // Center: luminous airy white with subtle sky-tint
      { c0: "rgba(255, 255, 255, 0.75)", c1: "rgba(255, 255, 255, 0)" },
      // Center: gentle powder blue
      { c0: "rgba(215, 240, 255, 0.65)", c1: "rgba(195, 232, 255, 0)" },
      // Center: soft sky azure
      { c0: "rgba(175, 222, 255, 0.55)", c1: "rgba(155, 215, 255, 0)" },
      // Center: ethereal light cyan vapor
      { c0: "rgba(190, 230, 255, 0.60)", c1: "rgba(180, 225, 255, 0)" },
      // Highlight: pure white cloud crest
      { c0: "rgba(255, 255, 255, 0.85)", c1: "rgba(255, 255, 255, 0)" },
    ];

    // Generate 14 organic cumulus cloud clusters distributed across the sky
    for (let i = 0; i < 14; i++) {
      const subPuffs: CloudCluster["subPuffs"] = [];
      const puffCount = 5 + Math.floor(Math.random() * 4); // 5-8 overlapping puffs per cloud
      const baseRadius = 90 + Math.random() * 70;

      for (let j = 0; j < puffCount; j++) {
        const pal = lightPuffPalette[(i + j) % lightPuffPalette.length];
        subPuffs.push({
          dx: (j - puffCount / 2) * (baseRadius * 0.55) + (Math.random() - 0.5) * 25,
          dy: (Math.random() - 0.5) * (baseRadius * 0.45),
          radius: baseRadius * (0.8 + Math.random() * 0.5),
          colorStop0: pal.c0,
          colorStop1: pal.c1,
        });
      }

      clusters.push({
        xRatio: (i / 14) + (Math.random() - 0.5) * 0.08,
        yRatio: 0.12 + Math.random() * 0.68,
        scale: 0.85 + Math.random() * 0.45,
        speedX: 0.00030 + Math.random() * 0.00025, // Gentle natural drift
        waveAmp: 16 + Math.random() * 18,
        waveFreq: 0.35 + Math.random() * 0.3,
        phase: Math.random() * Math.PI * 2,
        subPuffs,
      });
    }

    const render = () => {
      if (disposed || !canvas || !ctx) return;

      const w = (canvas.width = Math.max(1, window.innerWidth));
      const h = (canvas.height = Math.max(1, window.innerHeight));

      // Smooth mouse easing
      mouse.x += (mouse.targetX - mouse.x) * 0.04;
      mouse.y += (mouse.targetY - mouse.y) * 0.04;

      const elapsed = (performance.now() - startTime) / 1000;

      // 1. Serene Light Blue Sky Gradient (Zero dark blue tones)
      const skyGrad = ctx.createLinearGradient(0, 0, 0, h);
      skyGrad.addColorStop(0.0, "#b8e3fe"); // Crisp, bright light azure
      skyGrad.addColorStop(0.35, "#cfecfe"); // Luminous soft sky blue
      skyGrad.addColorStop(0.70, "#e3f4fe"); // Delicate morning blue
      skyGrad.addColorStop(1.0, "#f3f9ff"); // Pure airy horizon
      ctx.fillStyle = skyGrad;
      ctx.fillRect(0, 0, w, h);

      // Helper function to render a single cloud cluster
      const drawCluster = (cx: number, cy: number, cluster: CloudCluster, breatheScale: number) => {
        for (const p of cluster.subPuffs) {
          const px = cx + p.dx * cluster.scale * breatheScale;
          const py = cy + p.dy * cluster.scale * breatheScale;
          const r = p.radius * cluster.scale * breatheScale;

          // Render soft horizontal cumulus ellipse (1.35x width)
          ctx.save();
          ctx.translate(px, py);
          ctx.scale(1.35, 1.0);

          const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
          grad.addColorStop(0.0, p.colorStop0);
          grad.addColorStop(0.55, p.colorStop0);
          grad.addColorStop(1.0, p.colorStop1);

          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.arc(0, 0, r, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
      };

      // 2. Render Drifting Light Blue Cloud Clusters
      for (const cl of clusters) {
        // Continuous horizontal wind drift (seamless 0..1 wrap)
        cl.xRatio = (cl.xRatio + cl.speedX) % 1.0;

        const baseX = cl.xRatio * w;
        const baseY = cl.yRatio * h;

        // Vertical harmonic wave motion for organic billowing
        const wave = Math.sin(elapsed * cl.waveFreq + cl.phase) * cl.waveAmp;

        // Interactive mouse response (clouds part and shift gently)
        const dx = (baseX / w) - mouse.x;
        const dy = (baseY / h) - mouse.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const repel = Math.max(0, 1.0 - dist / 0.45) * 32;

        const posX = baseX + dx * repel;
        const posY = baseY + wave + dy * repel;

        // Subtle breathing scale
        const breathe = 1.0 + 0.05 * Math.sin(elapsed * 0.7 + cl.phase);

        // Draw primary cluster
        drawCluster(posX, posY, cl, breathe);

        // Wrap around boundaries seamlessly to eliminate edge pop-in
        const clusterSpan = 280 * cl.scale;
        if (posX - clusterSpan < 0) {
          drawCluster(posX + w, posY, cl, breathe);
        } else if (posX + clusterSpan > w) {
          drawCluster(posX - w, posY, cl, breathe);
        }
      }

      rafId = requestAnimationFrame(render);
    };

    rafId = requestAnimationFrame(render);

    const handleResize = () => {
      if (canvas) {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
      }
    };
    window.addEventListener("resize", handleResize);

    return () => {
      disposed = true;
      cancelAnimationFrame(rafId);
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("resize", handleResize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={{
        display: "block",
        width: "100%",
        height: "100%",
        position: "absolute",
        top: 0,
        left: 0,
      }}
    />
  );
}
