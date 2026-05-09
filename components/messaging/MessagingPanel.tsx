"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  API_BASE_URL,
  messagingListConversations,
  messagingListMessages,
  messagingMarkRead,
  messagingSearchContacts,
  messagingSendMessage,
  messagingStartDirect,
  type MessagingCompanySummaryDto,
  type MessagingConversationDto,
  type MessagingMessageDto,
} from "@/lib/api";
import { resolveCompanyLogoImgSrc } from "@/lib/inventoryExport";

const POLL_INTERVAL_MS = 6000;

type Props = {
  /**
   * Visual variant: `desktop` is a 3-pane layout (sidebar + thread); `mobile` shows one pane at a time
   * (list, then thread). Both share the same data layer.
   */
  variant?: "desktop" | "mobile";
  /** Optional max-height; defaults to a comfortable viewport height. */
  maxHeight?: number | string;
  /** Optional className/style overrides for the outer wrapper (e.g. when embedding in a card). */
  className?: string;
  style?: CSSProperties;
};

export default function MessagingPanel({
  variant = "desktop",
  maxHeight,
  className,
  style,
}: Props) {
  const [conversations, setConversations] = useState<MessagingConversationDto[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<MessagingMessageDto[]>([]);
  const [hasMoreOlder, setHasMoreOlder] = useState(false);
  const [loadingList, setLoadingList] = useState(true);
  const [loadingThread, setLoadingThread] = useState(false);
  const [composer, setComposer] = useState("");
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState("");
  const [composerErr, setComposerErr] = useState("");
  const [contactsOpen, setContactsOpen] = useState(false);
  const [mobileShowThread, setMobileShowThread] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const activeConversation = useMemo(
    () => conversations.find((c) => c.id === activeId) || null,
    [conversations, activeId],
  );

  const loadConversations = useCallback(async () => {
    try {
      const out = await messagingListConversations();
      setConversations(out.conversations);
      setErr("");
      return out.conversations;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Could not load conversations.";
      setErr(msg);
      return null;
    } finally {
      setLoadingList(false);
    }
  }, []);

  useEffect(() => {
    void loadConversations();
  }, [loadConversations]);

  const loadMessages = useCallback(async (conversationId: string) => {
    setLoadingThread(true);
    try {
      const out = await messagingListMessages(conversationId, { limit: 60 });
      setMessages(out.messages);
      setHasMoreOlder(out.hasMore);
      setErr("");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Could not load messages.";
      setErr(msg);
    } finally {
      setLoadingThread(false);
    }
  }, []);

  useEffect(() => {
    if (!activeId) {
      setMessages([]);
      return;
    }
    void loadMessages(activeId);
    void messagingMarkRead(activeId).catch(() => {
      /* read marker failures are non-fatal */
    });
  }, [activeId, loadMessages]);

  // Background polling: refresh both the list and the active thread every few seconds while mounted. Cheaper than
  // websockets and matches the rest of the codebase (no WS infra). Auto-pause when document is hidden.
  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      if (cancelled || (typeof document !== "undefined" && document.hidden)) return;
      try {
        const fresh = await messagingListConversations();
        if (cancelled) return;
        setConversations(fresh.conversations);
        if (activeId) {
          const out = await messagingListMessages(activeId, { limit: 60 });
          if (cancelled) return;
          setMessages(out.messages);
          setHasMoreOlder(out.hasMore);
        }
      } catch {
        /* silent — keep last good state, keep polling */
      }
    };
    const id = setInterval(tick, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [activeId]);

  // Keep the thread scrolled to the latest message when new messages arrive or the active thread changes.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages.length, activeId]);

  const handleSelect = useCallback(
    (conversationId: string) => {
      setActiveId(conversationId);
      setMobileShowThread(true);
      setComposerErr("");
    },
    [],
  );

  const handleStartConversation = useCallback(
    async (otherCompanyId: string) => {
      setContactsOpen(false);
      setErr("");
      try {
        const out = await messagingStartDirect(otherCompanyId);
        const fresh = await loadConversations();
        const found = (fresh ?? []).find((c) => c.id === out.conversationId);
        setActiveId(out.conversationId);
        setMobileShowThread(true);
        if (!found) {
          /** Newly created — may not yet appear in the freshly fetched list because of write/read race; load alone. */
          await loadMessages(out.conversationId);
        }
      } catch (e: unknown) {
        setErr(e instanceof Error ? e.message : "Could not start conversation.");
      }
    },
    [loadConversations, loadMessages],
  );

  const handleSend = useCallback(
    async (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      if (!activeId) return;
      const body = composer.trim();
      if (!body) return;
      setSending(true);
      setComposerErr("");
      try {
        const out = await messagingSendMessage(activeId, body);
        setMessages((prev) => [...prev, out.message]);
        setComposer("");
        // Refresh conversations sidebar so this thread jumps to the top with the new "last message".
        void loadConversations();
      } catch (e: unknown) {
        setComposerErr(e instanceof Error ? e.message : "Message failed to send.");
      } finally {
        setSending(false);
      }
    },
    [activeId, composer, loadConversations],
  );

  const showThread = variant === "desktop" ? true : mobileShowThread;
  const showList = variant === "desktop" ? true : !mobileShowThread;

  return (
    <div
      className={className}
      style={{
        position: "relative",
        display: "grid",
        gridTemplateColumns: variant === "desktop" ? "minmax(260px, 340px) 1fr" : "1fr",
        gap: variant === "desktop" ? 0 : undefined,
        background: "linear-gradient(165deg, rgba(15,23,42,0.98), rgba(2,6,23,0.96))",
        border: "1px solid rgba(99,102,241,0.25)",
        borderRadius: 18,
        overflow: "hidden",
        height: typeof maxHeight === "number" ? `${maxHeight}px` : maxHeight ?? "min(78vh, 720px)",
        ...style,
      }}
    >
      {showList ? (
        <ConversationListPane
          conversations={conversations}
          loading={loadingList}
          activeId={activeId}
          onSelect={handleSelect}
          onOpenContacts={() => setContactsOpen(true)}
          variant={variant}
        />
      ) : null}
      {showThread ? (
        <ThreadPane
          conversation={activeConversation}
          messages={messages}
          loading={loadingThread}
          hasMoreOlder={hasMoreOlder}
          composer={composer}
          setComposer={setComposer}
          composerErr={composerErr}
          sending={sending}
          onSend={handleSend}
          variant={variant}
          onBackToList={() => setMobileShowThread(false)}
          err={err}
          messagesEndRef={messagesEndRef}
          scrollRef={scrollRef}
        />
      ) : null}
      {contactsOpen ? (
        <ContactsModal
          onClose={() => setContactsOpen(false)}
          onPick={handleStartConversation}
        />
      ) : null}
    </div>
  );
}

function ConversationListPane({
  conversations,
  loading,
  activeId,
  onSelect,
  onOpenContacts,
  variant,
}: {
  conversations: MessagingConversationDto[];
  loading: boolean;
  activeId: string | null;
  onSelect: (id: string) => void;
  onOpenContacts: () => void;
  variant: "desktop" | "mobile";
}) {
  return (
    <aside
      style={{
        borderRight: variant === "desktop" ? "1px solid rgba(51,65,85,0.55)" : "none",
        background: "rgba(2,6,23,0.6)",
        display: "flex",
        flexDirection: "column",
        minWidth: 0,
      }}
    >
      <div style={{ padding: "18px 18px 12px", borderBottom: "1px solid rgba(51,65,85,0.5)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 900, color: "#f8fafc", letterSpacing: "-0.01em" }}>
            Messages
          </h2>
          <button
            type="button"
            onClick={onOpenContacts}
            style={{
              padding: "8px 12px",
              borderRadius: 12,
              border: "1px solid rgba(167,139,250,0.55)",
              background: "linear-gradient(135deg, rgba(124,58,237,0.55), rgba(99,102,241,0.45))",
              color: "#f5f3ff",
              fontSize: 12,
              fontWeight: 800,
              cursor: "pointer",
              whiteSpace: "nowrap",
            }}
          >
            ✎ New
          </button>
        </div>
        <p style={{ margin: "6px 0 0", fontSize: 12, color: "#64748b" }}>
          Direct messages with companies on NexBatch.
        </p>
      </div>
      <div style={{ flex: 1, overflowY: "auto", padding: "8px 8px 16px" }}>
        {loading ? (
          <div style={{ padding: 24, color: "#94a3b8", fontSize: 13 }}>Loading conversations…</div>
        ) : conversations.length === 0 ? (
          <div
            style={{
              padding: 22,
              borderRadius: 14,
              border: "1px dashed rgba(148,163,184,0.3)",
              color: "#94a3b8",
              fontSize: 13,
              textAlign: "center",
              margin: 8,
            }}
          >
            No conversations yet.
            <br />
            Click <span style={{ color: "#a5b4fc", fontWeight: 700 }}>New</span> to message a company.
          </div>
        ) : (
          conversations.map((c) => (
            <ConversationListItem
              key={c.id}
              conversation={c}
              active={c.id === activeId}
              onClick={() => onSelect(c.id)}
            />
          ))
        )}
      </div>
    </aside>
  );
}

function ConversationListItem({
  conversation,
  active,
  onClick,
}: {
  conversation: MessagingConversationDto;
  active: boolean;
  onClick: () => void;
}) {
  const main = conversation.participants[0] || null;
  const subtitle =
    conversation.lastMessage?.body.replace(/\s+/g, " ") || "New conversation";
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "stretch",
        gap: 10,
        width: "100%",
        textAlign: "left",
        padding: "10px 12px",
        marginBottom: 4,
        borderRadius: 12,
        border: active ? "1px solid rgba(167,139,250,0.55)" : "1px solid transparent",
        background: active ? "rgba(76,29,149,0.35)" : "transparent",
        color: "#e2e8f0",
        cursor: "pointer",
      }}
    >
      <CompanyAvatar company={main} size={40} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
          <span
            style={{
              fontSize: 14,
              fontWeight: 800,
              color: "#f8fafc",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              maxWidth: 180,
            }}
          >
            {main?.name || conversation.title || "Conversation"}
          </span>
          <span style={{ fontSize: 11, color: "#64748b", flexShrink: 0 }}>
            {formatShortTime(conversation.lastMessageAt)}
          </span>
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 6,
            marginTop: 4,
          }}
        >
          <span
            style={{
              fontSize: 12,
              color: conversation.unreadCount > 0 ? "#e2e8f0" : "#64748b",
              fontWeight: conversation.unreadCount > 0 ? 700 : 500,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              maxWidth: 200,
            }}
          >
            {subtitle}
          </span>
          {conversation.unreadCount > 0 ? (
            <span
              style={{
                fontSize: 10,
                fontWeight: 900,
                padding: "2px 7px",
                borderRadius: 999,
                background: "rgba(139,92,246,0.85)",
                color: "#fff",
              }}
            >
              {conversation.unreadCount > 99 ? "99+" : conversation.unreadCount}
            </span>
          ) : null}
        </div>
      </div>
    </button>
  );
}

function ThreadPane({
  conversation,
  messages,
  loading,
  hasMoreOlder,
  composer,
  setComposer,
  composerErr,
  sending,
  onSend,
  variant,
  onBackToList,
  err,
  scrollRef,
}: {
  conversation: MessagingConversationDto | null;
  messages: MessagingMessageDto[];
  loading: boolean;
  hasMoreOlder: boolean;
  composer: string;
  setComposer: (v: string) => void;
  composerErr: string;
  sending: boolean;
  onSend: (e: FormEvent<HTMLFormElement>) => Promise<void>;
  variant: "desktop" | "mobile";
  onBackToList: () => void;
  err: string;
  messagesEndRef: React.RefObject<HTMLDivElement | null>;
  scrollRef: React.RefObject<HTMLDivElement | null>;
}) {
  const main = conversation?.participants[0] || null;
  return (
    <section style={{ display: "flex", flexDirection: "column", minWidth: 0, background: "rgba(2,6,23,0.55)" }}>
      <header
        style={{
          padding: "14px 18px",
          borderBottom: "1px solid rgba(51,65,85,0.5)",
          display: "flex",
          alignItems: "center",
          gap: 10,
        }}
      >
        {variant === "mobile" ? (
          <button
            type="button"
            onClick={onBackToList}
            aria-label="Back to conversations"
            style={{
              padding: "6px 10px",
              borderRadius: 10,
              border: "1px solid rgba(148,163,184,0.4)",
              background: "rgba(15,23,42,0.85)",
              color: "#e2e8f0",
              cursor: "pointer",
              fontSize: 16,
            }}
          >
            ←
          </button>
        ) : null}
        {conversation ? (
          <>
            <CompanyAvatar company={main} size={42} />
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ fontSize: 16, fontWeight: 900, color: "#f8fafc" }}>
                  {main?.name || conversation.title || "Conversation"}
                </span>
                <VerifiedDot />
              </div>
              <div style={{ fontSize: 12, color: "#94a3b8" }}>
                {conversation.participants.length === 1
                  ? "Direct message"
                  : `${conversation.participants.length + 1} members`}
              </div>
            </div>
          </>
        ) : (
          <div style={{ color: "#94a3b8", fontSize: 14 }}>Select a conversation to start chatting.</div>
        )}
      </header>

      <div
        ref={scrollRef}
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "16px 18px",
          display: "flex",
          flexDirection: "column",
          gap: 8,
        }}
      >
        {!conversation ? (
          <EmptyThreadHint />
        ) : loading && messages.length === 0 ? (
          <div style={{ color: "#94a3b8", fontSize: 13 }}>Loading messages…</div>
        ) : messages.length === 0 ? (
          <div style={{ color: "#64748b", fontSize: 13 }}>
            No messages yet. Say hello to {main?.name || "this company"} 👋
          </div>
        ) : (
          <>
            {hasMoreOlder ? (
              <div style={{ textAlign: "center", color: "#475569", fontSize: 11, marginBottom: 4 }}>
                Older messages truncated — load full history coming soon.
              </div>
            ) : null}
            {messages.map((m, i) => (
              <MessageBubble key={m.id} message={m} prev={messages[i - 1] || null} />
            ))}
          </>
        )}
        {err ? (
          <div style={{ color: "#fca5a5", fontSize: 12, marginTop: 8 }}>{err}</div>
        ) : null}
      </div>

      <form
        onSubmit={onSend}
        style={{
          padding: "12px 14px",
          borderTop: "1px solid rgba(51,65,85,0.5)",
          display: "flex",
          flexDirection: "column",
          gap: 6,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <input
            value={composer}
            onChange={(e) => setComposer(e.target.value)}
            placeholder={conversation ? "Type a message…" : "Pick a conversation to start typing"}
            disabled={!conversation || sending}
            maxLength={8000}
            style={{
              flex: 1,
              padding: "10px 12px",
              borderRadius: 14,
              border: "1px solid rgba(148,163,184,0.35)",
              background: "rgba(15,23,42,0.85)",
              color: "#f8fafc",
              fontSize: 14,
              outline: "none",
              opacity: conversation ? 1 : 0.6,
            }}
          />
          <button
            type="submit"
            disabled={!conversation || sending || !composer.trim()}
            style={{
              minWidth: 44,
              height: 44,
              borderRadius: 14,
              border: "none",
              background:
                !conversation || !composer.trim()
                  ? "rgba(76,29,149,0.4)"
                  : "linear-gradient(135deg, #a855f7, #6366f1)",
              color: "#fff",
              fontSize: 18,
              fontWeight: 900,
              cursor: !conversation || sending || !composer.trim() ? "not-allowed" : "pointer",
              boxShadow: !conversation || !composer.trim() ? "none" : "0 8px 20px rgba(99,102,241,0.35)",
            }}
            aria-label="Send message"
          >
            {sending ? "…" : "➤"}
          </button>
        </div>
        {composerErr ? (
          <div style={{ color: "#fca5a5", fontSize: 12 }}>{composerErr}</div>
        ) : null}
      </form>
    </section>
  );
}

function MessageBubble({
  message,
  prev,
}: {
  message: MessagingMessageDto;
  prev: MessagingMessageDto | null;
}) {
  const sameSender = !!prev && prev.senderCompanyId === message.senderCompanyId;
  const showHeader = !sameSender;
  const time = formatClockTime(message.createdAt);
  return (
    <div
      style={{
        display: "flex",
        justifyContent: message.mine ? "flex-end" : "flex-start",
        marginTop: showHeader ? 8 : 2,
      }}
    >
      <div
        style={{
          maxWidth: "75%",
          padding: "10px 12px",
          borderRadius: 14,
          background: message.mine
            ? "linear-gradient(135deg, rgba(124,58,237,0.85), rgba(99,102,241,0.78))"
            : "rgba(30,41,59,0.85)",
          color: message.mine ? "#fff" : "#e2e8f0",
          border: message.mine ? "1px solid rgba(167,139,250,0.4)" : "1px solid rgba(71,85,105,0.55)",
          boxShadow: message.mine ? "0 4px 12px rgba(99,102,241,0.25)" : "none",
        }}
      >
        {showHeader && !message.mine ? (
          <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 4, fontWeight: 700 }}>
            {message.senderUserEmail || "Member"}
          </div>
        ) : null}
        <div style={{ fontSize: 14, lineHeight: 1.45, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
          {message.body}
        </div>
        <div style={{ fontSize: 10, color: message.mine ? "#ddd6fe" : "#64748b", textAlign: "right", marginTop: 4 }}>
          {time}
        </div>
      </div>
    </div>
  );
}

function ContactsModal({
  onClose,
  onPick,
}: {
  onClose: () => void;
  onPick: (companyId: string) => void;
}) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<MessagingCompanySummaryDto[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      setLoading(true);
      setErr("");
      try {
        const out = await messagingSearchContacts(q, 25);
        if (!cancelled) setResults(out.contacts);
      } catch (e: unknown) {
        if (!cancelled) setErr(e instanceof Error ? e.message : "Could not search contacts.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    const id = setTimeout(run, 220);
    return () => {
      cancelled = true;
      clearTimeout(id);
    };
  }, [q]);

  return (
    <div
      role="presentation"
      onMouseDown={onClose}
      style={{
        position: "absolute",
        inset: 0,
        background: "rgba(2,6,23,0.65)",
        backdropFilter: "blur(6px)",
        WebkitBackdropFilter: "blur(6px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 18,
        zIndex: 50,
      }}
    >
      <div
        onMouseDown={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 480,
          maxHeight: "80vh",
          overflow: "hidden",
          background: "linear-gradient(165deg, rgba(15,23,42,0.98), rgba(2,6,23,0.98))",
          border: "1px solid rgba(167,139,250,0.45)",
          borderRadius: 18,
          boxShadow: "0 28px 70px rgba(0,0,0,0.55)",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div style={{ padding: "16px 18px", borderBottom: "1px solid rgba(51,65,85,0.55)" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 900, color: "#f8fafc" }}>New message</h3>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close contact picker"
              style={{
                background: "transparent",
                border: "none",
                color: "#94a3b8",
                fontSize: 22,
                cursor: "pointer",
              }}
            >
              ×
            </button>
          </div>
          <p style={{ margin: "6px 0 10px", fontSize: 12, color: "#94a3b8" }}>
            Search any company on NexBatch to start a direct message.
          </p>
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search companies by name or slug…"
            style={{
              width: "100%",
              padding: "10px 12px",
              borderRadius: 12,
              border: "1px solid rgba(148,163,184,0.35)",
              background: "rgba(15,23,42,0.9)",
              color: "#f8fafc",
              fontSize: 14,
              outline: "none",
              boxSizing: "border-box",
            }}
          />
        </div>
        <div style={{ overflowY: "auto", padding: "8px 8px 14px", flex: 1 }}>
          {loading ? (
            <div style={{ padding: 16, color: "#94a3b8", fontSize: 13 }}>Searching…</div>
          ) : err ? (
            <div style={{ padding: 16, color: "#fca5a5", fontSize: 13 }}>{err}</div>
          ) : results.length === 0 ? (
            <div style={{ padding: 16, color: "#64748b", fontSize: 13 }}>
              {q.trim() ? "No companies match that search." : "Start typing to find a company."}
            </div>
          ) : (
            results.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => onPick(c.id)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  width: "100%",
                  padding: "10px 12px",
                  marginBottom: 4,
                  borderRadius: 12,
                  border: "1px solid transparent",
                  background: "transparent",
                  color: "#e2e8f0",
                  cursor: "pointer",
                  textAlign: "left",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "rgba(76,29,149,0.32)";
                  e.currentTarget.style.borderColor = "rgba(167,139,250,0.45)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "transparent";
                  e.currentTarget.style.borderColor = "transparent";
                }}
              >
                <CompanyAvatar company={c} size={38} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 800, color: "#f8fafc" }}>{c.name}</div>
                  <div style={{ fontSize: 11, color: "#64748b" }}>{c.slug}</div>
                </div>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function CompanyAvatar({
  company,
  size,
}: {
  company: MessagingCompanySummaryDto | null;
  size: number;
}) {
  const initials = company?.initials || "?";
  const logoSrc = company?.logoUrl ? resolveCompanyLogoImgSrc(company.logoUrl, API_BASE_URL) : "";
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        background: "linear-gradient(135deg,#a855f7,#6366f1)",
        display: "grid",
        placeItems: "center",
        color: "#fff",
        fontWeight: 900,
        fontSize: Math.round(size * 0.36),
        flexShrink: 0,
        overflow: "hidden",
      }}
    >
      {logoSrc ? (
        <img
          src={logoSrc}
          alt=""
          loading="lazy"
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
        />
      ) : (
        initials
      )}
    </div>
  );
}

function VerifiedDot() {
  return (
    <span
      title="Verified NexBatch workspace"
      aria-hidden
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 14,
        height: 14,
        borderRadius: "50%",
        background: "#22d3ee",
        color: "#022c33",
        fontSize: 9,
        fontWeight: 900,
      }}
    >
      ✓
    </span>
  );
}

function EmptyThreadHint(): ReactNode {
  return (
    <div
      style={{
        margin: "auto",
        padding: 24,
        textAlign: "center",
        color: "#94a3b8",
        fontSize: 14,
        maxWidth: 360,
      }}
    >
      <div style={{ fontSize: 38, marginBottom: 8 }}>💬</div>
      <div style={{ fontWeight: 700, color: "#cbd5e1", marginBottom: 6 }}>
        Start a NexBatch conversation
      </div>
      <div>Pick an existing thread on the left, or click <span style={{ color: "#a5b4fc", fontWeight: 700 }}>New</span> to message a company.</div>
    </div>
  );
}

function formatShortTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) return formatClockTime(iso);
  const diffDays = Math.floor((now.getTime() - d.getTime()) / 86_400_000);
  if (diffDays < 7) return d.toLocaleDateString(undefined, { weekday: "short" });
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function formatClockTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}
