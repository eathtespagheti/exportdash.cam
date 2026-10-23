export type LibrarySourceType = 'server' | 'client';

// The File System Access permission helpers are not part of the standard
// lib.dom typings, but they are implemented by Chromium browsers.
export type PermissionDirectoryHandle = FileSystemDirectoryHandle & {
  queryPermission(descriptor?: { mode?: 'read' | 'readwrite' }): Promise<PermissionState>;
  requestPermission(descriptor?: { mode?: 'read' | 'readwrite' }): Promise<PermissionState>;
};

export type DirectoryPickerWindow = Window & {
  showDirectoryPicker(): Promise<FileSystemDirectoryHandle>;
};

export interface LibraryConfig {
  id: string;
  name: string;
  type: LibrarySourceType;
  path?: string; // Used for 'server' type
  color?: string;
  computedColor?: string;
  isUserAdded?: boolean;
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
  clientHandle?: FileSystemDirectoryHandle;
}
