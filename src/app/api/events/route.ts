import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

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

function findEvents(basePath: string, currentPath: string = '', depth: number = 0): LibraryEvent[] {
  // Max depth to prevent infinite loops / too deep scanning (e.g., base -> SentryClips -> DateFolder)
  if (depth > 2) return [];

  const absolutePath = path.join(basePath, currentPath);
  let events: LibraryEvent[] = [];

  try {
    const files = fs.readdirSync(absolutePath, { withFileTypes: true });
    
    const hasEventJson = files.some(f => f.isFile() && f.name.toLowerCase() === 'event.json');
    const hasThumb = files.some(f => f.isFile() && f.name.toLowerCase() === 'thumb.png');
    const videos = files.filter(f => f.isFile() && f.name.toLowerCase().endsWith('.mp4'));

    if (hasEventJson && videos.length > 0) {
      let title = currentPath.split(path.sep).pop() || 'Unknown Event';
      let dateStr = '';
      let timestampStr = null;
      let reason = '';
      let reasonLabel = '';
      let city = '';
      let camera = '';
      let type = 'Unknown';
      
      // Determine type from folder path
      const lowerPath = currentPath.toLowerCase();
      if (lowerPath.includes('sentry')) {
        type = 'Sentry';
      } else if (lowerPath.includes('saved') || lowerPath.includes('dashcam')) {
        type = 'Dashcam';
      }
      
      try {
        const eventJsonContent = fs.readFileSync(path.join(absolutePath, 'event.json'), 'utf8');
        const eventData = JSON.parse(eventJsonContent);
        
        reason = eventData.reason || '';
        reasonLabel = reason || '';
        if (reasonLabel) {
          reasonLabel = reasonLabel.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase());
        }
        
        city = eventData.city || '';
        camera = eventData.camera || '';
        
        title = [city, reasonLabel].filter(Boolean).join(' - ') || title;
        
        if (eventData.timestamp) {
          timestampStr = eventData.timestamp;
          const dateObj = new Date(eventData.timestamp);
          if (!isNaN(dateObj.getTime())) {
            dateStr = dateObj.toLocaleString();
          }
        }
      } catch (e) {
        // Ignore JSON parse errors
      }

      events.push({
        id: Buffer.from(currentPath).toString('base64'),
        folderPath: currentPath,
        title,
        date: dateStr,
        timestamp: timestampStr,
        thumbUrl: hasThumb ? `/api/video?path=${encodeURIComponent(path.join(absolutePath, 'thumb.png'))}` : null,
        videoCount: videos.length,
        type,
        reason,
        reasonLabel,
        city,
        camera
      });
    }

    // Continue scanning subdirectories if we didn't find an event here, or even if we did?
    // TeslaCam usually doesn't nest events.
    if (!hasEventJson) {
      const dirs = files.filter(f => f.isDirectory());
      for (const dir of dirs) {
        events = events.concat(findEvents(basePath, path.join(currentPath, dir.name), depth + 1));
      }
    }

  } catch (error) {
    console.error('Error scanning directory:', absolutePath, error);
  }

  return events;
}

export async function GET(request: Request) {
  const dirPath = process.env.LIBRARY_CLIPS_PATH;

  if (!dirPath) {
    return NextResponse.json({ error: 'Library clips path is not configured' }, { status: 400 });
  }

  try {
    const absolutePath = path.resolve(dirPath);
    
    if (!fs.existsSync(absolutePath)) {
      return NextResponse.json({ error: 'Directory not found' }, { status: 404 });
    }

    const stat = fs.statSync(absolutePath);
    if (!stat.isDirectory()) {
      return NextResponse.json({ error: 'Path is not a directory' }, { status: 400 });
    }

    const events = findEvents(absolutePath);
    
    // Sort events by date descending
    events.sort((a, b) => {
      const dateA = a.timestamp ? new Date(a.timestamp).getTime() : new Date(a.date).getTime();
      const dateB = b.timestamp ? new Date(b.timestamp).getTime() : new Date(b.date).getTime();
      if (!isNaN(dateA) && !isNaN(dateB)) return dateB - dateA;
      return b.folderPath.localeCompare(a.folderPath);
    });

    return NextResponse.json({ events });
  } catch (error) {
    console.error('Error reading events:', error);
    return NextResponse.json({ error: 'Failed to read events' }, { status: 500 });
  }
}
