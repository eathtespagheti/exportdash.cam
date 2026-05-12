'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { useConfig } from '@/components/ConfigProvider';

interface LibraryEvent {
  id: string;
  folderPath: string;
  title: string;
  date: string;
  timestamp: string | null;
  thumbUrl: string | null;
  videoCount: number;
  type: string;
  reason: string;
  reasonLabel: string;
  city: string;
  camera: string;
}

const CAMERA_MAP: Record<string, string> = {
  '0': 'Front',
  '5': 'Left Repeater',
  '6': 'Right Repeater',
  '7': 'Rear',
};

function getCameraLabel(cameraId: string) {
  if (!cameraId) return 'Unknown';
  return CAMERA_MAP[cameraId] || `Camera ${cameraId}`;
}

function getTimeOfDay(date: Date) {
  const hours = date.getHours();
  if (hours >= 5 && hours < 12) return 'Morning';
  if (hours >= 12 && hours < 17) return 'Afternoon';
  if (hours >= 17 && hours < 21) return 'Evening';
  return 'Night';
}

export default function LibraryClipsPage() {
  const { enableLibraryReview } = useConfig();

  const [events, setEvents] = useState<LibraryEvent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  // Filters
  const [filterType, setFilterType] = useState<string>('');
  const [filterReason, setFilterReason] = useState<string>('');
  const [filterCity, setFilterCity] = useState<string>('');
  const [filterCamera, setFilterCamera] = useState<string>('');
  const [filterTimeRange, setFilterTimeRange] = useState<string>('');
  const [filterDateFrom, setFilterDateFrom] = useState<string>('');
  const [filterDateTo, setFilterDateTo] = useState<string>('');

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

  // Derived filter options
  const filterOptions = useMemo(() => {
    const types = new Set<string>();
    const reasons = new Set<string>();
    const cities = new Set<string>();
    const cameras = new Set<string>();

    events.forEach(event => {
      if (event.type) types.add(event.type);
      if (event.reasonLabel) reasons.add(event.reasonLabel);
      if (event.city) cities.add(event.city);
      if (event.camera) cameras.add(event.camera);
    });

    return {
      types: Array.from(types).sort(),
      reasons: Array.from(reasons).sort(),
      cities: Array.from(cities).sort(),
      cameras: Array.from(cameras).sort()
    };
  }, [events]);

  // Filtered and grouped events
  const groupedEvents = useMemo(() => {
    const filtered = events.filter(event => {
      if (filterType && event.type !== filterType) return false;
      if (filterReason && event.reasonLabel !== filterReason) return false;
      if (filterCity && event.city !== filterCity) return false;
      if (filterCamera && event.camera !== filterCamera) return false;

      const eventDate = event.timestamp ? new Date(event.timestamp) : null;
      
      if (filterTimeRange && eventDate) {
        if (getTimeOfDay(eventDate) !== filterTimeRange) return false;
      }

      if (eventDate) {
        // YYYY-MM-DD
        const eventDateStr = eventDate.toISOString().split('T')[0];
        if (filterDateFrom && eventDateStr < filterDateFrom) return false;
        if (filterDateTo && eventDateStr > filterDateTo) return false;
      }

      return true;
    });

    // Group by date
    const groups: Record<string, LibraryEvent[]> = {};
    
    filtered.forEach(event => {
      let dateKey = 'Unknown Date';
      if (event.timestamp) {
        const d = new Date(event.timestamp);
        if (!isNaN(d.getTime())) {
          dateKey = d.toLocaleDateString(undefined, {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric'
          });
        }
      }
      
      if (!groups[dateKey]) {
        groups[dateKey] = [];
      }
      groups[dateKey].push(event);
    });

    // Sort groups (we assume the events array is already sorted descending, so we just maintain that order or sort the keys)
    // Keys format makes them hard to sort alphabetically, so let's get the timestamp of the first event in each group
    const sortedGroups = Object.entries(groups).sort((a, b) => {
      if (a[0] === 'Unknown Date') return 1;
      if (b[0] === 'Unknown Date') return -1;
      
      const timeA = a[1][0].timestamp ? new Date(a[1][0].timestamp).getTime() : 0;
      const timeB = b[1][0].timestamp ? new Date(b[1][0].timestamp).getTime() : 0;
      return timeB - timeA;
    });

    return sortedGroups;
  }, [events, filterType, filterReason, filterCity, filterCamera, filterTimeRange, filterDateFrom, filterDateTo]);

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
    <div className="min-h-screen bg-gray-950 text-white flex flex-col md:flex-row">
      {/* Sidebar Filters */}
      <div className="w-full md:w-64 bg-gray-900 border-r border-gray-800 p-6 flex-shrink-0 flex flex-col gap-6 overflow-y-auto hidden md:flex h-screen sticky top-0">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold">Filters</h2>
          <button 
            onClick={() => {
              setFilterType('');
              setFilterReason('');
              setFilterCity('');
              setFilterCamera('');
              setFilterTimeRange('');
              setFilterDateFrom('');
              setFilterDateTo('');
            }}
            className="text-sm text-blue-400 hover:text-blue-300 transition-colors"
          >
            Clear all
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-400 mb-1">Type</label>
            <select 
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
              value={filterType}
              onChange={(e) => setFilterType(e.target.value)}
            >
              <option value="">All Types</option>
              {filterOptions.types.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-400 mb-1">Reason</label>
            <select 
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
              value={filterReason}
              onChange={(e) => setFilterReason(e.target.value)}
            >
              <option value="">All Reasons</option>
              {filterOptions.reasons.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-400 mb-1">City</label>
            <select 
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
              value={filterCity}
              onChange={(e) => setFilterCity(e.target.value)}
            >
              <option value="">All Cities</option>
              {filterOptions.cities.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-400 mb-1">Camera</label>
            <select 
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
              value={filterCamera}
              onChange={(e) => setFilterCamera(e.target.value)}
            >
              <option value="">All Cameras</option>
              {filterOptions.cameras.map(c => <option key={c} value={c}>{getCameraLabel(c)}</option>)}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-400 mb-1">Time of Day</label>
            <select 
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
              value={filterTimeRange}
              onChange={(e) => setFilterTimeRange(e.target.value)}
            >
              <option value="">Any Time</option>
              <option value="Morning">Morning (5am - 12pm)</option>
              <option value="Afternoon">Afternoon (12pm - 5pm)</option>
              <option value="Evening">Evening (5pm - 9pm)</option>
              <option value="Night">Night (9pm - 5am)</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-400 mb-1">Date From</label>
            <input 
              type="date"
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
              value={filterDateFrom}
              onChange={(e) => setFilterDateFrom(e.target.value)}
              style={{ colorScheme: 'dark' }}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-400 mb-1">Date To</label>
            <input 
              type="date"
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
              value={filterDateTo}
              onChange={(e) => setFilterDateTo(e.target.value)}
              style={{ colorScheme: 'dark' }}
            />
          </div>
        </div>
        
        <div className="mt-auto pt-6 pb-2">
          <Link href="/" className="w-full flex items-center justify-center px-4 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg transition-colors text-sm font-medium">
            Back to App
          </Link>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 p-8 overflow-y-auto h-screen">
        <div className="max-w-6xl mx-auto">
          {/* Mobile Header */}
          <div className="flex md:hidden justify-between items-center mb-8">
            <h1 className="text-3xl font-bold">Library</h1>
            <Link href="/" className="px-4 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg transition-colors text-sm">
              Back
            </Link>
          </div>

          <div className="hidden md:block mb-8">
            <h1 className="text-3xl font-bold">Library</h1>
          </div>

          {/* Mobile Filters (simplified for space) */}
          <div className="md:hidden mb-8 flex flex-wrap gap-2">
             <select 
              className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm"
              value={filterType}
              onChange={(e) => setFilterType(e.target.value)}
            >
              <option value="">All Types</option>
              {filterOptions.types.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
            <select 
              className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm"
              value={filterReason}
              onChange={(e) => setFilterReason(e.target.value)}
            >
              <option value="">All Reasons</option>
              {filterOptions.reasons.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
            <select 
              className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm"
              value={filterTimeRange}
              onChange={(e) => setFilterTimeRange(e.target.value)}
            >
              <option value="">Any Time</option>
              <option value="Morning">Morning</option>
              <option value="Afternoon">Afternoon</option>
              <option value="Evening">Evening</option>
              <option value="Night">Night</option>
            </select>
          </div>

          {isLoading ? (
            <div className="text-center py-20 text-gray-400">Loading clips...</div>
          ) : error ? (
            <div className="text-center py-20 text-red-400">Error: {error}</div>
          ) : groupedEvents.length === 0 ? (
            <div className="text-center py-20 text-gray-400">
              {events.length === 0 ? 'No clips found in the library. Make sure LIBRARY_CLIPS_PATH is configured correctly.' : 'No clips match the selected filters.'}
            </div>
          ) : (
            <div className="space-y-12 pb-12">
              {groupedEvents.map(([dateKey, dateEvents]) => (
                <div key={dateKey}>
                  <h2 className="text-xl font-semibold mb-4 text-gray-200 sticky top-0 bg-gray-950/90 backdrop-blur-sm py-2 z-10 border-b border-gray-800/50">
                    {dateKey}
                    <span className="text-sm font-normal text-gray-500 ml-3">{dateEvents.length} clips</span>
                  </h2>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                    {dateEvents.map(event => {
                      const eventTime = event.timestamp ? new Date(event.timestamp).toLocaleTimeString(undefined, { timeStyle: 'short' }) : '';
                      return (
                        <Link key={event.id} href={`/?folder=${encodeURIComponent(event.folderPath)}`} className="bg-gray-900 rounded-xl overflow-hidden border border-gray-800 hover:border-blue-500 transition-colors group block relative">
                          <div className="aspect-video bg-gray-800 relative overflow-hidden">
                            {event.thumbUrl ? (
                              <img src={event.thumbUrl} alt={event.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center text-gray-600">
                                No Preview
                              </div>
                            )}
                            
                            {/* Tags overlay */}
                            <div className="absolute top-2 left-2 flex flex-col gap-1">
                              {event.type && (
                                <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${event.type === 'Sentry' ? 'bg-red-500/80 text-white' : 'bg-blue-500/80 text-white'}`}>
                                  {event.type}
                                </span>
                              )}
                            </div>

                            <div className="absolute bottom-2 right-2 flex items-center gap-1">
                              <span className="bg-black/80 px-2 py-1 rounded text-xs font-medium">
                                {event.videoCount} clips
                              </span>
                            </div>
                          </div>
                          
                          <div className="p-4">
                            <h3 className="font-semibold text-base truncate" title={event.title}>{event.title}</h3>
                            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2 text-xs text-gray-400">
                              {eventTime && (
                                <span className="flex items-center gap-1">
                                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                                  {eventTime}
                                </span>
                              )}
                              {event.city && (
                                <span className="flex items-center gap-1 truncate max-w-[120px]">
                                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"></path><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"></path></svg>
                                  {event.city}
                                </span>
                              )}
                            </div>
                          </div>
                        </Link>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
