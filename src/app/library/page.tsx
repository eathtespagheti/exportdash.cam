'use client';

import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import Link from 'next/link';
import { useConfig } from '@/components/ConfigProvider';
import { get, set } from 'idb-keyval';
import { scanClientDirectory } from '@/lib/client-scanner';
import { LibraryConfig, LibraryEvent, LibrarySourceType } from '@/types/library';

const COMMON_COLORS = [
  '#ef4444', '#f97316', '#eab308', '#22c55e', '#06b6d4',
  '#3b82f6', '#6366f1', '#a855f7', '#ec4899', '#f43f5e'
];

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

function HoverScrubber({ event, isEnabled }: { event: LibraryEvent, isEnabled: boolean }) {
  const [isHovered, setIsHovered] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  
  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!videoRef.current || isNaN(videoRef.current.duration)) return;
    const duration = videoRef.current.duration;
    
    // Calculate event offset based on timestamp vs folder timestamp
    let eventOffset = duration / 2;
    if (event.timestamp) {
      const folderMatch = event.folderPath.match(/(\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2})/);
      if (folderMatch) {
        const [date, time] = folderMatch[1].split('_');
        const [y, m, d] = date.split('-');
        const [h, min, s] = time.split('-');
        const folderDate = new Date(`${y}-${m}-${d}T${h}:${min}:${s}`);
        const eventDate = new Date(event.timestamp);
        const diff = (eventDate.getTime() - folderDate.getTime()) / 1000;
        // Folder name usually denotes the end of the clip
        eventOffset = duration + diff;
        if (eventOffset < 0 || eventOffset > duration) eventOffset = duration / 2;
      }
    }
    
    // 30s window (15s before, 15s after)
    const start = Math.max(0, eventOffset - 15);
    const end = Math.min(duration, eventOffset + 15);
    
    const rect = e.currentTarget.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    
    videoRef.current.currentTime = start + x * (end - start);
  };
  
  if (!isEnabled || !event.videoUrl) {
    return (
      <div className="w-full h-full relative overflow-hidden group">
        {event.thumbUrl ? (
          <img src={event.thumbUrl} alt={event.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-gray-600 bg-gray-800">No Preview</div>
        )}
      </div>
    );
  }

  return (
    <div 
      className="w-full h-full relative overflow-hidden group"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => { setIsHovered(false); if(videoRef.current) videoRef.current.pause(); }}
      onMouseMove={handleMouseMove}
    >
      {event.thumbUrl && (
        <img 
          src={event.thumbUrl} 
          alt={event.title} 
          className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-300 ${isHovered ? 'opacity-0' : 'opacity-100 group-hover:scale-105'}`} 
        />
      )}
      {isHovered && (
        <video 
          ref={videoRef}
          src={event.videoUrl}
          muted
          playsInline
          className="absolute inset-0 w-full h-full object-cover"
        />
      )}
    </div>
  );
}

export default function LibraryClipsPage() {
  const { enableLibraryReview, enableServerLibraryConfig } = useConfig();

  const [events, setEvents] = useState<LibraryEvent[]>([]);
  const [libraries, setLibraries] = useState<LibraryConfig[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  // Preferences
  const [showPreferences, setShowPreferences] = useState(false);
  const [prefs, setPrefs] = useState({
    enableHoverScrobbling: true,
    cacheLimitGB: 10,
    showMap: true,
    showTelemetry: true,
    showDateTime: true,
    speedUnit: 'kmh'
  });

  useEffect(() => {
    try {
      const libPrefs = JSON.parse(localStorage.getItem('exportdash-library-prefs') || '{}');
      const overlayPrefs = JSON.parse(localStorage.getItem('exportdash-overlay-config') || '{}');
      
      setPrefs({
        enableHoverScrobbling: libPrefs.enableHoverScrobbling ?? false,
        cacheLimitGB: libPrefs.cacheLimitGB ?? 10,
        showMap: overlayPrefs.showMap ?? true,
        showTelemetry: overlayPrefs.showTelemetry ?? true,
        showDateTime: overlayPrefs.showDateTime ?? true,
        speedUnit: overlayPrefs.speedUnit ?? 'mph',
      });
    } catch {}
  }, []);

  const updatePref = (key: string, value: any) => {
    setPrefs(p => ({ ...p, [key]: value }));
    
    try {
      if (key === 'enableHoverScrobbling' || key === 'cacheLimitGB') {
        const libPrefs = JSON.parse(localStorage.getItem('exportdash-library-prefs') || '{}');
        libPrefs[key] = value;
        localStorage.setItem('exportdash-library-prefs', JSON.stringify(libPrefs));
      } else {
        const overlayPrefs = JSON.parse(localStorage.getItem('exportdash-overlay-config') || '{}');
        overlayPrefs[key] = value;
        localStorage.setItem('exportdash-overlay-config', JSON.stringify(overlayPrefs));
      }
    } catch {}
  };

  // Filters
  const [filterType, setFilterType] = useState<string>('');
  const [filterLibrary, setFilterLibrary] = useState<string>('');
  const [filterReason, setFilterReason] = useState<string>('');
  const [filterCity, setFilterCity] = useState<string>('');
  const [filterCamera, setFilterCamera] = useState<string>('');
  const [filterTimeRange, setFilterTimeRange] = useState<string>('');
  const [filterDateFrom, setFilterDateFrom] = useState<string>('');
  const [filterDateTo, setFilterDateTo] = useState<string>('');

  // Search
  const [searchQuery, setSearchQuery] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);

  const loadData = useCallback(async () => {
    if (!enableLibraryReview) {
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setError('');
    
    try {
      const libsRes = await fetch('/api/libraries');
      const libsData = await libsRes.json();
      const serverLibs: LibraryConfig[] = libsData.libraries || [];
      
      let customLibs: (LibraryConfig & { isUserAdded?: boolean })[] = [];
      try {
        const stored = await get('exportdash-user-libraries');
        if (Array.isArray(stored)) {
          customLibs = stored.map(l => ({ ...l, isUserAdded: true }));
        }
      } catch(e) {}
      
      const allLibsRaw = [...serverLibs, ...customLibs];
      
      let libPrefsData: any = {};
      try {
        libPrefsData = JSON.parse(localStorage.getItem('exportdash-library-prefs') || '{}');
      } catch(e) {}
      const savedColors = libPrefsData.libraryColors || {};
      
      const usedColors = Object.values(savedColors).concat(allLibsRaw.map(l => l.color).filter(Boolean)) as string[];
      
      const allLibs = allLibsRaw.map(lib => {
        let finalColor = savedColors[lib.id] || lib.color;
        if (!finalColor) {
           const available = COMMON_COLORS.filter(c => !usedColors.includes(c));
           if (available.length > 0) {
             const index = Array.from(lib.id).reduce((acc, char) => acc + char.charCodeAt(0), 0) % available.length;
             finalColor = available[index];
           } else {
             const index = Array.from(lib.id).reduce((acc, char) => acc + char.charCodeAt(0), 0) % COMMON_COLORS.length;
             finalColor = COMMON_COLORS[index];
           }
           usedColors.push(finalColor);
        }
        return { ...lib, computedColor: finalColor };
      });

      setLibraries(allLibs);
      
      let allEvents: LibraryEvent[] = [];
      
      await Promise.all(allLibs.map(async (lib) => {
        try {
          if (lib.type === 'server' && lib.path) {
            const res = await fetch(`/api/events?path=${encodeURIComponent(lib.path)}`);
            const data = await res.json();
            if (data.events) {
              const mappedEvents = data.events.map((e: any) => ({ ...e, libraryId: lib.id, libraryName: lib.name, libraryColor: lib.computedColor }));
              allEvents = [...allEvents, ...mappedEvents];
            }
          } else if (lib.type === 'client') {
            const handle = await get(lib.id) as FileSystemDirectoryHandle;
            if (handle) {
              if (await handle.queryPermission({mode: 'read'}) !== 'granted') {
                await handle.requestPermission({mode: 'read'});
              }
              const clientEvents = await scanClientDirectory(handle);
              const mappedEvents = clientEvents.map((e: any) => ({ ...e, libraryId: lib.id, libraryName: lib.name, libraryColor: lib.computedColor }));
              allEvents = [...allEvents, ...mappedEvents];
            }
          }
        } catch (e) {
          console.error('Failed to load events for library', lib.name, e);
        }
      }));
      
      // Deduplicate events by id
      const uniqueEvents = Array.from(new Map(allEvents.map(e => [e.id, e])).values());
      setEvents(uniqueEvents);
    } catch (err: any) {
      setError(err.message || 'Failed to load library data');
    } finally {
      setIsLoading(false);
    }
  }, [enableLibraryReview]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleAddServerLibrary = async () => {
    const path = prompt('Enter the absolute path to the server directory:');
    if (path) {
      const defaultName = path.split('/').filter(Boolean).pop() || path;
      const name = prompt('Enter a name for this library:', defaultName);
      if (!name) return;

      const newLib: LibraryConfig = {
        id: 'server-' + Date.now(),
        name,
        type: 'server',
        path: path
      };
      const stored = await get('exportdash-user-libraries') || [];
      await set('exportdash-user-libraries', [...stored, newLib]);
      loadData();
    }
  };

  const handleAddLocalLibrary = async () => {
    if (!('showDirectoryPicker' in window)) {
      alert('Your browser does not support scanning local folders directly. Please use a Chromium-based browser like Chrome, Edge, or Brave, or configure a Server Path instead.');
      return;
    }
    try {
      // @ts-ignore - TS doesn't know about showDirectoryPicker everywhere yet
      const handle = await window.showDirectoryPicker();
      const name = prompt('Enter a name for this library:', handle.name);
      if (!name) return;

      const newLib: LibraryConfig = {
        id: 'client-' + Date.now(),
        name,
        type: 'client'
      };
      await set(newLib.id, handle);
      const stored = await get('exportdash-user-libraries') || [];
      await set('exportdash-user-libraries', [...stored, newLib]);
      loadData();
    } catch (e) {
      console.error('User cancelled or error picking directory', e);
    }
  };

  const handleRemoveLibrary = async (id: string) => {
    if (!enableServerLibraryConfig && id.startsWith('server-')) {
      alert('Removing server libraries is disabled by configuration.');
      return;
    }
    if (!confirm('Are you sure you want to remove this library from your configuration?')) return;
    const stored = await get('exportdash-user-libraries') || [];
    const updated = stored.filter((l: any) => l.id !== id);
    await set('exportdash-user-libraries', updated);
    loadData();
  };

  const handleRenameLibrary = async (id: string, currentName: string) => {
    const newName = prompt('Enter a new name for this library:', currentName);
    if (!newName || newName === currentName) return;

    const stored = await get('exportdash-user-libraries') || [];
    const updated = stored.map((l: any) => l.id === id ? { ...l, name: newName } : l);
    await set('exportdash-user-libraries', updated);
    loadData();
  };

  const handleChangeLibraryColor = (id: string, color: string) => {
    try {
      const libPrefs = JSON.parse(localStorage.getItem('exportdash-library-prefs') || '{}');
      const updatedColors = { ...(libPrefs.libraryColors || {}), [id]: color };
      libPrefs.libraryColors = updatedColors;
      localStorage.setItem('exportdash-library-prefs', JSON.stringify(libPrefs));
      loadData();
    } catch {}
  };

  // Derived filter options
  const filterOptions = useMemo(() => {
    const types = new Set<string>();
    const librariesSet = new Set<string>();
    const reasons = new Set<string>();
    const cities = new Set<string>();
    const cameras = new Set<string>();
    const dates = new Set<string>();

    events.forEach(event => {
      if (event.type) types.add(event.type);
      if (event.libraryName) librariesSet.add(event.libraryName);
      if (event.reasonLabel) reasons.add(event.reasonLabel);
      if (event.city) cities.add(event.city);
      if (event.camera) cameras.add(event.camera);
      if (event.timestamp) {
        const d = new Date(event.timestamp);
        if (!isNaN(d.getTime())) {
          dates.add(d.toLocaleDateString(undefined, {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric'
          }));
        }
      }
    });

    return {
      types: Array.from(types).sort(),
      libraries: Array.from(librariesSet).sort(),
      reasons: Array.from(reasons).sort(),
      cities: Array.from(cities).sort(),
      cameras: Array.from(cameras).sort(),
      dates: Array.from(dates)
    };
  }, [events]);

  const suggestions = useMemo(() => {
    if (!searchQuery.trim()) return [];
    const q = searchQuery.toLowerCase();
    const results: { type: string, value: string, label: string }[] = [];

    filterOptions.cities.forEach(c => {
      if (c && c.toLowerCase().includes(q)) results.push({ type: 'City', value: c, label: c });
    });
    filterOptions.reasons.forEach(r => {
      if (r && r.toLowerCase().includes(q)) results.push({ type: 'Reason', value: r, label: r });
    });
    filterOptions.types.forEach(t => {
      if (t && t.toLowerCase().includes(q)) results.push({ type: 'Type', value: t, label: t });
    });
    filterOptions.libraries.forEach(l => {
      if (l && l.toLowerCase().includes(q)) results.push({ type: 'Library', value: l, label: l });
    });
    filterOptions.cameras.forEach(c => {
      if (!c) return;
      const label = getCameraLabel(c);
      if (label.toLowerCase().includes(q)) results.push({ type: 'Camera', value: c, label: label });
    });
    
    ['Morning', 'Afternoon', 'Evening', 'Night'].forEach(t => {
      if (t.toLowerCase().includes(q)) results.push({ type: 'Time', value: t, label: t });
    });

    filterOptions.dates.forEach(d => {
      if (d && d.toLowerCase().includes(q)) results.push({ type: 'Date', value: d, label: d });
    });

    return results.slice(0, 8); // Max 8 suggestions
  }, [searchQuery, filterOptions]);

  const applySuggestion = (sugg: { type: string, value: string, label: string }) => {
    if (sugg.type === 'City') setFilterCity(sugg.value);
    else if (sugg.type === 'Reason') setFilterReason(sugg.value);
    else if (sugg.type === 'Type') setFilterType(sugg.value);
    else if (sugg.type === 'Library') setFilterLibrary(sugg.value);
    else if (sugg.type === 'Camera') setFilterCamera(sugg.value);
    else if (sugg.type === 'Time') setFilterTimeRange(sugg.value);
    else if (sugg.type === 'Date') {
      setSearchQuery(sugg.value);
      setShowSuggestions(false);
      return; // Act as text search for dates
    }
    
    setSearchQuery('');
    setShowSuggestions(false);
  };

  // Filtered and grouped events
  const groupedEvents = useMemo(() => {
    const filtered = events.filter(event => {
      if (filterType && event.type !== filterType) return false;
      if (filterLibrary && event.libraryName !== filterLibrary) return false;
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

      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase();
        const timeOfDay = eventDate ? getTimeOfDay(eventDate).toLowerCase() : '';
        const dateStr = eventDate ? eventDate.toLocaleDateString().toLowerCase() : '';
        const dateKey = eventDate ? eventDate.toLocaleDateString(undefined, {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric'
          }).toLowerCase() : '';

        const searchString = `
          ${event.title.toLowerCase()}
          ${event.libraryName ? event.libraryName.toLowerCase() : ''}
          ${event.city.toLowerCase()}
          ${event.reasonLabel.toLowerCase()}
          ${event.type.toLowerCase()}
          ${getCameraLabel(event.camera).toLowerCase()}
          ${timeOfDay}
          ${dateStr}
          ${dateKey}
        `;

        if (!searchString.includes(query)) {
          return false;
        }
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

    // Sort groups
    const sortedGroups = Object.entries(groups).sort((a, b) => {
      if (a[0] === 'Unknown Date') return 1;
      if (b[0] === 'Unknown Date') return -1;
      
      const timeA = a[1][0].timestamp ? new Date(a[1][0].timestamp).getTime() : 0;
      const timeB = b[1][0].timestamp ? new Date(b[1][0].timestamp).getTime() : 0;
      return timeB - timeA;
    });

    return sortedGroups;
  }, [events, filterType, filterReason, filterCity, filterCamera, filterTimeRange, filterDateFrom, filterDateTo, searchQuery]);

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
              setSearchQuery('');
            }}
            className="text-sm text-blue-400 hover:text-blue-300 transition-colors"
          >
            Clear all
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-400 mb-1">Library</label>
            <select 
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
              value={filterLibrary}
              onChange={(e) => setFilterLibrary(e.target.value)}
            >
              <option value="">All Libraries</option>
              {filterOptions.libraries.map(l => <option key={l} value={l}>{l}</option>)}
            </select>
          </div>

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
          <div className="flex md:hidden justify-between items-center mb-6">
            <h1 className="text-3xl font-bold flex items-center gap-2">
              Library
              <button onClick={() => setShowPreferences(true)} className="p-2 bg-gray-800 hover:bg-gray-700 rounded-full transition-colors">
                <svg className="w-5 h-5 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"></path><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path></svg>
              </button>
            </h1>
            <Link href="/" className="px-4 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg transition-colors text-sm">
              Back
            </Link>
          </div>

          <div className="hidden md:flex justify-between items-center mb-6">
            <h1 className="text-3xl font-bold flex items-center gap-3">
              Library
              <button onClick={() => setShowPreferences(true)} className="p-2 bg-gray-800 hover:bg-gray-700 rounded-full transition-colors mt-1">
                <svg className="w-5 h-5 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"></path><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path></svg>
              </button>
            </h1>
          </div>

          {showPreferences && (
            <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={() => setShowPreferences(false)}>
              <div className="bg-gray-900 border border-gray-700 rounded-xl p-6 w-full max-w-sm shadow-2xl" onClick={e => e.stopPropagation()}>
                <div className="flex justify-between items-center mb-6">
                  <h2 className="text-xl font-bold text-white">Preferences</h2>
                  <button onClick={() => setShowPreferences(false)} className="text-gray-400 hover:text-white">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                  </button>
                </div>
                
                <div className="space-y-6 max-h-[70vh] overflow-y-auto pr-2">
                  <div className="space-y-4">
                    <h3 className="font-bold text-white text-lg">Libraries</h3>

                    <div className="space-y-2">
                      {libraries.map(lib => {
                        const isUserAdded = (lib as any).isUserAdded;
                        return (
                          <div key={lib.id} className="flex items-center justify-between bg-gray-800 p-3 rounded-lg border border-gray-700 group">
                            <div className="flex items-center gap-3 overflow-hidden flex-1 mr-4">
                              <input 
                                type="color" 
                                value={(lib as any).computedColor || '#3b82f6'} 
                                onChange={(e) => handleChangeLibraryColor(lib.id, e.target.value)}
                                className="w-5 h-5 rounded cursor-pointer border-0 p-0 bg-transparent flex-shrink-0" 
                                title="Change Library Color"
                              />
                              <div className="overflow-hidden">
                                <h4 className="font-medium text-sm text-gray-200 truncate" title={lib.name}>{lib.name}</h4>
                                <p className="text-[10px] text-gray-500 uppercase mt-0.5 tracking-wider font-semibold">
                                  {lib.type} {lib.path && `• ${lib.path}`}
                                </p>
                              </div>
                            </div>
                            {isUserAdded && (lib.type !== 'server' || enableServerLibraryConfig) && (
                              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                <button onClick={() => handleRenameLibrary(lib.id, lib.name)} className="text-gray-500 hover:text-blue-400 p-1 flex-shrink-0" title="Rename Library">
                                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"></path></svg>
                                </button>
                                <button onClick={() => handleRemoveLibrary(lib.id)} className="text-gray-500 hover:text-red-400 p-1 flex-shrink-0" title="Remove Library">
                                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                                </button>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>

                    <div className="flex gap-2">
                      {enableServerLibraryConfig && (
                        <button onClick={handleAddServerLibrary} className="flex-1 px-3 py-2 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-lg text-xs font-medium text-gray-300 transition-colors">
                          + Server Path
                        </button>
                      )}
                      <button onClick={handleAddLocalLibrary} className="flex-1 px-3 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg text-xs font-medium text-white transition-colors">
                        + Local Folder
                      </button>
                    </div>
                  </div>

                  <div className="w-full h-px bg-gray-800"></div>

                  <div className="space-y-4">
                    <h3 className="font-bold text-white text-lg">Playback</h3>
                    <div className="flex items-center justify-between">
                      <div>
                        <h4 className="font-medium text-gray-200 text-sm">Hover Scrobbling</h4>
                        <p className="text-xs text-gray-500 mt-0.5">Scrub clips by moving mouse over thumbnails</p>
                      </div>
                      <label className="relative inline-flex items-center cursor-pointer">
                        <input type="checkbox" className="sr-only peer" checked={prefs.enableHoverScrobbling} onChange={(e) => updatePref('enableHoverScrobbling', e.target.checked)} />
                        <div className="w-11 h-6 bg-gray-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                      </label>
                    </div>

                    <div className="flex flex-col gap-2">
                      <div className="flex items-center justify-between">
                        <div>
                          <h4 className="font-medium text-gray-200 text-sm">Browser Cache Limit</h4>
                          <p className="text-xs text-gray-500 mt-0.5">Max storage for fast clip replay ({prefs.cacheLimitGB} GB)</p>
                        </div>
                      </div>
                      <input 
                        type="range" 
                        min="0" 
                        max="50" 
                        step="1"
                        value={prefs.cacheLimitGB} 
                        onChange={(e) => updatePref('cacheLimitGB', parseInt(e.target.value, 10))}
                        className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-blue-500"
                      />
                      <div className="flex justify-between text-[10px] text-gray-500">
                        <span>0 GB (Off)</span>
                        <span>50 GB</span>
                      </div>
                    </div>
                  </div>
                </div>              </div>
            </div>
          )}

          {/* Search Bar with Suggestions */}
          <div className="relative mb-4">
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <svg className="h-5 w-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path></svg>
              </div>
              <input
                type="text"
                className="block w-full pl-10 pr-3 py-3 border border-gray-700 rounded-xl leading-5 bg-gray-900 text-gray-300 placeholder-gray-500 focus:outline-none focus:bg-gray-800 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 sm:text-sm transition-colors"
                placeholder="Search by city, date, reason, type..."
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setShowSuggestions(true);
                }}
                onFocus={() => setShowSuggestions(true)}
                onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
              />
            </div>
            
            {showSuggestions && suggestions.length > 0 && (
              <div className="absolute z-50 mt-2 w-full bg-gray-800 border border-gray-700 rounded-xl shadow-lg overflow-hidden">
                <ul className="max-h-60 overflow-auto py-1 text-sm text-gray-300">
                  {suggestions.map((sugg, idx) => (
                    <li 
                      key={idx} 
                      className="px-4 py-2 hover:bg-gray-700 cursor-pointer flex items-center justify-between"
                      onClick={() => applySuggestion(sugg)}
                    >
                      <span className="font-medium text-white">{sugg.label}</span>
                      <span className="text-xs font-semibold text-blue-400 bg-blue-900/30 px-2 py-0.5 rounded tracking-wide uppercase">{sugg.type}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {/* Active Filter Badges */}
          <div className="flex flex-wrap gap-2 mb-6">
            {filterLibrary && (
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                Library: {filterLibrary}
                <button onClick={() => setFilterLibrary('')} className="hover:text-white">&times;</button>
              </span>
            )}
            {filterType && (
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-blue-500/20 text-blue-300 border border-blue-500/30">
                Type: {filterType}
                <button onClick={() => setFilterType('')} className="hover:text-white">&times;</button>
              </span>
            )}
            {filterReason && (
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-purple-500/20 text-purple-300 border border-purple-500/30">
                Reason: {filterReason}
                <button onClick={() => setFilterReason('')} className="hover:text-white">&times;</button>
              </span>
            )}
            {filterCity && (
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-green-500/20 text-green-300 border border-green-500/30">
                City: {filterCity}
                <button onClick={() => setFilterCity('')} className="hover:text-white">&times;</button>
              </span>
            )}
            {filterCamera && (
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-yellow-500/20 text-yellow-300 border border-yellow-500/30">
                Camera: {getCameraLabel(filterCamera)}
                <button onClick={() => setFilterCamera('')} className="hover:text-white">&times;</button>
              </span>
            )}
            {filterTimeRange && (
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-orange-500/20 text-orange-300 border border-orange-500/30">
                Time: {filterTimeRange}
                <button onClick={() => setFilterTimeRange('')} className="hover:text-white">&times;</button>
              </span>
            )}
            {(filterDateFrom || filterDateTo) && (
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-pink-500/20 text-pink-300 border border-pink-500/30">
                Date: {filterDateFrom || 'Any'} to {filterDateTo || 'Any'}
                <button onClick={() => { setFilterDateFrom(''); setFilterDateTo(''); }} className="hover:text-white">&times;</button>
              </span>
            )}
          </div>

          {isLoading ? (
            <div className="text-center py-20 text-gray-400">Loading clips...</div>
          ) : error ? (
            <div className="text-center py-20 text-red-400">Error: {error}</div>
          ) : groupedEvents.length === 0 ? (
            <div className="text-center py-20 text-gray-400">
              {events.length === 0 ? `No clips found in your configured libraries. Try adding a Local Folder${enableServerLibraryConfig ? ' or Server Path' : ''}.` : 'No clips match the selected filters.'}
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
                      const href = event.sourceType === 'client' 
                        ? `/?clientLibraryId=${encodeURIComponent(event.libraryId || '')}&folder=${encodeURIComponent(event.folderPath)}`
                        : `/?folder=${encodeURIComponent(event.folderPath)}${event.libraryPath ? `&libraryPath=${encodeURIComponent(event.libraryPath)}` : ''}`;
                      
                      return (
                        <Link key={event.id} href={href} className="bg-gray-900 rounded-xl overflow-hidden border border-gray-800 hover:border-blue-500 transition-colors group block relative">
                          <div className="aspect-video bg-gray-800 relative overflow-hidden">
                            <HoverScrubber event={event} isEnabled={prefs.enableHoverScrobbling} />
                            
                            {/* Tags overlay */}
                            <div className="absolute top-2 left-2 flex flex-col items-start gap-1">
                              {libraries.length > 1 && event.libraryName && (
                                <span 
                                  className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider text-white shadow-sm"
                                  style={{ backgroundColor: event.libraryColor || '#3b82f6' }}
                                >
                                  {event.libraryName}
                                </span>
                              )}
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

