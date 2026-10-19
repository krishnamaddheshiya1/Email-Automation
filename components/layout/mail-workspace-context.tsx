"use client";

import React, { createContext, useContext, useState, useEffect, useCallback } from "react";

export interface ComposeInitialData {
  to?: string;
  subject?: string;
  body?: string;
}

interface MailWorkspaceContextType {
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
  composeOpen: boolean;
  composeInitial: ComposeInitialData | null;
  openCompose: (data?: ComposeInitialData) => void;
  closeCompose: () => void;
  unreadInbox: number;
  unreadNotifications: number;
  refreshCounts: () => Promise<void>;
}

const MailWorkspaceContext = createContext<MailWorkspaceContextType>({
  sidebarCollapsed: false,
  toggleSidebar: () => {},
  composeOpen: false,
  composeInitial: null,
  openCompose: () => {},
  closeCompose: () => {},
  unreadInbox: 0,
  unreadNotifications: 0,
  refreshCounts: async () => {},
});

export function MailWorkspaceProvider({ children }: { children: React.ReactNode }) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [composeOpen, setComposeOpen] = useState(false);
  const [composeInitial, setComposeInitial] = useState<ComposeInitialData | null>(null);
  const [unreadInbox, setUnreadInbox] = useState(0);
  const [unreadNotifications, setUnreadNotifications] = useState(0);

  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed((prev) => !prev);
  }, []);

  const openCompose = useCallback((data?: ComposeInitialData) => {
    setComposeInitial(data || null);
    setComposeOpen(true);
  }, []);

  const closeCompose = useCallback(() => {
    setComposeOpen(false);
    setComposeInitial(null);
  }, []);

  const refreshCounts = useCallback(async () => {
    try {
      // 1. Fetch conversations unread count
      const convoRes = await fetch("/api/conversations?filter=unread&limit=1");
      if (convoRes.ok) {
        const convoData = await convoRes.json();
        if (convoData.success) {
          const count = convoData.data?.unread_total ?? convoData.unread_total ?? 0;
          setUnreadInbox(count);
        }
      }
    } catch {}

    try {
      // 2. Fetch notifications count
      const notifRes = await fetch("/api/notifications");
      if (notifRes.ok) {
        const notifData = await notifRes.json();
        if (notifData.success) {
          setUnreadNotifications(notifData.unreadCount || 0);
        }
      }
    } catch {}
  }, []);

  useEffect(() => {
    let isMounted = true;
    async function load() {
      try {
        const convoRes = await fetch("/api/conversations?filter=unread&limit=1");
        if (convoRes.ok) {
          const convoData = await convoRes.json();
          if (isMounted && convoData.success) {
            const count = convoData.data?.unread_total ?? convoData.unread_total ?? 0;
            setUnreadInbox(count);
          }
        }
      } catch {}

      try {
        const notifRes = await fetch("/api/notifications");
        if (notifRes.ok) {
          const notifData = await notifRes.json();
          if (isMounted && notifData.success) {
            setUnreadNotifications(notifData.unreadCount || 0);
          }
        }
      } catch {}
    }

    load();
    const interval = setInterval(load, 8000); // 8s live polling
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, []);

  return (
    <MailWorkspaceContext.Provider
      value={{
        sidebarCollapsed,
        toggleSidebar,
        composeOpen,
        composeInitial,
        openCompose,
        closeCompose,
        unreadInbox,
        unreadNotifications,
        refreshCounts,
      }}
    >
      {children}
    </MailWorkspaceContext.Provider>
  );
}

export function useMailWorkspace() {
  return useContext(MailWorkspaceContext);
}
