const CACHE_NAME = 'exportdash-clips';

export async function getCachedVideoUrl(url: string, limitBytes: number): Promise<string> {
  if (typeof window === 'undefined' || !('caches' in window)) return url;
  if (limitBytes <= 0) return url;

  try {
    const cache = await caches.open(CACHE_NAME);
    
    // 1. Check if already in cache
    const cachedResponse = await cache.match(url);
    if (cachedResponse) {
      const blob = await cachedResponse.blob();
      return URL.createObjectURL(blob);
    }

    // 2. If not in cache, trigger background fetch and cache, but return original URL immediately for streaming
    fetch(url).then(async (response) => {
      if (response.ok) {
        await cache.put(url, response.clone());
        enforceCacheLimit(limitBytes).catch(console.error);
      }
    }).catch(err => {
      console.warn('Background cache fetch failed:', err);
    });
    
    return url;
  } catch (err) {
    console.warn('Failed to interact with cache:', err);
    return url; // fallback to original URL
  }
}

async function enforceCacheLimit(limitBytes: number) {
  if (typeof caches === 'undefined') return;
  const cache = await caches.open(CACHE_NAME);
  const keys = await cache.keys();
  
  let totalSize = 0;
  const entries: { request: Request, size: number }[] = [];
  
  for (const req of keys) {
    const res = await cache.match(req);
    if (res) {
      const size = Number(res.headers.get('content-length')) || 0;
      entries.push({ request: req, size });
      totalSize += size;
    }
  }
  
  // If over limit, delete oldest (first keys)
  if (totalSize > limitBytes) {
    let currentSize = totalSize;
    for (const entry of entries) {
      if (currentSize <= limitBytes) break;
      await cache.delete(entry.request);
      currentSize -= entry.size;
    }
  }
}

export async function clearVideoCache() {
  if (typeof caches !== 'undefined') {
    await caches.delete(CACHE_NAME);
  }
}

export async function getVideoCacheSize(): Promise<number> {
  if (typeof window === 'undefined' || !('caches' in window)) return 0;
  const cache = await caches.open(CACHE_NAME);
  const keys = await cache.keys();
  let totalSize = 0;
  for (const req of keys) {
    const res = await cache.match(req);
    if (res) {
      totalSize += Number(res.headers.get('content-length')) || 0;
    }
  }
  return totalSize;
}
