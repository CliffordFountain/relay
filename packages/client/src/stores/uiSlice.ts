import { createSlice, PayloadAction } from '@reduxjs/toolkit';

/** Mirrors GatewayConnectionState in api/gateway.ts (duplicated to avoid a circular import). */
export type GatewayConnection =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'resuming'
  | 'reconnecting';

interface UIState {
  activeModal: string | null;
  modalProps: Record<string, unknown>;
  memberSidebarOpen: boolean;
  channelSidebarWidth: number;
  sidebarCollapsed: boolean;
  activePopoverUserId: string | null;
  activePopoverPosition: { top: number; left: number } | null;
  activePopoverGuildId: string | null;
  replyingToMessageId: string | null;
  editingMessageId: string | null;
  appLoading: boolean;
  /** Non-null when startup failed for a non-auth reason (network/5xx); drives the retry screen. */
  startupError: string | null;
  /** Bumped by retryStartup() to re-trigger the startup loader without a full page reload. */
  startupNonce: number;
  /** Live gateway (realtime) connection state, driven by the gateway state handler. */
  gatewayConnection: GatewayConnection;
  lightboxImage: string | null;
  quickSwitcherOpen: boolean;
  pinnedMessagesPanelOpen: boolean;
  threadsPanelOpen: boolean;
  inboxPanelOpen: boolean;
  inboxPanelTab: 'forYou' | 'unreads';
  activeNowPanelOpen: boolean;
}

const initialState: UIState = {
  activeModal: null,
  modalProps: {},
  memberSidebarOpen: true,
  channelSidebarWidth: 240,
  sidebarCollapsed: false,
  activePopoverUserId: null,
  activePopoverPosition: null,
  activePopoverGuildId: null,
  replyingToMessageId: null,
  editingMessageId: null,
  appLoading: true,
  startupError: null,
  startupNonce: 0,
  gatewayConnection: 'disconnected',
  lightboxImage: null,
  quickSwitcherOpen: false,
  pinnedMessagesPanelOpen: false,
  threadsPanelOpen: false,
  inboxPanelOpen: false,
  inboxPanelTab: 'forYou',
  activeNowPanelOpen: true,
};

export const uiSlice = createSlice({
  name: 'ui',
  initialState,
  reducers: {
    openModal: (state, action: PayloadAction<{ modal: string; props?: Record<string, unknown> }>) => {
      state.activeModal = action.payload.modal;
      state.modalProps = action.payload.props ?? {};
    },
    closeModal: (state) => {
      state.activeModal = null;
      state.modalProps = {};
    },
    toggleMemberSidebar: (state) => {
      state.memberSidebarOpen = !state.memberSidebarOpen;
    },
    setMemberSidebarOpen: (state, action: PayloadAction<boolean>) => {
      state.memberSidebarOpen = action.payload;
    },
    setChannelSidebarWidth: (state, action: PayloadAction<number>) => {
      state.channelSidebarWidth = action.payload;
    },
    toggleSidebar: (state) => {
      state.sidebarCollapsed = !state.sidebarCollapsed;
    },
    setActivePopoverUserId: (state, action: PayloadAction<string | null>) => {
      state.activePopoverUserId = action.payload;
      if (action.payload === null) {
        state.activePopoverPosition = null;
        state.activePopoverGuildId = null;
      }
    },
    openUserPopover: (
      state,
      action: PayloadAction<{ userId: string; position: { top: number; left: number }; guildId?: string | null }>,
    ) => {
      state.activePopoverUserId = action.payload.userId;
      state.activePopoverPosition = action.payload.position;
      state.activePopoverGuildId = action.payload.guildId ?? null;
    },
    setReplyingToMessageId: (state, action: PayloadAction<string | null>) => {
      state.replyingToMessageId = action.payload;
      // Cancel editing when starting a reply
      if (action.payload !== null) {
        state.editingMessageId = null;
      }
    },
    setEditingMessageId: (state, action: PayloadAction<string | null>) => {
      state.editingMessageId = action.payload;
      // Cancel replying when starting an edit
      if (action.payload !== null) {
        state.replyingToMessageId = null;
      }
    },
    setAppLoading: (state, action: PayloadAction<boolean>) => {
      state.appLoading = action.payload;
    },
    setStartupError: (state, action: PayloadAction<string | null>) => {
      state.startupError = action.payload;
    },
    retryStartup: (state) => {
      state.startupError = null;
      state.appLoading = true;
      state.startupNonce += 1;
    },
    setGatewayConnection: (state, action: PayloadAction<GatewayConnection>) => {
      state.gatewayConnection = action.payload;
    },
    openLightbox: (state, action: PayloadAction<string>) => {
      state.lightboxImage = action.payload;
    },
    closeLightbox: (state) => {
      state.lightboxImage = null;
    },
    openQuickSwitcher: (state) => {
      state.quickSwitcherOpen = true;
    },
    closeQuickSwitcher: (state) => {
      state.quickSwitcherOpen = false;
    },
    togglePinnedMessagesPanel: (state) => {
      state.pinnedMessagesPanelOpen = !state.pinnedMessagesPanelOpen;
    },
    closePinnedMessagesPanel: (state) => {
      state.pinnedMessagesPanelOpen = false;
    },
    toggleThreadsPanel: (state) => {
      state.threadsPanelOpen = !state.threadsPanelOpen;
    },
    closeThreadsPanel: (state) => {
      state.threadsPanelOpen = false;
    },
    toggleInboxPanel: (state) => {
      state.inboxPanelOpen = !state.inboxPanelOpen;
    },
    closeInboxPanel: (state) => {
      state.inboxPanelOpen = false;
    },
    setInboxPanelTab: (state, action: PayloadAction<'forYou' | 'unreads'>) => {
      state.inboxPanelTab = action.payload;
    },
    toggleActiveNowPanel: (state) => {
      state.activeNowPanelOpen = !state.activeNowPanelOpen;
    },
  },
});

export const {
  openModal,
  closeModal,
  toggleMemberSidebar,
  setMemberSidebarOpen,
  setChannelSidebarWidth,
  toggleSidebar,
  setActivePopoverUserId,
  openUserPopover,
  setReplyingToMessageId,
  setEditingMessageId,
  setAppLoading,
  setStartupError,
  retryStartup,
  setGatewayConnection,
  openLightbox,
  closeLightbox,
  openQuickSwitcher,
  closeQuickSwitcher,
  togglePinnedMessagesPanel,
  closePinnedMessagesPanel,
  toggleThreadsPanel,
  closeThreadsPanel,
  toggleInboxPanel,
  closeInboxPanel,
  setInboxPanelTab,
  toggleActiveNowPanel,
} = uiSlice.actions;
