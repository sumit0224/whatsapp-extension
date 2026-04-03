/* ═══════════════════════════════════════════════════
   WAuto Pro — Reply Monitor (Content Script)
   Watches WhatsApp Web for incoming replies via
   MutationObserver on chat list and active conversation.
   ═══════════════════════════════════════════════════ */

(function () {
  'use strict';

  // ── STATE ──
  let chatListObserver = null;
  let conversationObserver = null;
  const processedMessages = new Set(); // avoid duplicate reports
  const POLL_INTERVAL = 3000;

  // ═══════════════════════════════════════
  //  SELECTORS
  // ═══════════════════════════════════════
  const SEL = {
    chatList: [
      '[data-testid="chat-list"]',
      '#pane-side',
      'div[aria-label="Chat list"]',
    ],
    unreadBadge: [
      'span[data-testid="icon-unread-count"]',
      'span[aria-label*="unread message"]',
      'span.aumms1qt', // fallback class
    ],
    chatRow: [
      'div[data-testid="cell-frame-container"]',
      'div[data-testid="list-item"]',
      'div._amm6',
    ],
    chatTitle: [
      'span[data-testid="cell-frame-title"] span',
      'span[dir="auto"][title]',
    ],
    chatPreview: [
      'span[data-testid="last-msg-status"]',
      'div[data-testid="cell-frame-secondary"] span[dir="ltr"]',
      'span.matched-text',
    ],
    conversationPanel: [
      '#main div.copyable-area',
      '#main',
      'div[role="application"]',
    ],
    incomingMessage: [
      'div.message-in',
      'div[class*="message-in"]',
      '#main div[tabindex="-1"]',
    ],
    messageText: [
      'span[data-testid="msg-text"] span',
      'span.selectable-text span',
      'span[dir="ltr"]',
    ],
  };

  // ═══════════════════════════════════════
  //  HELPERS
  // ═══════════════════════════════════════

  function $(selectorList, parent) {
    const root = parent || document;
    for (const sel of selectorList) {
      try {
        const el = root.querySelector(sel);
        if (el) return el;
      } catch (e) { /* skip */ }
    }
    return null;
  }

  function $$(selectorList, parent) {
    const root = parent || document;
    for (const sel of selectorList) {
      try {
        const els = root.querySelectorAll(sel);
        if (els.length > 0) return Array.from(els);
      } catch (e) { /* skip */ }
    }
    return [];
  }

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  /**
   * Extract phone number from a chat row element.
   */
  function extractPhoneFromChat(chatEl) {
    // Strategy 1: data-id attribute
    const dataId = chatEl.getAttribute('data-id');
    if (dataId) {
      const match = dataId.match(/(\d{10,15})@/);
      if (match) return normalisePhone(match[1]);
    }

    // Strategy 2: Walk up to find data-id on ancestors
    let parent = chatEl.parentElement;
    for (let i = 0; i < 5 && parent; i++) {
      const pid = parent.getAttribute('data-id');
      if (pid) {
        const m = pid.match(/(\d{10,15})@/);
        if (m) return normalisePhone(m[1]);
      }
      parent = parent.parentElement;
    }

    // Strategy 3: aria-label with numbers
    const title = $(SEL.chatTitle, chatEl);
    if (title) {
      const titleText = title.textContent || title.getAttribute('title') || '';
      const phoneMatch = titleText.match(/\+?(\d[\d\s\-]{8,14}\d)/);
      if (phoneMatch) {
        return normalisePhone(phoneMatch[1].replace(/[\s\-]/g, ''));
      }
    }

    return null;
  }

  function normalisePhone(raw) {
    let phone = raw.replace(/[^\d]/g, '');
    if (phone.length === 10) return '+91' + phone;
    if (phone.length === 12 && phone.startsWith('91')) return '+' + phone;
    if (phone.length >= 10 && phone.length <= 15) return '+' + phone;
    return null;
  }

  // ═══════════════════════════════════════
  //  CHAT LIST MONITORING
  // ═══════════════════════════════════════

  function startChatListObserver() {
    const chatListEl = $(SEL.chatList);
    if (!chatListEl) {
      setTimeout(startChatListObserver, POLL_INTERVAL);
      return;
    }

    if (chatListObserver) chatListObserver.disconnect();

    chatListObserver = new MutationObserver(debounce(scanChatList, 1500));
    chatListObserver.observe(chatListEl, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    // Initial scan
    scanChatList();
    console.log('[WAuto] Chat list observer started');
  }

  function scanChatList() {
    const chatRows = $$(SEL.chatRow);

    for (const row of chatRows) {
      // Check for unread badge
      const badge = $(SEL.unreadBadge, row);
      if (!badge) continue;

      const unreadCount = parseInt(badge.textContent, 10);
      if (!unreadCount || unreadCount < 1) continue;

      const phone = extractPhoneFromChat(row);
      if (!phone) continue;

      // Get preview text
      const previewEl = $(SEL.chatPreview, row);
      const previewText = previewEl ? previewEl.textContent.trim() : '';

      // Get sender name
      const titleEl = $(SEL.chatTitle, row);
      const senderName = titleEl ? (titleEl.textContent || titleEl.getAttribute('title') || '').trim() : '';

      // Deduplicate
      const key = `${phone}_${previewText.slice(0, 30)}`;
      if (processedMessages.has(key)) continue;
      processedMessages.add(key);

      // Trim processed set periodically
      if (processedMessages.size > 500) {
        const arr = Array.from(processedMessages);
        arr.splice(0, 250);
        processedMessages.clear();
        arr.forEach((k) => processedMessages.add(k));
      }

      // Report to service worker
      sendReplyDetected(phone, previewText, senderName);
    }
  }

  // ═══════════════════════════════════════
  //  ACTIVE CONVERSATION MONITORING
  // ═══════════════════════════════════════

  function startConversationObserver() {
    const panel = $(SEL.conversationPanel);
    if (!panel) {
      setTimeout(startConversationObserver, POLL_INTERVAL);
      return;
    }

    if (conversationObserver) conversationObserver.disconnect();

    conversationObserver = new MutationObserver(debounce(scanConversation, 1000));
    conversationObserver.observe(panel, {
      childList: true,
      subtree: true,
    });

    console.log('[WAuto] Conversation observer started');
  }

  async function scanConversation() {
    const incomingMsgs = $$(SEL.incomingMessage);
    if (incomingMsgs.length === 0) return;

    let activePhone = null;

    // Strategy 1: URL (legacy fallback)
    const urlMatch = window.location.href.match(/\/send\?phone=(\d+)/);
    if (urlMatch) activePhone = normalisePhone(urlMatch[1]);

    // Strategy 2: Chat header title
    if (!activePhone) {
      const header = document.querySelector('#main header span[dir="auto"][title]');
      if (header) {
        const t = header.getAttribute('title') || header.textContent || '';
        const m = t.match(/\+?(\d[\d\s\-]{8,14}\d)/);
        if (m) activePhone = normalisePhone(
          m[1].replace(/[\s\-]/g, '')
        );
      }
    }

    // Strategy 3: chrome.storage lastSentPhone
    if (!activePhone) {
      try {
        const s = await new Promise(resolve =>
          chrome.storage.local.get(['lastSentPhone'], resolve)
        );
        if (s.lastSentPhone) activePhone = s.lastSentPhone;
      } catch(e) {}
    }

    // Check last few incoming messages
    const recentMsgs = incomingMsgs.slice(-3);
    for (const msgEl of recentMsgs) {
      const textEl = $(SEL.messageText, msgEl);
      if (!textEl) continue;

      const msgText = textEl.textContent.trim();
      if (!msgText) continue;

      const key = `conv_${activePhone}_${msgText.slice(0, 30)}`;
      if (processedMessages.has(key)) continue;
      processedMessages.add(key);

      if (activePhone) {
        sendReplyDetected(activePhone, msgText, '');
      }
    }
  }

  // ═══════════════════════════════════════
  //  SEND TO SERVICE WORKER
  // ═══════════════════════════════════════

  function sendReplyDetected(phone, previewText, senderName) {
    try {
      chrome.runtime.sendMessage({
        action: 'REPLY_DETECTED',
        phone: phone,
        previewText: previewText,
        senderName: senderName,
        timestamp: Date.now(),
      }).catch(() => { /* service worker may not be listening */ });
    } catch (e) {
      // Extension context invalidated — ignore
    }
  }

  // ═══════════════════════════════════════
  //  UTILITIES
  // ═══════════════════════════════════════

  function debounce(fn, delay) {
    let timer = null;
    return function (...args) {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), delay);
    };
  }

  // ═══════════════════════════════════════
  //  INIT — Wait for WhatsApp Web to load
  // ═══════════════════════════════════════

  function init() {
    // Wait for the app to be ready
    const checkReady = () => {
      const app = document.querySelector('#app');
      const sidePane = document.querySelector('#pane-side');
      if (app && sidePane) {
        setTimeout(() => {
          startChatListObserver();
          startConversationObserver();
        }, 2000);
      } else {
        setTimeout(checkReady, POLL_INTERVAL);
      }
    };
    checkReady();
  }

  // Handle page navigation (WhatsApp Web is a SPA)
  let lastUrl = location.href;
  const urlObserver = new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      // Restart conversation observer on navigation
      setTimeout(startConversationObserver, 1500);
    }
  });
  urlObserver.observe(document.body, { childList: true, subtree: true });

  init();
  console.log('[WAuto Pro] Reply monitor loaded');
})();
