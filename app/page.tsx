"use client";

import React, { useState, useEffect, useRef } from 'react';
import { Plus, Pin, PinOff, Trash2, MessageCircle, Send, Pencil, Check, X, Menu } from 'lucide-react';

interface Chat {
  id: string;
  title: string;
  pinned: boolean;
  messages: Message[];
  createdAt: string;
}

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

export default function HermesChat() {
  const [chats, setChats] = useState<Chat[]>([]);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [editingChatId, setEditingChatId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');
  // Mobile: the sidebar is an off-canvas drawer. On md+ it is always visible.
  const [sidebarOpen, setSidebarOpen] = useState(false);
  // True once the initial server load has settled — guards the save effect so
  // an empty first render can never overwrite the server store.
  const [loaded, setLoaded] = useState(false);

  const loadedRef = useRef(false);
  const chatsRef = useRef<Chat[]>([]);
  chatsRef.current = chats;
  const pendingRef = useRef(false); // unsynced local changes?
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const pickActive = (list: Chat[]) =>
    setActiveChatId(prev => (list.some(c => c.id === prev) ? prev : list[0]?.id ?? null));

  // --- Load: localStorage cache first (instant paint), then the server store
  //     (authoritative, so the history follows the user across devices). ------
  useEffect(() => {
    let cancelled = false;

    try {
      const cached = localStorage.getItem('hermes-chats');
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed) && parsed.length) {
          setChats(parsed);
          pickActive(parsed);
        }
      }
    } catch {
      /* ignore corrupt cache */
    }

    (async () => {
      try {
        const res = await fetch('/api/chats', { cache: 'no-store' });
        if (res.ok && !cancelled) {
          const data = await res.json();
          const serverChats: Chat[] = Array.isArray(data.chats) ? data.chats : [];
          // Empty server + non-empty local cache = first run after this feature
          // shipped. Keep the local chats; the save effect migrates them up.
          if (!(serverChats.length === 0 && chatsRef.current.length > 0)) {
            setChats(serverChats);
            pickActive(serverChats);
          }
        }
      } catch {
        /* offline → keep whatever the cache gave us */
      } finally {
        if (!cancelled) {
          loadedRef.current = true;
          setLoaded(true);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // --- Save: write the cache immediately, debounce the server sync. -----------
  useEffect(() => {
    if (!loaded) return;
    try {
      localStorage.setItem('hermes-chats', JSON.stringify(chats));
    } catch {
      /* quota / private mode — server is still the source of truth */
    }
    pendingRef.current = true;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try {
        await fetch('/api/chats', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chats: chatsRef.current }),
        });
        pendingRef.current = false;
      } catch {
        /* stays pending; localStorage holds it, pagehide will retry */
      }
    }, 500);
  }, [chats, loaded]);

  // --- Sync on tab hide/show: flush pending writes when backgrounded, pull the
  //     latest when the user returns (key for the desktop↔phone hand-off). -----
  useEffect(() => {
    const flush = () => {
      if (!loadedRef.current || !pendingRef.current) return;
      try {
        fetch('/api/chats', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chats: chatsRef.current }),
          keepalive: true, // allowed to outlive the page on unload
        });
        pendingRef.current = false;
      } catch {
        /* ignore */
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        flush();
        return;
      }
      // Back in the foreground with nothing unsynced → adopt the server state.
      if (pendingRef.current) return;
      fetch('/api/chats', { cache: 'no-store' })
        .then(r => (r.ok ? r.json() : null))
        .then(data => {
          if (!data || !Array.isArray(data.chats) || pendingRef.current) return;
          const serverChats: Chat[] = data.chats;
          if (JSON.stringify(serverChats) !== JSON.stringify(chatsRef.current)) {
            setChats(serverChats);
            pickActive(serverChats);
          }
        })
        .catch(() => {});
    };

    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  const activeChat = chats.find(c => c.id === activeChatId);

  // Keep the conversation pinned to the latest message.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [activeChat?.messages.length, isLoading]);

  const createNewChat = () => {
    const newChat: Chat = {
      id: Date.now().toString(36),
      title: 'Neuer Chat',
      pinned: false,
      messages: [],
      createdAt: new Date().toISOString(),
    };
    setChats([newChat, ...chats]);
    setActiveChatId(newChat.id);
    setSidebarOpen(false);
  };

  const selectChat = (id: string) => {
    setActiveChatId(id);
    setSidebarOpen(false);
  };

  const deleteChat = (id: string) => {
    const updated = chats.filter(c => c.id !== id);
    setChats(updated);

    if (activeChatId === id) {
      setActiveChatId(updated.length > 0 ? updated[0].id : null);
    }
  };

  const togglePin = (id: string) => {
    setChats(chats.map(chat => (chat.id === id ? { ...chat, pinned: !chat.pinned } : chat)));
  };

  const startRename = (chat: Chat) => {
    setEditingChatId(chat.id);
    setEditingTitle(chat.title);
  };

  const cancelRename = () => {
    setEditingChatId(null);
    setEditingTitle('');
  };

  const commitRename = () => {
    if (!editingChatId) return;
    const trimmed = editingTitle.trim();
    if (trimmed) {
      setChats(chats.map(chat => (chat.id === editingChatId ? { ...chat, title: trimmed } : chat)));
    }
    cancelRename();
  };

  const sendMessage = async () => {
    if (!input.trim() || !activeChatId) return;

    const userMessage: Message = {
      id: Date.now().toString(36),
      role: 'user',
      content: input.trim(),
    };

    // Update chat with user message
    const updatedChats = chats.map(chat => {
      if (chat.id === activeChatId) {
        const newMessages = [...chat.messages, userMessage];
        return {
          ...chat,
          messages: newMessages,
          title: chat.messages.length === 0 ? input.trim().slice(0, 40) : chat.title,
        };
      }
      return chat;
    });
    setChats(updatedChats);
    setInput('');
    setIsLoading(true);

    try {
      // Call our internal API route (server-side, no CORS issues). The model is
      // chosen by the server (HERMES_MODEL), so the client doesn't pin one.
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messages: [
            ...activeChat!.messages.map(m => ({ role: m.role, content: m.content })),
            { role: 'user', content: userMessage.content }
          ],
        }),
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        const reason = data?.detail || data?.error || `HTTP ${response.status}`;
        throw new Error(reason);
      }

      const assistantContent = data.choices?.[0]?.message?.content || 'Keine Antwort erhalten.';

      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(36),
        role: 'assistant',
        content: assistantContent,
      };

      const finalChats = updatedChats.map(chat => {
        if (chat.id === activeChatId) {
          return { ...chat, messages: [...chat.messages, assistantMessage] };
        }
        return chat;
      });
      setChats(finalChats);
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Unbekannter Fehler';
      const errorMessage: Message = {
        id: (Date.now() + 1).toString(36),
        role: 'assistant',
        content: `⚠️ Fehler bei der Verbindung zu Hermes: ${detail}`,
      };
      const finalChats = updatedChats.map(chat => {
        if (chat.id === activeChatId) {
          return { ...chat, messages: [...chat.messages, errorMessage] };
        }
        return chat;
      });
      setChats(finalChats);
    } finally {
      setIsLoading(false);
    }
  };

  const sortedChats = [...chats].sort((a, b) => {
    if (a.pinned && !b.pinned) return -1;
    if (!a.pinned && b.pinned) return 1;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });

  return (
    <div className="flex h-dvh overflow-hidden bg-[#f8f7f4] font-sans text-[#3a3a3a]">
      {/* Backdrop — only on mobile while the drawer is open */}
      {sidebarOpen && (
        <div
          onClick={() => setSidebarOpen(false)}
          aria-hidden
          className="fixed inset-0 z-30 bg-black/40 backdrop-blur-sm md:hidden"
        />
      )}

      {/* Sidebar — off-canvas drawer on mobile, static column on md+ */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-[84vw] max-w-xs flex-col border-r border-[#e5e3dc] bg-white transition-transform duration-300 ease-out md:static md:z-auto md:w-72 md:max-w-none md:translate-x-0 md:shadow-none ${
          sidebarOpen ? 'translate-x-0 shadow-2xl' : '-translate-x-full'
        }`}
      >
        <div className="p-4 border-b border-[#e5e3dc]">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="font-display font-semibold text-lg tracking-tight">Hermes</div>
              <div className="text-xs text-[#6b6b6b]">Martuni UI</div>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={createNewChat}
                className="flex items-center gap-2 px-3 py-2 rounded-xl bg-[#128a63] text-white text-sm font-medium hover:bg-[#0f7554] transition-colors"
              >
                <Plus size={16} /> Neu
              </button>
              {/* Close drawer — mobile only */}
              <button
                onClick={() => setSidebarOpen(false)}
                aria-label="Seitenleiste schließen"
                className="md:hidden p-2 rounded-xl text-[#6b6b6b] hover:bg-[#f1f0eb] transition-colors"
              >
                <X size={18} />
              </button>
            </div>
          </div>
        </div>

        {/* Chat List */}
        <div className="flex-1 overflow-auto p-2 space-y-1">
          {sortedChats.length === 0 && (
            <div className="px-4 py-8 text-center text-sm text-[#6b6b6b]">
              Keine Chats vorhanden.<br />Erstelle deinen ersten Chat.
            </div>
          )}

          {sortedChats.map(chat => (
            <div
              key={chat.id}
              onClick={() => selectChat(chat.id)}
              className={`group flex items-center gap-3 px-3 py-3 rounded-2xl cursor-pointer transition-all ${
                activeChatId === chat.id
                  ? 'bg-[#128a63] text-white'
                  : 'hover:bg-[#f1f0eb]'
              }`}
            >
              <MessageCircle size={18} className={`shrink-0 ${activeChatId === chat.id ? 'text-white' : 'text-[#128a63]'}`} />

              {editingChatId === chat.id ? (
                <div className="flex-1 min-w-0 flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                  <input
                    autoFocus
                    value={editingTitle}
                    onChange={(e) => setEditingTitle(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitRename();
                      if (e.key === 'Escape') cancelRename();
                    }}
                    onBlur={commitRename}
                    className="flex-1 min-w-0 bg-white text-[#3a3a3a] border border-[#128a63] rounded-lg px-2 py-1 text-base md:text-sm focus:outline-none"
                  />
                  <button
                    onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); commitRename(); }}
                    className="p-1.5 rounded-lg hover:bg-black/10 text-[#128a63]"
                    title="Speichern"
                  >
                    <Check size={14} />
                  </button>
                  <button
                    onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); cancelRename(); }}
                    className="p-1.5 rounded-lg hover:bg-black/10 text-[#6b6b6b]"
                    title="Abbrechen"
                  >
                    <X size={14} />
                  </button>
                </div>
              ) : (
                <>
                  <div className="flex-1 min-w-0">
                    <div
                      className="font-medium text-sm truncate pr-1"
                      onDoubleClick={(e) => { e.stopPropagation(); startRename(chat); }}
                      title="Doppelklick zum Umbenennen"
                    >
                      {chat.title}
                    </div>
                  </div>

                  {/* Actions: always visible on touch, hover-revealed on desktop */}
                  <div className="flex items-center gap-0.5 shrink-0 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={(e) => { e.stopPropagation(); startRename(chat); }}
                      className="p-2 md:p-1.5 rounded-lg hover:bg-black/10"
                      title="Umbenennen"
                    >
                      <Pencil size={14} />
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); togglePin(chat.id); }}
                      className="p-2 md:p-1.5 rounded-lg hover:bg-black/10"
                      title={chat.pinned ? 'Lösen' : 'Anpinnen'}
                    >
                      {chat.pinned ? <PinOff size={14} /> : <Pin size={14} />}
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); deleteChat(chat.id); }}
                      className={`p-2 md:p-1.5 rounded-lg hover:bg-black/10 ${activeChatId === chat.id ? 'text-red-200' : 'text-red-500'}`}
                      title="Löschen"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>

        <div className="p-3 border-t border-[#e5e3dc] text-[10px] text-[#8a8a8a] text-center">
          Chats werden geräteübergreifend gespeichert
        </div>
      </aside>

      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar — always present so the menu button is reachable */}
        <div className="h-14 shrink-0 border-b border-[#e5e3dc] px-3 md:px-6 flex items-center gap-3 bg-white">
          <button
            onClick={() => setSidebarOpen(true)}
            aria-label="Seitenleiste öffnen"
            className="md:hidden p-2 -ml-1 rounded-xl text-[#3a3a3a] hover:bg-[#f1f0eb] transition-colors"
          >
            <Menu size={22} />
          </button>
          <div className="font-semibold truncate min-w-0">
            {activeChat ? activeChat.title : 'Hermes'}
          </div>
          {activeChat && (
            <div className="ml-auto shrink-0 text-xs px-3 py-1 rounded-full bg-[#f1f0eb] text-[#6b6b6b]">
              {activeChat.messages.length} Nachrichten
            </div>
          )}
        </div>

        {activeChat ? (
          <>
            {/* Messages */}
            <div ref={scrollRef} className="flex-1 overflow-auto p-4 md:p-6 space-y-2.5 md:space-y-3 bg-[#f8f7f4]">
              {activeChat.messages.length === 0 && (
                <div className="h-full flex items-center justify-center text-center text-[#6b6b6b] text-sm px-4">
                  Starte die Unterhaltung mit Hermes
                </div>
              )}

              {activeChat.messages.map(msg => (
                <div
                  key={msg.id}
                  className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-[85%] md:max-w-[70%] px-3.5 md:px-4 py-2 md:py-2.5 rounded-3xl text-sm leading-relaxed whitespace-pre-wrap break-words ${
                      msg.role === 'user'
                        ? 'bg-[#128a63] text-white rounded-br-md'
                        : 'bg-white border border-[#e5e3dc] rounded-bl-md'
                    }`}
                  >
                    {msg.content}
                  </div>
                </div>
              ))}

              {isLoading && (
                <div className="flex justify-start">
                  <div
                    className="flex items-center gap-2.5 px-1.5 py-1 text-[#6b6b6b]"
                    role="status"
                    aria-label="Hermes denkt nach"
                  >
                    <span className="hermes-spinner" aria-hidden />
                    <span className="text-xs">Hermes denkt nach…</span>
                  </div>
                </div>
              )}
            </div>

            {/* Input */}
            <div className="shrink-0 border-t border-[#e5e3dc] bg-white p-3 md:p-4 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
              <div className="flex gap-2 md:gap-3 max-w-4xl mx-auto">
                <input
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && sendMessage()}
                  placeholder="Nachricht an Hermes..."
                  className="flex-1 min-w-0 bg-[#f8f7f4] border border-[#e5e3dc] rounded-2xl px-4 md:px-5 py-3 text-base md:text-sm focus:outline-none focus:border-[#128a63]"
                />
                <button
                  onClick={sendMessage}
                  disabled={!input.trim() || isLoading}
                  className="px-5 md:px-6 rounded-2xl bg-[#128a63] text-white disabled:opacity-50 flex items-center justify-center hover:bg-[#0f7554] transition-colors"
                >
                  <Send size={18} />
                </button>
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-[#6b6b6b] p-6">
            <div className="text-center">
              <MessageCircle size={48} className="mx-auto mb-4 opacity-40" />
              <p className="mb-4">Erstelle einen neuen Chat um zu beginnen</p>
              <button
                onClick={createNewChat}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#128a63] text-white text-sm font-medium hover:bg-[#0f7554] transition-colors"
              >
                <Plus size={16} /> Neuer Chat
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
