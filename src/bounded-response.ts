/** Read decoded fetch bytes within a hard limit before materializing JSON. */
export async function readBoundedJson(response: Response, maxBytes = 2_000_000): Promise<any> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) throw new Error('Invalid response budget.');
  const declared = response.headers.get('content-length');
  if (declared && Number(declared) > maxBytes) throw new Error(`HTTP ${response.status}: response exceeds its size limit.`);
  const reader = response.body?.getReader();
  if (!reader) throw new Error(`HTTP ${response.status}: response body is unavailable.`);
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let bytes = 0, text = '';
  try {
    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      if (value.byteLength > maxBytes - bytes) throw new Error(`HTTP ${response.status}: response exceeds its size limit.`);
      bytes += value.byteLength;
      text += decoder.decode(value, {stream: true});
    }
    text += decoder.decode();
    return JSON.parse(text);
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally { reader.releaseLock(); }
}
