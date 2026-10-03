import { useEffect } from 'react';

/** Reflect actual webview focus without requesting focus or changing window input. */
export function useOverlayPanelFocus(): void {
  useEffect(() => {
    const update = () => {
      document.documentElement.dataset.wokOverlayFocused = document.hasFocus() ? '1' : '0';
    };
    const focused = () => { document.documentElement.dataset.wokOverlayFocused = '1'; };
    const blurred = () => { document.documentElement.dataset.wokOverlayFocused = '0'; };
    update();
    window.addEventListener('focus', focused);
    window.addEventListener('blur', blurred);
    return () => {
      window.removeEventListener('focus', focused);
      window.removeEventListener('blur', blurred);
      delete document.documentElement.dataset.wokOverlayFocused;
    };
  }, []);
}
