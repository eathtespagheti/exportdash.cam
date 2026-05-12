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

    // 2. Fetch and cache
    const response = await fetch(url);
    if (!response.ok) return url;
    
    // Put a clone in cache
    await cache.put(url, response.clone());
    
    // Manage cache size asynchronously
    enforceCacheLimit(limitBytes).catch(console.error);
    
    const blob = await response.blob();
    return URL.createObjectURL(blob);
  } catch (err) {
    console.warn('Failed to cache video:', err);
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
