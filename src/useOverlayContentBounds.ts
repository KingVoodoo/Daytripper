import { useEffect, useRef } from 'react';
import { getCurrentWindow, LogicalSize } from '@tauri-apps/api/window';
import { native } from './bridge';

/** Measure intrinsic content, never viewport-sized content, to avoid resize loops. */
export function useOverlayContentBounds(enabled = true) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = ref.current;
    if (!enabled || !native || !element) return;
    let frame = 0;
    let previous = '';
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const rect = element.getBoundingClientRect();
        const width = Math.max(40, Math.ceil(rect.right), Math.ceil(element.scrollWidth * (Number.parseFloat(getComputedStyle(document.documentElement).zoom) || 1) + rect.left));
        const height = Math.max(40, Math.ceil(rect.bottom), Math.ceil(element.scrollHeight * (Number.parseFloat(getComputedStyle(document.documentElement).zoom) || 1) + rect.top));
        const key = `${width}:${height}`;
        if (previous === key) return;
        previous = key;
        void getCurrentWindow().setSize(new LogicalSize(width, height)).catch(() => { previous = ''; });
      });
    };
    const observer = new ResizeObserver(measure);
    observer.observe(element, { box: 'border-box' });
    document.fonts.addEventListener('loadingdone', measure);
    window.addEventListener('wok-overlay-scale-changed', measure);
    measure();
    return () => {
      observer.disconnect();
      document.fonts.removeEventListener('loadingdone', measure);
      window.removeEventListener('wok-overlay-scale-changed', measure);
      cancelAnimationFrame(frame);
    };
  }, [enabled]);
  return ref;
}
