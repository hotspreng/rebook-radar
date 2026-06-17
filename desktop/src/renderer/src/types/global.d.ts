import type { SwrApi } from '@shared/api';

declare global {
  interface Window {
    swr: SwrApi;
  }
}

export {};
