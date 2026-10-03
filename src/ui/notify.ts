/**
 * Host-side toast / notification bridge.
 * Prefers the React shell API (`window.__wokNotify`); falls back to DOM toasts
 * when running in a standalone popout without the Workspace shell.
 */
export type ToastKind = 'info' | 'success' | 'warning' | 'error';

export interface ShowToastOptions {
  kind?: ToastKind;
  durationMs?: number;
}

export interface NotifyOptions {
  title: string;
  body?: string;
  kind?: ToastKind;
  source?: string;
  tag?: string;
  toast?: boolean;
  toastDurationMs?: number;
}

type ShellApi = {
  showToast: (message: string, options?: ShowToastOptions | ToastKind | boolean) => string;
  notify: (options: NotifyOptions) => string;
};

function shellApi(): ShellApi | null {
  if (typeof window === 'undefined') return null;
  const api = (window as unknown as { __wokNotify?: ShellApi }).__wokNotify;
  if (!api || typeof api.showToast !== 'function') return null;
  return api;
}

function normalizeKind(input?: ShowToastOptions | ToastKind | boolean): ToastKind {
  if (input === true) return 'error';
  if (input === false || input == null) return 'info';
  if (typeof input === 'string') return input;
  return input.kind ?? 'info';
}

function normalizeDuration(input?: ShowToastOptions | ToastKind | boolean): number {
  if (input && typeof input === 'object' && typeof input.durationMs === 'number') {
    return Math.max(1200, input.durationMs);
  }
  return 4200;
}

function domToast(message: string, kind: ToastKind, durationMs: number): void {
  const existing = document.querySelectorAll('.wok-toast, .wok-shell-toast-fallback');
  if (existing.length > 4) existing[0]?.remove();

  const toast = document.createElement('div');
  toast.className = `wok-toast wok-toast-${kind} wok-shell-toast-fallback`;
  toast.setAttribute('role', kind === 'error' || kind === 'warning' ? 'alert' : 'status');
  toast.textContent = message;
  document.body.append(toast);
  requestAnimationFrame(() => toast.classList.add('wok-toast-show'));
  window.setTimeout(() => {
    toast.classList.remove('wok-toast-show');
    window.setTimeout(() => toast.remove(), 280);
  }, durationMs);
}

/**
 * Ephemeral toast. Pass `true` as the second arg for error (legacy map/item helpers).
 *
 * @example
 * showToast('Fit saved');
 * showToast('Sync failed', true);
 * showToast('Copied', 'success');
 * showToast('Still downloading…', { kind: 'info', durationMs: 6000 });
 */
export function showToast(
  message: string,
  options?: ShowToastOptions | ToastKind | boolean,
): string {
  const text = String(message || '').trim();
  if (!text) return '';
  const api = shellApi();
  if (api) return api.showToast(text, options);
  domToast(text, normalizeKind(options), normalizeDuration(options));
  return '';
}

/**
 * Persistent inbox notification (bell). Also shows a toast unless `toast: false`.
 *
 * @example
 * notify({ title: 'Update available', body: 'v0.3.3 ready', kind: 'info', source: 'Updater', tag: 'update:available' });
 */
export function notify(options: NotifyOptions): string {
  const title = String(options.title || '').trim();
  if (!title) return '';
  const api = shellApi();
  if (api) return api.notify(options);

  if (options.toast !== false) {
    const msg = options.body ? `${title} — ${options.body}` : title;
    showToast(msg, { kind: options.kind ?? 'info', durationMs: options.toastDurationMs });
  }
  return '';
}
