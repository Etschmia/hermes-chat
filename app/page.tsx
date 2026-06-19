"use client";

import React, { useState, useEffect } from 'react';
import { Plus, Pin, PinOff, Trash2, MessageCircle, Send } from 'lucide-react';

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

  // Load from localStorage
  useEffect(() => {
    const saved = localStorage.getItem('hermes-chats');
    if (saved) {
      const parsed = JSON.parse(saved);
      setChats(parsed);
      if (parsed.length > 0) {
        setActiveChatId(parsed[0].id);
      }
    }
  }, []);

  // Save to localStorage
  useEffect(() => {
    if (chats.length > 0) {
      localStorage.setItem('hermes-chats', JSON.stringify(chats));
    }
  }, [chats]);

  const activeChat = chats.find(c => c.id === activeChatId);

  const createNewChat = () => {
    const newChat: Chat = {
      id: Date.now().toString(36),
      title: 'Neuer Chat',
      pinned: false,
      messages: [],
      createdAt: new Date().toISOString(),
    };
    const updated = [newChat, ...chats];
    setChats(updated);
    setActiveChatId(newChat.id);
  };

  const deleteChat = (id: string) => {
    const updated = chats.filter(c => c.id !== id);
    setChats(updated);
    
    if (activeChatId === id) {
      setActiveChatId(updated.length > 0 ? updated[0].id : null);
    }
  };

  const togglePin = (id: string) => {
    const updated = chats.map(chat =>
      chat.id === id ? { ...chat, pinned: !chat.pinned } : chat
    );
    setChats(updated);
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
    <div className="flex h-screen bg-[#f8f7f4] font-sans text-[#3a3a3a]">
      {/* Sidebar */}
      <div className="w-72 border-r border-[#e5e3dc] bg-white flex flex-col">
        <div className="p-4 border-b border-[#e5e3dc]">
          <div className="flex items-center justify-between">
            <div>
              <div className="font-semibold text-lg tracking-tight">Hermes</div>
              <div className="text-xs text-[#6b6b6b]">Martuni UI</div>
            </div>
            <button
              onClick={createNewChat}
              className="flex items-center gap-2 px-3 py-2 rounded-xl bg-[#128a63] text-white text-sm font-medium hover:bg-[#0f7554] transition-colors"
            >
              <Plus size={16} /> Neu
            </button>
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
              onClick={() => setActiveChatId(chat.id)}
              className={`group flex items-center gap-3 px-3 py-3 rounded-2xl cursor-pointer transition-all ${
                activeChatId === chat.id 
                  ? 'bg-[#128a63] text-white' 
                  : 'hover:bg-[#f1f0eb]'
              }`}
            >
              <MessageCircle size={18} className={activeChatId === chat.id ? 'text-white' : 'text-[#128a63]'} />
              
              <div className="flex-1 min-w-0">
                <div className="font-medium text-sm truncate pr-2">
                  {chat.title}
                </div>
              </div>

              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  onClick={(e) => { e.stopPropagation(); togglePin(chat.id); }}
                  className="p-1.5 rounded-lg hover:bg-black/10"
                >
                  {chat.pinned ? <PinOff size={14} /> : <Pin size={14} />}
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); deleteChat(chat.id); }}
                  className="p-1.5 rounded-lg hover:bg-black/10 text-red-500"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>

        <div className="p-3 border-t border-[#e5e3dc] text-[10px] text-[#8a8a8a] text-center">
          Chats werden lokal gespeichert
        </div>
      </div>

      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col">
        {activeChat ? (
          <>
            {/* Header */}
            <div className="h-14 border-b border-[#e5e3dc] px-6 flex items-center justify-between bg-white">
              <div className="font-semibold">{activeChat.title}</div>
              <div className="text-xs px-3 py-1 rounded-full bg-[#f1f0eb] text-[#6b6b6b]">
                {activeChat.messages.length} Nachrichten
              </div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-auto p-6 space-y-6 bg-[#f8f7f4]">
              {activeChat.messages.length === 0 && (
                <div className="h-full flex items-center justify-center text-[#6b6b6b] text-sm">
                  Starte die Unterhaltung mit Hermes
                </div>
              )}

              {activeChat.messages.map(msg => (
                <div
                  key={msg.id}
                  className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-[70%] px-5 py-3.5 rounded-3xl text-sm leading-relaxed ${
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
                  <div className="px-5 py-3.5 rounded-3xl bg-white border border-[#e5e3dc] text-sm text-[#6b6b6b]">
                    Hermes denkt nach...
                  </div>
                </div>
              )}
            </div>

            {/* Input */}
            <div className="border-t border-[#e5e3dc] bg-white p-4">
              <div className="flex gap-3 max-w-4xl mx-auto">
                <input
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && sendMessage()}
                  placeholder="Nachricht an Hermes..."
                  className="flex-1 bg-[#f8f7f4] border border-[#e5e3dc] rounded-2xl px-5 py-3 text-sm focus:outline-none focus:border-[#128a63]"
                />
                <button
                  onClick={sendMessage}
                  disabled={!input.trim() || isLoading}
                  className="px-6 rounded-2xl bg-[#128a63] text-white disabled:opacity-50 flex items-center gap-2 hover:bg-[#0f7554] transition-colors"
                >
                  <Send size={18} />
                </button>
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-[#6b6b6b]">
            <div className="text-center">
              <MessageCircle size={48} className="mx-auto mb-4 opacity-40" />
              <p>Erstelle einen neuen Chat um zu beginnen</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
