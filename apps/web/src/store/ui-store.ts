'use client';

import { create } from 'zustand';

/**
 * Client/UI state ONLY (AGENTS.md): server data lives in TanStack Query.
 * Sidebar collapse and the live-log pause toggle (Phase 9) are the canonical
 * examples — losing them on refresh is acceptable.
 */
interface UiState {
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
  liveLogPaused: boolean;
  setLiveLogPaused: (paused: boolean) => void;
}

export const useUiStore = create<UiState>((set) => ({
  sidebarCollapsed: false,
  toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
  liveLogPaused: false,
  setLiveLogPaused: (paused) => set({ liveLogPaused: paused }),
}));
