import { create } from 'zustand';

/**
 * Phone shell state (UI overhaul): whether the navigation drawer is open,
 * whether the session list page has folded its docked panel away to show the
 * landing (the phone mock's `sidebarCollapsed` on home), and the session search
 * that native phones open from the top bar. Only the phone shell reads it; the
 * desktop panel keeps its persisted collapse setting.
 */
interface HerdPhoneShellState {
    drawerOpen: boolean;
    homeCollapsed: boolean;
    searchOpen: boolean;
    searchQuery: string;
    openDrawer: () => void;
    closeDrawer: () => void;
    toggleDrawer: () => void;
    toggleHome: () => void;
    expandHome: () => void;
    toggleSearch: () => void;
    closeSearch: () => void;
    setSearchQuery: (searchQuery: string) => void;
}

export const useHerdPhoneShell = create<HerdPhoneShellState>()((set) => ({
    drawerOpen: false,
    homeCollapsed: false,
    searchOpen: false,
    searchQuery: '',
    openDrawer: () => set({ drawerOpen: true }),
    closeDrawer: () => set((state) => state.drawerOpen ? { drawerOpen: false } : state),
    toggleDrawer: () => set((state) => ({ drawerOpen: !state.drawerOpen })),
    toggleHome: () => set((state) => ({ homeCollapsed: !state.homeCollapsed })),
    expandHome: () => set((state) => state.homeCollapsed ? { homeCollapsed: false } : state),
    toggleSearch: () => set((state) => state.searchOpen
        ? { searchOpen: false, searchQuery: '' }
        : { searchOpen: true }),
    closeSearch: () => set({ searchOpen: false, searchQuery: '' }),
    setSearchQuery: (searchQuery) => set({ searchQuery }),
}));
