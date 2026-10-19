"use client";

import React, { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { siteConfig } from "@/lib/config/site";
import { LogoutButton } from "@/components/auth/logout-button";
import { useMailWorkspace } from "./mail-workspace-context";

interface AuthUserSummary {
  name: string;
  email: string;
  businessName: string;
  role: string;
}

interface SearchItem {
  id: string;
  title: string;
  subtitle: string;
  snippet?: string;
  href: string;
  badge?: string;
  timestamp?: string;
}

interface SearchResults {
  emails: SearchItem[];
  contacts: SearchItem[];
  campaigns: SearchItem[];
  templates: SearchItem[];
}

interface NotificationItem {
  id: string;
  type: string;
  title: string;
  message: string;
  href: string;
  createdAt: string;
  isRead: boolean;
  severity: "info" | "warning" | "error" | "success";
}

export function Header() {
  const router = useRouter();
  const { toggleSidebar, unreadNotifications } = useMailWorkspace();

  const [currentUser, setCurrentUser] = useState<AuthUserSummary | null>(null);

  // Search state
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResults | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [isSearching, setIsSearching] = useState(false);

  // Dropdowns state
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [helpOpen, setHelpOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);

  const searchContainerRef = useRef<HTMLDivElement>(null);
  const notifRef = useRef<HTMLDivElement>(null);
  const profileRef = useRef<HTMLDivElement>(null);

  // Load current user
  useEffect(() => {
    async function loadMe() {
      try {
        const res = await fetch("/api/auth/me");
        if (res.ok) {
          const data = await res.json();
          if (data.success && data.user) {
            setCurrentUser({
              name: data.user.full_name || "User",
              email: data.user.email,
              businessName: data.business?.name || "Workspace",
              role: data.user.role || "owner",
            });
          }
        }
      } catch {}
    }
    loadMe();
  }, []);

  // Debounced search
  useEffect(() => {
    if (!searchQuery.trim()) {
      return;
    }

    const timer = setTimeout(async () => {
      setIsSearching(true);
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(searchQuery.trim())}`);
        if (res.ok) {
          const data = await res.json();
          if (data.success) {
            setSearchResults(data.results);
            setSearchOpen(true);
          }
        }
      } catch {
      } finally {
        setIsSearching(false);
      }
    }, 250);

    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Click outside listener for dropdowns
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        searchContainerRef.current &&
        !searchContainerRef.current.contains(event.target as Node)
      ) {
        setSearchOpen(false);
      }
      if (notifRef.current && !notifRef.current.contains(event.target as Node)) {
        setNotificationsOpen(false);
      }
      if (profileRef.current && !profileRef.current.contains(event.target as Node)) {
        setProfileOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Load notifications when opening
  async function toggleNotifications() {
    if (!notificationsOpen) {
      try {
        const res = await fetch("/api/notifications");
        if (res.ok) {
          const data = await res.json();
          if (data.success) {
            setNotifications(data.notifications || []);
          }
        }
      } catch {}
    }
    setNotificationsOpen((prev) => !prev);
  }

  const totalResults = searchResults
    ? searchResults.emails.length +
      searchResults.contacts.length +
      searchResults.campaigns.length +
      searchResults.templates.length
    : 0;

  return (
    <>
      <header className="sticky top-0 z-40 w-full border-b border-slate-200 bg-white/95 backdrop-blur dark:border-slate-800 dark:bg-slate-900/95">
        <div className="flex h-16 items-center justify-between px-3 sm:px-5 gap-3">
          {/* Left: Hamburger & Brand */}
          <div className="flex items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={toggleSidebar}
              className="p-2 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-full dark:text-slate-300 dark:hover:text-white dark:hover:bg-slate-800 transition-colors"
              title="Toggle sidebar"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="4" x2="20" y1="12" y2="12" />
                <line x1="4" x2="20" y1="6" y2="6" />
                <line x1="4" x2="20" y1="18" y2="18" />
              </svg>
            </button>

            <Link href="/inbox" className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-600 text-white shadow-sm shadow-blue-500/20">
                <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect width="20" height="16" x="2" y="4" rx="2" />
                  <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
                </svg>
              </div>
              <div className="hidden sm:block">
                <span className="text-base font-bold tracking-tight text-slate-900 dark:text-white">
                  {siteConfig.name}
                </span>
                <span className="block text-[10px] font-medium text-slate-400 uppercase tracking-wider">
                  OPSIYS Workspace
                </span>
              </div>
            </Link>
          </div>

          {/* Center: Gmail-style Global Search Bar */}
          <div ref={searchContainerRef} className="relative flex-1 max-w-2xl mx-2 sm:mx-6">
            <div className="relative flex items-center w-full">
              <div className="absolute left-3.5 text-slate-400 pointer-events-none">
                {isSearching ? (
                  <svg className="w-4 h-4 animate-spin text-blue-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                  </svg>
                ) : (
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="11" cy="11" r="8" />
                    <path d="m21 21-4.3-4.3" />
                  </svg>
                )}
              </div>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => {
                  const val = e.target.value;
                  setSearchQuery(val);
                  if (!val.trim()) {
                    setSearchResults(null);
                    setSearchOpen(false);
                  }
                }}
                onFocus={() => {
                  if (searchResults) setSearchOpen(true);
                }}
                placeholder="Search mail, contacts, campaigns..."
                className="w-full h-11 pl-10 pr-9 rounded-full bg-slate-100 hover:bg-slate-200/80 focus:bg-white focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 border border-transparent text-sm text-slate-800 placeholder:text-slate-500 transition-all dark:bg-slate-800 dark:hover:bg-slate-750 dark:focus:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-400"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => {
                    setSearchQuery("");
                    setSearchResults(null);
                    setSearchOpen(false);
                  }}
                  className="absolute right-3 p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors"
                >
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M18 6 6 18M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>

            {/* Live Search Dropdown */}
            {searchOpen && searchResults && (
              <div className="absolute top-12 left-0 right-0 z-50 max-h-[70vh] overflow-y-auto rounded-xl bg-white border border-slate-200 shadow-2xl p-2 dark:bg-slate-900 dark:border-slate-800">
                {totalResults === 0 ? (
                  <div className="p-6 text-center text-xs text-slate-500">
                    No matching results for &ldquo;{searchQuery}&rdquo;
                  </div>
                ) : (
                  <div className="space-y-3">
                    {/* Emails & Replies */}
                    {searchResults.emails.length > 0 && (
                      <div>
                        <h4 className="px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                          Emails & Replies
                        </h4>
                        <div className="space-y-0.5">
                          {searchResults.emails.map((item) => (
                            <button
                              key={item.id}
                              type="button"
                              onClick={() => {
                                setSearchOpen(false);
                                router.push(item.href);
                              }}
                              className="w-full text-left px-3 py-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors flex items-start gap-2.5"
                            >
                              <div className="mt-0.5 text-blue-600">
                                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                  <rect width="20" height="16" x="2" y="4" rx="2" />
                                  <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
                                </svg>
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center justify-between">
                                  <span className="text-xs font-semibold text-slate-800 dark:text-slate-100 truncate">
                                    {item.title}
                                  </span>
                                  {item.badge && (
                                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300 font-medium">
                                      {item.badge}
                                    </span>
                                  )}
                                </div>
                                <p className="text-xs text-slate-600 dark:text-slate-300 truncate">
                                  {item.subtitle}
                                </p>
                                {item.snippet && (
                                  <p className="text-[11px] text-slate-400 truncate mt-0.5">
                                    {item.snippet}
                                  </p>
                                )}
                              </div>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Contacts */}
                    {searchResults.contacts.length > 0 && (
                      <div>
                        <h4 className="px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                          Contacts
                        </h4>
                        <div className="space-y-0.5">
                          {searchResults.contacts.map((item) => (
                            <button
                              key={item.id}
                              type="button"
                              onClick={() => {
                                setSearchOpen(false);
                                router.push(item.href);
                              }}
                              className="w-full text-left px-3 py-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors flex items-center gap-2.5"
                            >
                              <div className="text-emerald-600">
                                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                  <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                                  <circle cx="9" cy="7" r="4" />
                                </svg>
                              </div>
                              <div className="flex-1 min-w-0">
                                <span className="text-xs font-semibold text-slate-800 dark:text-slate-100">
                                  {item.title}
                                </span>
                                <span className="text-xs text-slate-500 block truncate">
                                  {item.subtitle}
                                </span>
                              </div>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Campaigns */}
                    {searchResults.campaigns.length > 0 && (
                      <div>
                        <h4 className="px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                          Campaigns
                        </h4>
                        <div className="space-y-0.5">
                          {searchResults.campaigns.map((item) => (
                            <button
                              key={item.id}
                              type="button"
                              onClick={() => {
                                setSearchOpen(false);
                                router.push(item.href);
                              }}
                              className="w-full text-left px-3 py-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors flex items-center gap-2.5"
                            >
                              <div className="text-amber-600">
                                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                  <path d="m3 11 18-5v12L3 14v-3z" />
                                  <path d="M11.6 16.8a3 3 0 1 1-5.8-1.6" />
                                </svg>
                              </div>
                              <div className="flex-1 min-w-0">
                                <span className="text-xs font-semibold text-slate-800 dark:text-slate-100">
                                  {item.title}
                                </span>
                                <span className="text-xs text-slate-500 block truncate">
                                  {item.subtitle}
                                </span>
                              </div>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Templates */}
                    {searchResults.templates.length > 0 && (
                      <div>
                        <h4 className="px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                          Templates
                        </h4>
                        <div className="space-y-0.5">
                          {searchResults.templates.map((item) => (
                            <button
                              key={item.id}
                              type="button"
                              onClick={() => {
                                setSearchOpen(false);
                                router.push(item.href);
                              }}
                              className="w-full text-left px-3 py-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors flex items-center gap-2.5"
                            >
                              <div className="text-indigo-600">
                                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                  <rect width="18" height="18" x="3" y="3" rx="2" />
                                  <path d="M7 7h10" />
                                  <path d="M7 12h10" />
                                  <path d="M7 17h6" />
                                </svg>
                              </div>
                              <div className="flex-1 min-w-0">
                                <span className="text-xs font-semibold text-slate-800 dark:text-slate-100">
                                  {item.title}
                                </span>
                                <span className="text-xs text-slate-500 block truncate">
                                  {item.subtitle}
                                </span>
                              </div>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Right: Help, Notifications, Settings, User Profile */}
          <div className="flex items-center gap-1 sm:gap-2 shrink-0">
            {/* Help Button (?) */}
            <button
              type="button"
              onClick={() => setHelpOpen(true)}
              className="p-2 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-full dark:text-slate-300 dark:hover:text-white dark:hover:bg-slate-800 transition-colors"
              title="Help & Shortcuts"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <path d="9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
                <path d="M12 17h.01" />
              </svg>
            </button>

            {/* Notifications Button (🔔) */}
            <div ref={notifRef} className="relative">
              <button
                type="button"
                onClick={toggleNotifications}
                className="relative p-2 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-full dark:text-slate-300 dark:hover:text-white dark:hover:bg-slate-800 transition-colors"
                title="Notifications"
              >
                <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
                  <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
                </svg>
                {unreadNotifications > 0 && (
                  <span className="absolute top-1 right-1 flex h-4 min-w-[16px] px-1 items-center justify-center rounded-full bg-rose-500 text-[9px] font-bold text-white shadow-sm">
                    {unreadNotifications > 9 ? "9+" : unreadNotifications}
                  </span>
                )}
              </button>

              {/* Notifications Dropdown */}
              {notificationsOpen && (
                <div className="absolute right-0 top-12 z-50 w-80 sm:w-96 rounded-xl bg-white border border-slate-200 shadow-2xl p-3 dark:bg-slate-900 dark:border-slate-800">
                  <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-100 dark:border-slate-800">
                    <span className="text-xs font-bold text-slate-800 dark:text-slate-100">
                      Notifications & Alerts
                    </span>
                    <span className="text-[10px] text-slate-400">
                      {notifications.length} recent
                    </span>
                  </div>

                  {notifications.length === 0 ? (
                    <p className="py-6 text-center text-xs text-slate-400">
                      No new notifications
                    </p>
                  ) : (
                    <div className="space-y-1.5 max-h-72 overflow-y-auto">
                      {notifications.map((n) => (
                        <Link
                          key={n.id}
                          href={n.href}
                          onClick={() => setNotificationsOpen(false)}
                          className="block p-2 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800/80 transition-colors text-left"
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-semibold text-slate-800 dark:text-slate-200 truncate">
                              {n.title}
                            </span>
                            <span className="text-[10px] text-slate-400 shrink-0 ml-2">
                              {new Date(n.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                            </span>
                          </div>
                          <p className="text-[11px] text-slate-500 dark:text-slate-400 line-clamp-2 mt-0.5">
                            {n.message}
                          </p>
                        </Link>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Settings Link (⚙) */}
            <Link
              href="/settings"
              className="p-2 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-full dark:text-slate-300 dark:hover:text-white dark:hover:bg-slate-800 transition-colors"
              title="Settings"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            </Link>

            {/* User Profile Avatar & Dropdown */}
            {currentUser ? (
              <div ref={profileRef} className="relative">
                <button
                  type="button"
                  onClick={() => setProfileOpen((prev) => !prev)}
                  className="flex items-center justify-center h-8 w-8 rounded-full bg-blue-600 text-white text-xs font-bold hover:ring-2 hover:ring-blue-400 transition-all shadow-sm"
                  title={`${currentUser.name} (${currentUser.businessName})`}
                >
                  {currentUser.name
                    .split(" ")
                    .map((n) => n[0])
                    .slice(0, 2)
                    .join("")
                    .toUpperCase()}
                </button>

                {profileOpen && (
                  <div className="absolute right-0 top-11 z-50 w-64 rounded-xl bg-white border border-slate-200 shadow-2xl p-3 dark:bg-slate-900 dark:border-slate-800">
                    <div className="pb-3 border-b border-slate-100 dark:border-slate-800">
                      <p className="text-xs font-bold text-slate-900 dark:text-white truncate">
                        {currentUser.name}
                      </p>
                      <p className="text-[11px] text-slate-500 truncate">
                        {currentUser.email}
                      </p>
                      <div className="mt-1.5 inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-[10px] text-slate-600 dark:text-slate-300 font-medium">
                        <span>{currentUser.businessName}</span>
                        <span>•</span>
                        <span>{currentUser.role.toUpperCase()}</span>
                      </div>
                    </div>

                    <div className="py-2 space-y-1">
                      <Link
                        href="/settings"
                        onClick={() => setProfileOpen(false)}
                        className="block px-2.5 py-1.5 text-xs text-slate-700 hover:bg-slate-100 rounded-md dark:text-slate-300 dark:hover:bg-slate-800 transition-colors"
                      >
                        Workspace Settings
                      </Link>
                      <Link
                        href="/inbox"
                        onClick={() => setProfileOpen(false)}
                        className="block px-2.5 py-1.5 text-xs text-slate-700 hover:bg-slate-100 rounded-md dark:text-slate-300 dark:hover:bg-slate-800 transition-colors"
                      >
                        Open Reply Inbox
                      </Link>
                    </div>

                    <div className="pt-2 border-t border-slate-100 dark:border-slate-800">
                      <LogoutButton variant="ghost" size="sm" className="w-full justify-start text-xs text-rose-600" />
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <Link
                href="/login"
                className="inline-flex h-8 items-center justify-center rounded-lg bg-blue-600 px-3 text-xs font-semibold text-white hover:bg-blue-700 transition-colors"
              >
                Sign In
              </Link>
            )}
          </div>
        </div>
      </header>

      {/* Help Modal */}
      {helpOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <h3 className="text-base font-bold text-slate-900 dark:text-white">
                Email Automation Platform Help
              </h3>
              <button
                type="button"
                onClick={() => setHelpOpen(false)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-white"
              >
                ✕
              </button>
            </div>
            <div className="mt-4 space-y-3 text-xs text-slate-600 dark:text-slate-300">
              <p>
                <strong>Inbox:</strong> View customer replies, unread messages, attachments, and reply directly from within the application.
              </p>
              <p>
                <strong>Campaigns:</strong> Create multi-step email automations with delays, attachments, personalized templates, and deliverability checks.
              </p>
              <p>
                <strong>Sent:</strong> Review all outbound emails with provider message IDs, delivery timestamps, and status badges.
              </p>
              <p>
                <strong>Global Search:</strong> Quickly find emails, contacts, campaigns, or templates by typing in the top search bar.
              </p>
              <p>
                <strong>Compose:</strong> Click the <em>+ Compose</em> button in the sidebar to send an email with file attachments to any recipient.
              </p>
            </div>
            <div className="mt-6 flex justify-end">
              <button
                type="button"
                onClick={() => setHelpOpen(false)}
                className="px-4 py-2 rounded-lg bg-blue-600 text-white text-xs font-semibold hover:bg-blue-700"
              >
                Got it
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
