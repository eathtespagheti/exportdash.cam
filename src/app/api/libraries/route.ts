import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import yaml from 'yaml';
import { LibraryConfig } from '@/types/library';

export async function GET() {
  const rootDir = process.cwd();
  const yamlPath = path.join(rootDir, 'libraries.yml');
  let libraries: LibraryConfig[] = [];

  try {
    if (fs.existsSync(yamlPath)) {
      const fileContents = fs.readFileSync(yamlPath, 'utf8');
      const parsed = yaml.parse(fileContents);
      if (parsed && Array.isArray(parsed.libraries)) {
        libraries = parsed.libraries;
      }
    }
  } catch (error) {
    console.error('Error parsing libraries.yml:', error);
  }

  return NextResponse.json({ libraries });
}
