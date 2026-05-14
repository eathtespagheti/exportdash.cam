'use client';

import { createContext, useContext, ReactNode } from 'react';

interface AppConfig {
  enableUploadBox: boolean;
  enableLibraryReview: boolean;
  enableServerLibraryConfig: boolean;
}

const ConfigContext = createContext<AppConfig>({
  enableUploadBox: true,
  enableLibraryReview: false,
  enableServerLibraryConfig: false,
});

export function ConfigProvider({ children, config }: { children: ReactNode; config: AppConfig }) {
  return (
    <ConfigContext.Provider value={config}>
      {children}
    </ConfigContext.Provider>
  );
}

export function useConfig() {
  return useContext(ConfigContext);
}