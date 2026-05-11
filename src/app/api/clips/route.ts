import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const folder = searchParams.get('folder');
  
  const baseDirPath = process.env.LIBRARY_CLIPS_PATH;

  if (!baseDirPath) {
    return NextResponse.json({ error: 'Library clips path is not configured' }, { status: 400 });
  }

  try {
    let absolutePath = path.resolve(baseDirPath);
    
    if (folder) {
      // Prevent directory traversal
      const safeFolder = path.normalize(folder).replace(/^(\.\.(\/|\\|$))+/, '');
      absolutePath = path.join(absolutePath, safeFolder);
    }
    
    // Check if directory exists
    if (!fs.existsSync(absolutePath)) {
      return NextResponse.json({ error: 'Directory not found' }, { status: 404 });
    }

    const stat = fs.statSync(absolutePath);
    if (!stat.isDirectory()) {
      return NextResponse.json({ error: 'Path is not a directory' }, { status: 400 });
    }

    const files = fs.readdirSync(absolutePath);
    
    const virtualFiles = files
      .map(file => {
        const filePath = path.join(absolutePath, file);
        try {
          const fileStat = fs.statSync(filePath);
          if (fileStat.isFile() && (file.toLowerCase().endsWith('.mp4') || file.toLowerCase() === 'event.json')) {
            return {
              name: file,
              size: fileStat.size,
              url: `/api/video?path=${encodeURIComponent(filePath)}`
            };
          }
        } catch (e) {
          // Ignore files that can't be read
        }
        return null;
      })
      .filter(Boolean);

    return NextResponse.json({ files: virtualFiles });
  } catch (error) {
    console.error('Error reading directory:', error);
    return NextResponse.json({ error: 'Failed to read directory' }, { status: 500 });
  }
}