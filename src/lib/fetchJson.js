// Client-side only. Wraps fetch() for the large /data/*.json payloads with one retry,
// since a bare fetch().then(r => r.json()) with no error handling leaves the page stuck
// on a transient network hiccup until the user manually reloads.
export async function fetchJsonWithRetry(url, { retries = 1, retryDelayMs = 800 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url);
      // A 404 means the file genuinely doesn't exist - retrying won't change that, unlike a
      // transient network error or a 5xx, which might, so don't waste a delay or a duplicate
      // request on it.
      if (res.status === 404) throw Object.assign(new Error(`${url} -> HTTP 404`), { permanent: true });
      if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      lastErr = err;
      if (err.permanent) break;
      if (attempt < retries) await new Promise((r) => setTimeout(r, retryDelayMs));
    }
  }
  throw lastErr;
}
