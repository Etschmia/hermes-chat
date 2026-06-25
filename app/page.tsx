"use client";

import React, { useState, useEffect, useRef } from 'react';
import { Plus, Pin, PinOff, Trash2, MessageCircle, Send, Pencil, Check, X, Menu, FileText, Upload, Download, Sun, Moon, Copy } from 'lucide-react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { fileToAttachment, toApiContent, type Attachment } from '@hermes/gateway-client/attachments';
import { postChat, assistantText, ChatError } from '@hermes/gateway-client/browser';

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
  attachments?: Attachment[];
}

// Resolve a Markdown image target to something the browser can load. http/data
// URLs are used as-is; a local server path (what the agent returns for a
// generated image) is routed through /api/genimage, which serves it safely.
function imageSrc(p: string, download = false): string {
  if (/^(https?:|data:)/i.test(p)) return p;
  const clean = p.replace(/^file:\/\//, '');
  return `/api/genimage?path=${encodeURIComponent(clean)}${download ? '&download=1' : ''}`;
}

// Markdown image renderer: http/data used as-is; a local server path (what the
// agent returns for a generated image) is routed through /api/genimage, with a
// "download original" link. Deliberately <span>/<a> (inline elements) so nesting
// inside the surrounding <p> stays valid HTML.
function MarkdownImage({ src, alt }: { src?: string; alt?: string }) {
  const url = (src || '').trim().split(/\s+/)[0]; // drop an optional "title"
  if (!url) return null;
  const view = imageSrc(url, false);
  const dl = imageSrc(url, true);
  const fname = (url.split('/').pop() || 'bild').replace(/[?#].*$/, '');
  return (
    <span className="block my-1.5">
      <a href={view} target="_blank" rel="noopener noreferrer" className="block">
        {/* eslint-disable-next-line @next/next/no-img-element -- dynamic generated image, next/image is inappropriate */}
        <img src={view} alt={alt || 'Bild'} className="max-h-80 max-w-full rounded-lg border border-line" />
      </a>
      <a
        href={dl}
        download={fname}
        className="mt-1 inline-flex items-center gap-1 text-xs text-ink-muted hover:text-brand transition-colors"
        title="In Originalgröße herunterladen"
      >
        <Download size={14} /> Original
      </a>
    </span>
  );
}

// Markdown elements tuned for the chat bubble (text-sm; colour inherits from the
// bubble so it stays readable on both the user and assistant background).
const markdownComponents: Components = {
  p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
  ul: ({ children }) => <ul className="mb-2 last:mb-0 list-disc space-y-0.5 pl-5">{children}</ul>,
  ol: ({ children }) => <ol className="mb-2 last:mb-0 list-decimal space-y-0.5 pl-5">{children}</ol>,
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:opacity-80">
      {children}
    </a>
  ),
  h1: ({ children }) => <h1 className="mt-2 mb-1 text-base font-semibold first:mt-0">{children}</h1>,
  h2: ({ children }) => <h2 className="mt-2 mb-1 text-base font-semibold first:mt-0">{children}</h2>,
  h3: ({ children }) => <h3 className="mt-2 mb-1 text-sm font-semibold first:mt-0">{children}</h3>,
  blockquote: ({ children }) => (
    <blockquote className="my-2 border-l-2 border-current/30 pl-3 italic opacity-90">{children}</blockquote>
  ),
  hr: () => <hr className="my-2 border-current/20" />,
  code: ({ children }) => <code className="rounded bg-black/10 px-1 py-0.5 font-mono text-[0.85em]">{children}</code>,
  pre: ({ children }) => (
    <pre className="my-2 overflow-x-auto rounded-lg bg-black/10 p-3 text-xs leading-relaxed [&>code]:bg-transparent [&>code]:p-0 [&>code]:text-[1em]">
      {children}
    </pre>
  ),
  table: ({ children }) => (
    <div className="my-2 overflow-x-auto">
      <table className="w-full border-collapse text-xs">{children}</table>
    </div>
  ),
  th: ({ children }) => <th className="border border-current/20 px-2 py-1 text-left font-semibold">{children}</th>,
  td: ({ children }) => <td className="border border-current/20 px-2 py-1">{children}</td>,
  img: (props) => (
    <MarkdownImage
      src={typeof props.src === 'string' ? props.src : undefined}
      alt={typeof props.alt === 'string' ? props.alt : undefined}
    />
  ),
};

// Render message text as Markdown (GFM). Generated images with a local path are
// resolved via MarkdownImage → /api/genimage. react-markdown renders NO raw HTML
// (no rehype-raw) → no XSS from model output.
function MessageBody({ content }: { content: string }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
      {content}
    </ReactMarkdown>
  );
}

export default function HermesChat() {
  const [chats, setChats] = useState<Chat[]>([]);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [editingChatId, setEditingChatId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');
  // Attachments staged in the composer, plus a transient note for rejected files.
  const [pending, setPending] = useState<Attachment[]>([]);
  const [attachError, setAttachError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Drag & drop: a depth counter rides out dragleave events fired when the
  // cursor crosses child elements, so the overlay doesn't flicker.
  const [isDragging, setIsDragging] = useState(false);
  const dragDepth = useRef(0);
  // Mobile: the sidebar is an off-canvas drawer. On md+ it is always visible.
  const [sidebarOpen, setSidebarOpen] = useState(false);
  // True once the initial server load has settled — guards the save effect so
  // an empty first render can never overwrite the server store.
  const [loaded, setLoaded] = useState(false);
  // Which message was just copied? (brief "Kopiert" feedback on its button)
  const [copiedId, setCopiedId] = useState<string | null>(null);
  // Theme toggle. The inline script in layout.tsx has already set data-theme on
  // <html> before paint (from localStorage / OS pref); we start from a fixed
  // 'light' so the first client render matches the server HTML (no hydration
  // mismatch on the toggle icon), then adopt the real value after mount.
  const [theme, setTheme] = useState<'light' | 'dark'>('light');

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

  // Adopt the theme the inline script resolved before paint, then keep React in
  // sync. Done in an effect (not the useState initializer) so server and first
  // client render agree.
  useEffect(() => {
    const current = document.documentElement.getAttribute('data-theme');
    if (current === 'dark' || current === 'light') setTheme(current);
  }, []);

  const toggleTheme = () => {
    setTheme(prev => {
      const next = prev === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      // Keep the browser-chrome colour in sync (see layout.tsx). The meta is
      // created by the inline script on load, so it's present here. Colours
      // mirror --brand (light) and the dark --surface in globals.css.
      const meta = document.querySelector('meta[name="theme-color"]');
      if (meta) meta.setAttribute('content', next === 'dark' ? '#161c1a' : '#128a63');
      try {
        localStorage.setItem('hermes-theme', next);
      } catch {
        /* private mode / quota — the choice just won't persist */
      }
      return next;
    });
  };

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

  // Turn picked/pasted/dropped files into staged attachments (or surface why not).
  const addFiles = async (list: FileList | File[] | null | undefined) => {
    const arr = Array.from(list ?? []);
    if (arr.length === 0) return;
    setAttachError(null);
    const results = await Promise.all(arr.map(fileToAttachment));
    const atts = results.map(r => r.att).filter((a): a is Attachment => !!a);
    const errs = results.map(r => r.error).filter((e): e is string => !!e);
    if (atts.length) setPending(p => [...p, ...atts]);
    if (errs.length) {
      setAttachError(errs.join(' · '));
      setTimeout(() => setAttachError(null), 6000);
    }
  };

  // Paste handler: grab image/file blobs from the clipboard; leave text pastes
  // to the input's default behaviour.
  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const items = Array.from(e.clipboardData?.items ?? []);
    const files = items
      .filter(it => it.kind === 'file')
      .map(it => it.getAsFile())
      .filter((f): f is File => !!f);
    if (files.length) {
      e.preventDefault();
      addFiles(files);
    }
  };

  const removePending = (id: string) => setPending(p => p.filter(a => a.id !== id));

  // Copy a message's RAW Markdown to the clipboard, with a brief "Kopiert"
  // feedback. Falls back to a temporary <textarea> where the Clipboard API is
  // unavailable (e.g. an insecure origin).
  const copyRawMarkdown = async (id: string, text: string) => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      setCopiedId(id);
      setTimeout(() => setCopiedId(prev => (prev === id ? null : prev)), 1500);
    } catch {
      /* clipboard unavailable — silently ignore */
    }
  };

  // Only react to OS file drags (not text/element drags inside the page).
  const dragHasFiles = (e: React.DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files');

  const onDragEnter = (e: React.DragEvent) => {
    if (!dragHasFiles(e)) return;
    e.preventDefault();
    dragDepth.current += 1;
    setIsDragging(true);
  };
  const onDragOver = (e: React.DragEvent) => {
    if (!dragHasFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  };
  const onDragLeave = (e: React.DragEvent) => {
    if (!dragHasFiles(e)) return;
    dragDepth.current -= 1;
    if (dragDepth.current <= 0) {
      dragDepth.current = 0;
      setIsDragging(false);
    }
  };
  const onDrop = (e: React.DragEvent) => {
    if (!dragHasFiles(e)) return;
    e.preventDefault();
    dragDepth.current = 0;
    setIsDragging(false);
    if (!activeChatId) createNewChat(); // dropping with no chat open starts one
    addFiles(e.dataTransfer.files);
  };

  const sendMessage = async () => {
    const text = input.trim();
    if ((!text && pending.length === 0) || !activeChatId || isLoading) return;

    const atts = pending;
    const userMessage: Message = {
      id: Date.now().toString(36),
      role: 'user',
      content: text,
      attachments: atts.length ? atts : undefined,
    };

    // Update chat with user message
    const updatedChats = chats.map(chat => {
      if (chat.id === activeChatId) {
        const newMessages = [...chat.messages, userMessage];
        return {
          ...chat,
          messages: newMessages,
          title: chat.messages.length === 0 ? (text.slice(0, 40) || atts[0]?.name || '📎 Anhang') : chat.title,
        };
      }
      return chat;
    });
    setChats(updatedChats);
    setInput('');
    setPending([]);
    setIsLoading(true);

    try {
      // Call our internal API route (server-side, no CORS issues). The model is
      // chosen by the server (HERMES_MODEL), so the client doesn't pin one.
      // Each message is mapped to a plain string or OpenAI multimodal parts
      // (images as image_url, text files inlined) — the gateway accepts both.
      const apiMessages = updatedChats
        .find(c => c.id === activeChatId)!
        .messages.map(m => ({ role: m.role, content: toApiContent(m.content, m.attachments) }));

      // postChat owns the timeout, error classification and a narrow,
      // side-effect-safe retry — so a flaky mobile connection no longer
      // collapses into a bare "Failed to fetch" (see app/lib/chatClient.ts).
      const data = await postChat(apiMessages);
      const assistantContent = assistantText(data);

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
      // ChatError already carries a complete, actionable German sentence; for
      // anything unexpected keep the old "Verbindung zu Hermes" framing.
      const content =
        error instanceof ChatError
          ? `⚠️ ${error.message}`
          : `⚠️ Fehler bei der Verbindung zu Hermes: ${error instanceof Error ? error.message : 'Unbekannter Fehler'}`;
      const errorMessage: Message = {
        id: (Date.now() + 1).toString(36),
        role: 'assistant',
        content,
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
    <div className="flex h-dvh overflow-hidden bg-app font-sans text-ink">
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
        className={`fixed inset-y-0 left-0 z-40 flex w-[84vw] max-w-xs flex-col border-r border-line bg-surface transition-transform duration-300 ease-out md:static md:z-auto md:w-72 md:max-w-none md:translate-x-0 md:shadow-none ${
          sidebarOpen ? 'translate-x-0 shadow-2xl' : '-translate-x-full'
        }`}
      >
        <div className="p-4 border-b border-line">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="font-display font-semibold text-lg tracking-tight">Hermes</div>
              <div className="text-xs text-ink-muted">Martuni UI</div>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={createNewChat}
                className="flex items-center gap-2 px-3 py-2 rounded-xl bg-brand text-white text-sm font-medium hover:bg-brand-strong transition-colors"
              >
                <Plus size={16} /> Neu
              </button>
              {/* Close drawer — mobile only */}
              <button
                onClick={() => setSidebarOpen(false)}
                aria-label="Seitenleiste schließen"
                className="md:hidden p-2 rounded-xl text-ink-muted hover:bg-surface-hover transition-colors"
              >
                <X size={18} />
              </button>
            </div>
          </div>
        </div>

        {/* Chat List */}
        <div className="flex-1 overflow-auto p-2 space-y-1">
          {sortedChats.length === 0 && (
            <div className="px-4 py-8 text-center text-sm text-ink-muted">
              Keine Chats vorhanden.<br />Erstelle deinen ersten Chat.
            </div>
          )}

          {sortedChats.map(chat => (
            <div
              key={chat.id}
              onClick={() => selectChat(chat.id)}
              className={`group flex items-center gap-3 px-3 py-3 rounded-2xl cursor-pointer transition-all ${
                activeChatId === chat.id
                  ? 'bg-brand text-white'
                  : 'hover:bg-surface-hover'
              }`}
            >
              <MessageCircle size={18} className={`shrink-0 ${activeChatId === chat.id ? 'text-white' : 'text-brand'}`} />

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
                    className="flex-1 min-w-0 bg-surface text-ink border border-brand rounded-lg px-2 py-1 text-base md:text-sm focus:outline-none"
                  />
                  <button
                    onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); commitRename(); }}
                    className="p-1.5 rounded-lg hover:bg-black/10 text-brand"
                    title="Speichern"
                  >
                    <Check size={14} />
                  </button>
                  <button
                    onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); cancelRename(); }}
                    className="p-1.5 rounded-lg hover:bg-black/10 text-ink-muted"
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

        <div className="border-t border-line">
          <button
            onClick={toggleTheme}
            aria-label={theme === 'dark' ? 'Zum hellen Modus wechseln' : 'Zum dunklen Modus wechseln'}
            title={theme === 'dark' ? 'Heller Modus' : 'Dunkler Modus'}
            className="flex w-full items-center gap-3 px-4 py-3 text-sm text-ink-muted hover:bg-surface-hover transition-colors"
          >
            {theme === 'dark' ? <Sun size={18} className="text-brand" /> : <Moon size={18} className="text-brand" />}
            <span>{theme === 'dark' ? 'Heller Modus' : 'Dunkler Modus'}</span>
          </button>
          <div className="px-3 pb-3 text-[10px] text-ink-faint text-center">
            Chats werden geräteübergreifend gespeichert
          </div>
        </div>
      </aside>

      {/* Main Chat Area */}
      <div
        className="relative flex-1 flex flex-col min-w-0"
        onDragEnter={onDragEnter}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        {/* Drag & drop overlay — visual only; the drop is handled on the column */}
        {isDragging && (
          <div className="absolute inset-0 z-20 m-2 rounded-2xl border-2 border-dashed border-brand bg-brand/10 backdrop-blur-[1px] flex items-center justify-center pointer-events-none">
            <div className="flex flex-col items-center gap-2 text-brand">
              <Upload size={28} />
              <div className="text-sm font-medium">Dateien hier ablegen</div>
            </div>
          </div>
        )}

        {/* Top bar — always present so the menu button is reachable */}
        <div className="h-14 shrink-0 border-b border-line px-3 md:px-6 flex items-center gap-3 bg-surface">
          <button
            onClick={() => setSidebarOpen(true)}
            aria-label="Seitenleiste öffnen"
            className="md:hidden p-2 -ml-1 rounded-xl text-ink hover:bg-surface-hover transition-colors"
          >
            <Menu size={22} />
          </button>
          <div className="font-semibold truncate min-w-0">
            {activeChat ? activeChat.title : 'Hermes'}
          </div>
          {activeChat && (
            <div className="ml-auto shrink-0 text-xs px-3 py-1 rounded-full bg-surface-hover text-ink-muted">
              {activeChat.messages.length} Nachrichten
            </div>
          )}
        </div>

        {activeChat ? (
          <>
            {/* Messages */}
            <div ref={scrollRef} className="flex-1 overflow-auto p-4 md:p-6 space-y-2.5 md:space-y-3 bg-app">
              {activeChat.messages.length === 0 && (
                <div className="h-full flex items-center justify-center text-center text-ink-muted text-sm px-4">
                  Starte die Unterhaltung mit Hermes
                </div>
              )}

              {activeChat.messages.map(msg => (
                <div
                  key={msg.id}
                  className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`group max-w-[85%] md:max-w-[70%] px-3.5 md:px-4 py-2 md:py-2.5 rounded-3xl text-sm leading-relaxed break-words ${
                      msg.role === 'user'
                        ? 'bg-brand text-white rounded-br-md'
                        : 'bg-surface border border-line rounded-bl-md'
                    }`}
                  >
                    {msg.attachments && msg.attachments.length > 0 && (
                      <div className={`flex flex-wrap gap-2 ${msg.content ? 'mb-2' : ''}`}>
                        {msg.attachments.map(a =>
                          a.kind === 'image' ? (
                            <a key={a.id} href={a.dataUrl} target="_blank" rel="noopener noreferrer" className="block">
                              {/* eslint-disable-next-line @next/next/no-img-element -- data-URL attachment, next/image is inappropriate */}
                              <img
                                src={a.dataUrl}
                                alt={a.name}
                                className="max-h-44 max-w-[12rem] rounded-lg border border-black/10 object-cover"
                              />
                            </a>
                          ) : (
                            <span
                              key={a.id}
                              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs ${
                                msg.role === 'user' ? 'bg-white/15' : 'bg-surface-hover text-ink'
                              }`}
                              title={a.name}
                            >
                              <FileText size={13} className="shrink-0" />
                              <span className="truncate max-w-[10rem]">{a.name}</span>
                            </span>
                          )
                        )}
                      </div>
                    )}
                    {msg.content && <div><MessageBody content={msg.content} /></div>}
                    {/* Inline copy of the RAW Markdown (mainly for assistant answers). */}
                    {msg.content && (
                      <div className={`mt-1 flex ${msg.role === 'user' ? 'justify-start' : 'justify-end'}`}>
                        <button
                          onClick={() => copyRawMarkdown(msg.id, msg.content)}
                          aria-label="Rohes Markdown kopieren"
                          title="Rohes Markdown kopieren"
                          className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] opacity-100 transition-opacity hover:bg-black/10 md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100 ${
                            msg.role === 'user' ? 'text-white/80' : 'text-ink-muted'
                          }`}
                        >
                          {copiedId === msg.id ? <Check size={13} /> : <Copy size={13} />}
                          <span>{copiedId === msg.id ? 'Kopiert' : 'Kopieren'}</span>
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ))}

              {isLoading && (
                <div className="flex justify-start">
                  <div
                    className="flex items-center gap-2.5 px-1.5 py-1 text-ink-muted"
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
            <div className="shrink-0 border-t border-line bg-surface p-3 md:p-4 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
              <div className="max-w-4xl mx-auto">
                {/* Staged attachments (pre-send preview) */}
                {pending.length > 0 && (
                  <div className="flex flex-wrap gap-2 mb-2">
                    {pending.map(a => (
                      <div key={a.id} className="relative">
                        {a.kind === 'image' ? (
                          // eslint-disable-next-line @next/next/no-img-element -- data-URL attachment, next/image is inappropriate
                          <img
                            src={a.dataUrl}
                            alt={a.name}
                            className="h-16 w-16 rounded-lg border border-line object-cover"
                          />
                        ) : (
                          <span
                            className="inline-flex items-center gap-1.5 h-16 px-3 rounded-lg border border-line bg-app text-xs text-ink"
                            title={a.name}
                          >
                            <FileText size={14} className="shrink-0 text-brand" />
                            <span className="truncate max-w-[8rem]">{a.name}</span>
                          </span>
                        )}
                        <button
                          onClick={() => removePending(a.id)}
                          aria-label={`${a.name} entfernen`}
                          className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-[#3a3a3a] text-white flex items-center justify-center shadow hover:bg-black"
                        >
                          <X size={12} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {attachError && <div className="mb-2 text-xs text-red-500">{attachError}</div>}

                <div className="flex gap-2 md:gap-3 items-end">
                  {/* Hidden picker + plus button */}
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    accept="image/*,.txt,.md,.markdown,.csv,.tsv,.json,.yaml,.yml,.xml,.html,.css,.js,.ts,.tsx,.jsx,.py,.rb,.go,.rs,.java,.c,.cpp,.h,.sh,.sql,.toml,.ini,.conf,.log,.env"
                    className="hidden"
                    onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }}
                  />
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    aria-label="Datei anhängen"
                    title="Bild oder Datei anhängen"
                    className="shrink-0 w-11 h-11 rounded-2xl border border-line bg-app text-brand flex items-center justify-center hover:bg-surface-hover transition-colors"
                  >
                    <Plus size={20} />
                  </button>

                  <input
                    type="text"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && sendMessage()}
                    onPaste={handlePaste}
                    placeholder="Nachricht an Hermes…"
                    className="flex-1 min-w-0 bg-app border border-line rounded-2xl px-4 md:px-5 py-3 text-base md:text-sm focus:outline-none focus:border-brand"
                  />
                  <button
                    onClick={sendMessage}
                    disabled={(!input.trim() && pending.length === 0) || isLoading}
                    className="shrink-0 w-11 h-11 md:w-auto md:px-6 rounded-2xl bg-brand text-white disabled:opacity-50 flex items-center justify-center hover:bg-brand-strong transition-colors"
                  >
                    <Send size={18} />
                  </button>
                </div>
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-ink-muted p-6">
            <div className="text-center">
              <MessageCircle size={48} className="mx-auto mb-4 opacity-40" />
              <p className="mb-4">Erstelle einen neuen Chat um zu beginnen</p>
              <button
                onClick={createNewChat}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-brand text-white text-sm font-medium hover:bg-brand-strong transition-colors"
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
