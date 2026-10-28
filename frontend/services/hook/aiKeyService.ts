export const aiKeyService = {
  /**
   * Validates an API key by attempting to reach the public models endpoint.
   * Uses:
   * - GET https://generativelanguage.googleapis.com/v1beta/models?key=YOUR_KEY
   *
   * Note: This is a browser-side check and may fail due to CORS/network policy.
   */
  testGeminiKey: async (apiKey: string): Promise<{ method: 'query' }> => {
    const key = (apiKey || '').trim();
    if (!key) throw new Error('Missing API key');

    const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`;
    const res = await fetch(url, { method: 'GET' });
    if (res.ok) return { method: 'query' };

    const errorBody: any = await res.json().catch(() => null);
    const apiMessage =
      errorBody?.error?.message ||
      errorBody?.message ||
      undefined;
    throw new Error((apiMessage || `HTTP ${res.status} ${res.statusText}`).trim());
  }
};
