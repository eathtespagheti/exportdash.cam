'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useConfig } from '@/components/ConfigProvider';

interface LibraryEvent {
  id: string;
  folderPath: string;
  title: string;
  date: string;
  thumbUrl: string | null;
  videoCount: number;
}

export default function LibraryClipsPage() {
  const { enableLibraryReview } = useConfig();

  const [events, setEvents] = useState<LibraryEvent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!enableLibraryReview) {
      setIsLoading(false);
      return;
    }

    fetch('/api/events')
      .then(res => res.json())
      .then(data => {
        if (data.error) throw new Error(data.error);
        setEvents(data.events || []);
      })
      .catch(err => setError(err.message))
      .finally(() => setIsLoading(false));
  }, [enableLibraryReview]);

  if (!enableLibraryReview) {
    return (
      <div className="min-h-screen bg-gray-950 text-white flex items-center justify-center p-8">
        <div className="text-center max-w-md">
          <h1 className="text-3xl font-bold mb-4">Library Disabled</h1>
          <p className="text-gray-400 mb-8">The library review feature is currently disabled. Enable NEXT_PUBLIC_ENABLE_LIBRARY_REVIEW to use this feature.</p>
          <Link href="/" className="px-6 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors inline-block">
            Back to Home
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-950 text-white p-8">
      <div className="max-w-6xl mx-auto">
        <div className="flex justify-between items-center mb-8">
          <h1 className="text-3xl font-bold">Library Clips</h1>
          <Link href="/" className="px-4 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg transition-colors">
            Back to Home
          </Link>
        </div>

        {isLoading ? (
          <div className="text-center py-20 text-gray-400">Loading clips...</div>
        ) : error ? (
          <div className="text-center py-20 text-red-400">Error: {error}</div>
        ) : events.length === 0 ? (
          <div className="text-center py-20 text-gray-400">No clips found in the library. Make sure LIBRARY_CLIPS_PATH is configured correctly.</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {events.map(event => (
              <Link key={event.id} href={`/?folder=${encodeURIComponent(event.folderPath)}`} className="bg-gray-900 rounded-xl overflow-hidden border border-gray-800 hover:border-blue-500 transition-colors group block">
                <div className="aspect-video bg-gray-800 relative overflow-hidden">
                  {event.thumbUrl ? (
                    <img src={event.thumbUrl} alt={event.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-gray-600">
                      No Preview
                    </div>
                  )}
                  <div className="absolute bottom-2 right-2 bg-black/80 px-2 py-1 rounded text-xs font-medium">
                    {event.videoCount} clips
                  </div>
                </div>
                <div className="p-4">
                  <h3 className="font-semibold text-lg truncate" title={event.title}>{event.title}</h3>
                  <p className="text-sm text-gray-400 mt-1">{event.date || 'Unknown Date'}</p>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
