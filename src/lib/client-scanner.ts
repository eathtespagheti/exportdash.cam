import { LibraryEvent } from '@/types/library';

const CAMERA_MAP_TO_SUFFIX: Record<string, string> = {
  '0': 'front',
  '5': 'left_repeater',
  '6': 'right_repeater',
  '7': 'back',
};

export async function scanClientDirectory(
  dirHandle: FileSystemDirectoryHandle,
  currentPath: string = '',
  depth: number = 0
): Promise<LibraryEvent[]> {
  if (depth > 2) return [];

  let events: LibraryEvent[] = [];
  const files: FileSystemFileHandle[] = [];
  const dirs: FileSystemDirectoryHandle[] = [];

  try {
    for await (const entry of dirHandle.values()) {
      if (entry.kind === 'file') {
        files.push(entry);
      } else if (entry.kind === 'directory') {
        dirs.push(entry);
      }
    }

    const eventJsonHandle = files.find(f => f.name.toLowerCase() === 'event.json');
    const thumbHandle = files.find(f => f.name.toLowerCase() === 'thumb.png');
    const videoHandles = files.filter(f => f.name.toLowerCase().endsWith('.mp4'));

    if (eventJsonHandle && videoHandles.length > 0) {
      let title = currentPath.split('/').pop() || 'Unknown Event';
      let dateStr = '';
      let timestampStr: string | null = null;
      let reason = '';
      let reasonLabel = '';
      let city = '';
      let camera = '';
      let type = 'Unknown';

      const lowerPath = currentPath.toLowerCase();
      if (lowerPath.includes('sentry')) {
        type = 'Sentry';
      } else if (lowerPath.includes('saved') || lowerPath.includes('dashcam')) {
        type = 'Dashcam';
      }

      let videoUrl: string | null = null;
      let thumbUrl: string | null = null;

      try {
        const file = await eventJsonHandle.getFile();
        const text = await file.text();
        const eventData = JSON.parse(text);

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

      const cameraSuffix = CAMERA_MAP_TO_SUFFIX[camera] || 'front';
      let primaryVideo = videoHandles.find(v => v.name.toLowerCase().includes(`-${cameraSuffix}.mp4`));

      if (!primaryVideo) {
        primaryVideo = videoHandles.find(v => v.name.toLowerCase().includes('-front.mp4'));
      }

      if (!primaryVideo && videoHandles.length > 0) {
        primaryVideo = videoHandles[0];
      }

      if (primaryVideo) {
        const file = await primaryVideo.getFile();
        videoUrl = URL.createObjectURL(file);
      }

      if (thumbHandle) {
        const file = await thumbHandle.getFile();
        thumbUrl = URL.createObjectURL(file);
      }

      events.push({
        id: dirHandle.name + '-' + currentPath,
        folderPath: currentPath,
        title,
        date: dateStr,
        timestamp: timestampStr,
        thumbUrl,
        videoUrl,
        videoCount: videoHandles.length,
        type,
        reason,
        reasonLabel,
        city,
        camera,
        sourceType: 'client',
        clientHandle: dirHandle,
      });
    }

    if (!eventJsonHandle) {
      for (const dir of dirs) {
        const subPath = currentPath ? `${currentPath}/${dir.name}` : dir.name;
        const subEvents = await scanClientDirectory(dir, subPath, depth + 1);
        events = events.concat(subEvents);
      }
    }

  } catch (error) {
    console.error('Error scanning client directory:', dirHandle.name, error);
  }

  return events;
}
