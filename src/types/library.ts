export type LibrarySourceType = 'server' | 'client';

export interface LibraryConfig {
  id: string;
  name: string;
  type: LibrarySourceType;
  path?: string; // Used for 'server' type
  color?: string;
  computedColor?: string;
}

export interface ServerLibrariesConfig {
  libraries: LibraryConfig[];
}

export interface LibraryEvent {
  id: string;
  folderPath: string;
  libraryPath?: string;
  libraryId?: string;
  libraryName?: string;
  libraryColor?: string;
  title: string;
  date: string;
  timestamp: string | null;
  thumbUrl: string | null;
  videoUrl: string | null;
  videoCount: number;
  type: string;
  reason: string;
  reasonLabel: string;
  city: string;
  camera: string;
  sourceType?: LibrarySourceType;
  clientHandle?: any; // FileSystemDirectoryHandle
}
