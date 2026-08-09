/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL: string;
  readonly VITE_GATEWAY_URL: string;
  readonly VITE_CDN_URL: string;
  readonly VITE_GIPHY_API_KEY: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
