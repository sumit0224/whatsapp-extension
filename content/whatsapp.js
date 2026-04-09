/* ═══════════════════════════════════════════════════
   WAuto Pro — Content Script (WhatsApp Web DOM Automation)
   Runs inside https://web.whatsapp.com/*
   ═══════════════════════════════════════════════════ */

(function () {
  'use strict';

  // ═══════════════════════════════════════
  //  SECTION E: DOM SELECTOR RESILIENCE
  //  Priority: data-testid → aria-label → data-tab → class
  // ═══════════════════════════════════════

  /**
   * Wait for any element from a list of selectors to appear.
   * @param {string[]} selectorList - CSS selectors to try (priority order)
   * @param {number} timeout - Max wait in ms (default 15000)
   * @param {number} interval - Poll interval in ms (default 500)
   * @returns {Promise<Element|null>}
   */
  function waitForElement(selectorList, timeout = 15000, interval = 500) {
    return new Promise((resolve) => {
      const start = Date.now();

      const check = () => {
        for (const selector of selectorList) {
          try {
            const el = document.querySelector(selector);
            if (el) {
              resolve(el);
              return;
            }
          } catch (e) {
            // Invalid selector — skip
          }
        }

        if (Date.now() - start >= timeout) {
          resolve(null);
          return;
        }

        setTimeout(check, interval);
      };

      check();
    });
  }

  /**
   * Wait for any element matching text content to appear.
   * Used for detecting error dialogs.
   */
  function waitForTextContent(textPatterns, timeout = 5000, interval = 500) {
    return new Promise((resolve) => {
      const start = Date.now();

      const check = () => {
        const allElements = document.querySelectorAll('div, span, p');
        for (const el of allElements) {
          const text = (el.textContent || '').trim().toLowerCase();
          for (const pattern of textPatterns) {
            if (text.includes(pattern.toLowerCase())) {
              resolve({ found: true, text: el.textContent.trim() });
              return;
            }
          }
        }

        if (Date.now() - start >= timeout) {
          resolve({ found: false });
          return;
        }

        setTimeout(check, interval);
      };

      check();
    });
  }

  /**
   * Combined high-performance Concurrent Check (Zero-Reflow)
   */
  function waitForChatOrError(timeout = 15000, interval = 500) {
    return new Promise((resolve) => {
      const start = Date.now();
      const check = () => {
        // 1. Compose box
        for (const selector of SELECTORS.composeBox) {
          const el = document.querySelector(selector);
          if (el) { resolve({ status: 'ready', element: el }); return; }
        }

        // 2. High-performance Error text match (No Layout Reflow)
        const bodyText = (document.body.textContent || '').toLowerCase();
        for (const pattern of SELECTORS.invalidNumberTexts) {
          if (bodyText.includes(pattern.toLowerCase())) {
            resolve({ status: 'error', reason: 'number_not_on_whatsapp' });
            return;
          }
        }

        // 3. Disconnect status
        if (!isLoggedIn()) { resolve({ status: 'error', reason: 'whatsapp_disconnected' }); return; }

        if (Date.now() - start >= timeout) { resolve({ status: 'timeout' }); return; }
        setTimeout(check, interval);
      };
      check();
    });
  }

  /**
   * Small delay helper.
   */
  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Random integer between min and max (inclusive).
   */
  function randomBetween(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  // ═══════════════════════════════════════
  //  SELECTOR DEFINITIONS (centralized)
  // ═══════════════════════════════════════

  const SELECTORS = {
    // QR code — indicates user is NOT logged in
    qrCode: [
      '[data-testid="qrcode"]',
      'canvas[aria-label="Scan this QR code to link a device!"]',
      'div[data-ref]', // QR code container
    ],

    // Main app container — indicates user IS logged in
    mainApp: [
      '#app',
      '[data-testid="chat-list"]',
      '#pane-side',
    ],

    // Chat compose input box
    composeBox: [
      'div[data-testid="conversation-compose-box-input"]',
      'div[contenteditable="true"][data-tab="10"]',
      'div[contenteditable="true"][role="textbox"][data-tab="10"]',
      'footer div[contenteditable="true"]',
    ],

    // Send button
    sendButton: [
      'button[data-testid="send"]',
      'span[data-testid="send"]',
      '[data-testid="send"]',
      'button[aria-label="Send"]',
    ],

    // Attachment entry points
    attachButton: [
      'button[data-testid="clip"]',
      'span[data-testid="clip"]',
      'button[aria-label*="Attach"]',
      'div[title*="Attach"]',
    ],

    mediaInput: [
      'input[type="file"][accept*="image"]',
      'input[type="file"][accept*="video"]',
      'input[type="file"][accept*="image/*,video/*"]',
      'input[type="file"]',
    ],

    mediaCaptionBox: [
      'div[contenteditable="true"][data-testid="media-caption-input"]',
      'div[data-testid="media-caption-input-container"] div[contenteditable="true"]',
      'div[contenteditable="true"][role="textbox"]',
    ],

    // Invalid number detection
    invalidNumberTexts: [
      'phone number shared via url is not on whatsapp',
      'this person is not on whatsapp',
      'invalid phone number',
      "couldn't find this contact",
    ],

    // Popup/dialog OK button (to dismiss error dialogs)
    okButton: [
      'div[data-testid="popup-controls-ok"]',
      'div[role="button"][tabindex="0"]',
    ],
  };

  // ═══════════════════════════════════════
  //  SECTION A: SESSION CHECK
  // ═══════════════════════════════════════

  function isLoggedIn() {
    // Check for QR code presence first
    for (const sel of SELECTORS.qrCode) {
      try {
        const qr = document.querySelector(sel);
        if (qr) return false;
      } catch (e) { /* skip */ }
    }

    // Check for main app elements
    for (const sel of SELECTORS.mainApp) {
      try {
        const app = document.querySelector(sel);
        if (app) return true;
      } catch (e) { /* skip */ }
    }

    // Ambiguous — assume not ready yet
    return false;
  }

  // ═══════════════════════════════════════
  //  SECTION B: OPEN A CONTACT'S CHAT
  // ═══════════════════════════════════════

  async function openChat(phoneNumber) {
    try {
      // Strip the '+' for the URL
      const cleanPhone = phoneNumber.replace(/\+/g, '');
      const sendUrl = `https://web.whatsapp.com/send?phone=${cleanPhone}`;

      // Navigation now handled by service-worker
      // via chrome.tabs.update — do not reload here
      console.warn(
        '[WAuto] openChat() called directly — ' +
        'use executeDomSend() via service-worker instead'
      );
      return { success: false, reason: 'use_dom_send' };

      // Wait for compose box to appear (chat loaded)
      const composeBox = await waitForElement(SELECTORS.composeBox, 15000, 500);

      if (composeBox) {
        return { success: true };
      }

      // Check if the number is not on WhatsApp
      const errorCheck = await waitForTextContent(SELECTORS.invalidNumberTexts, 3000, 300);
      if (errorCheck.found) {
        // Try to dismiss the dialog
        await dismissDialog();
        return { success: false, reason: 'number_not_on_whatsapp' };
      }

      // Another check — see if QR code appeared (disconnected)
      if (!isLoggedIn()) {
        return { success: false, reason: 'whatsapp_disconnected' };
      }

      return { success: false, reason: 'chat_load_timeout' };
    } catch (err) {
      console.error('[WAuto] openChat error:', err);
      return { success: false, reason: 'chat_load_timeout' };
    }
  }

  /**
   * Try to dismiss a WhatsApp error dialog by clicking OK.
   */
  async function dismissDialog() {
    await sleep(500);
    for (const sel of SELECTORS.okButton) {
      try {
        const btn = document.querySelector(sel);
        if (btn) {
          btn.click();
          await sleep(300);
          return;
        }
      } catch (e) { /* skip */ }
    }
  }

  // ═══════════════════════════════════════
  //  SECTION C: TYPE AND SEND MESSAGE
  // ═══════════════════════════════════════
  async function switchChatByPhone(phone) {
    try {
      const cleanPhone = phone.replace(/\+/g, '').trim();
      console.log(`[WAuto] Switching chat to: ${cleanPhone}`);

      // Sahi URL se navigate karo
      const chatUrl = `https://web.whatsapp.com/send?phone=${cleanPhone}`;
      
      // Current URL already sahi hai?
      if (window.location.href.includes(cleanPhone)) {
        console.log(`[WAuto] Already on correct chat: ${cleanPhone}`);
        return true;
      }

      // Service worker handle karta hai navigation
      // Hum sirf confirm karein compose box ready hai
      await sleep(2000);
      
      // Compose box check karo
      const composeBox = await waitForElement(
        SELECTORS.composeBox, 
        20000, 
        500
      );
      
      if (composeBox) {
        console.log(`[WAuto] Chat switched to: ${cleanPhone}`);
        return true;
      }

      console.warn(`[WAuto] Compose box not found for: ${cleanPhone}`);
      return false;

    } catch (err) {
      console.error('[WAuto] switchChatByPhone error:', err);
      return false;
    }
  }


  async function typeAndSend(message) {
    try {
      // 1. Find the compose input box
      const inputBox = await waitForElement(SELECTORS.composeBox, 10000, 300);
      if (!inputBox) {
        return { success: false, reason: 'send_failed' };
      }

      // 2. Click to focus
      inputBox.click();
      inputBox.focus();
      await sleep(300);

      // 3. Type message character by character (anti-ban: 30-80ms per char)
      const typeSuccess = await humanType(inputBox, message);
      if (!typeSuccess) {
        // Fallback: try execCommand bulk insert
        const fallbackSuccess = await bulkInsert(inputBox, message);
        if (!fallbackSuccess) {
          return { success: false, reason: 'send_failed' };
        }
      }

      // 4. Wait a random 500-1200ms after typing (simulate reading pause)
      await sleep(randomBetween(500, 1200));

      // 5. Find and click the Send button
      const sent = await clickSend(inputBox);
      if (!sent) {
        return { success: false, reason: 'send_failed' };
      }

      // 6. Wait 500ms to confirm send
      await sleep(500);

      return { success: true };
    } catch (err) {
      console.error('[WAuto] typeAndSend error:', err);
      return { success: false, reason: 'send_failed' };
    }
  }

  /**
   * Type message character by character with human-like delays.
   * Handles multi-line messages by using Shift+Enter for newlines.
   */
  async function humanType(inputBox, message) {
    try {
      inputBox.focus();

      for (let i = 0; i < message.length; i++) {
        const char = message[i];

        if (char === '\n') {
          // Simulate Shift+Enter for newline in WhatsApp
          const shiftEnter = new KeyboardEvent('keydown', {
            key: 'Enter',
            code: 'Enter',
            keyCode: 13,
            which: 13,
            shiftKey: true,
            bubbles: true,
            cancelable: true,
          });
          inputBox.dispatchEvent(shiftEnter);
        } else {
          // Use execCommand for each character — most reliable for contenteditable
          document.execCommand('insertText', false, char);
        }

        // Dispatch input event
        inputBox.dispatchEvent(new Event('input', { bubbles: true }));

        // Random delay between 30-80ms per character
        await sleep(randomBetween(30, 80));
      }

      return true;
    } catch (err) {
      console.error('[WAuto] humanType error:', err);
      return false;
    }
  }

  /**
   * Fallback: bulk insert using execCommand.
   */
  async function bulkInsert(inputBox, message) {
    try {
      inputBox.focus();
      inputBox.textContent = '';

      // Split by newlines and handle each line
      const lines = message.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (i > 0) {
          // Insert newline via Shift+Enter
          const shiftEnter = new KeyboardEvent('keydown', {
            key: 'Enter',
            code: 'Enter',
            keyCode: 13,
            which: 13,
            shiftKey: true,
            bubbles: true,
            cancelable: true,
          });
          inputBox.dispatchEvent(shiftEnter);
          await sleep(50);
        }
        document.execCommand('insertText', false, lines[i]);
        await sleep(50);
      }

      inputBox.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    } catch (err) {
      console.error('[WAuto] bulkInsert error:', err);
      return false;
    }
  }

  /**
   * Find and click the send button, with Enter key fallback.
   */
  async function clickSend(inputBox) {
    // Try clicking the send button
    for (const sel of SELECTORS.sendButton) {
      try {
        const btn = document.querySelector(sel);
        if (btn) {
          btn.click();
          return true;
        }
      } catch (e) { /* skip */ }
    }

    // Fallback: simulate Enter key press
    try {
      const target = inputBox || document.activeElement || document.body;
      const enterEvent = new KeyboardEvent('keydown', {
        key: 'Enter',
        code: 'Enter',
        keyCode: 13,
        which: 13,
        bubbles: true,
        cancelable: true,
      });
      target.dispatchEvent(enterEvent);
      return true;
    } catch (err) {
      console.error('[WAuto] clickSend fallback error:', err);
      return false;
    }
  }

  // ═══════════════════════════════════════
  //  SECTION C2: MEDIA ATTACH + SEND
  // ═══════════════════════════════════════
  function sanitizeIncomingMedia(mediaPayload) {
    if (!mediaPayload || typeof mediaPayload !== 'object') return null;
    if (typeof mediaPayload.dataUrl !== 'string' || !mediaPayload.dataUrl.startsWith('data:')) return null;
    const size = Number(mediaPayload.size || 0);
    if (size <= 0 || size > 16 * 1024 * 1024) return null;
    const kind = mediaPayload.kind === 'video' ? 'video' : 'image';
    return {
      name: String(mediaPayload.name || `media-${Date.now()}`),
      type: String(mediaPayload.type || ''),
      size,
      kind,
      dataUrl: mediaPayload.dataUrl,
    };
  }

  function dataUrlToFile(dataUrl, fileName, mimeType) {
    const parts = dataUrl.split(',');
    if (parts.length < 2) return null;
    const header = parts[0];
    const mimeMatch = header.match(/data:([^;]+);base64/);
    const finalMime = mimeType || (mimeMatch ? mimeMatch[1] : 'application/octet-stream');
    const binary = atob(parts[1]);
    const len = binary.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
    return new File([bytes], fileName || `media-${Date.now()}`, { type: finalMime });
  }

  function findMediaFileInput() {
    const inputs = Array.from(document.querySelectorAll('input[type="file"]'));
    return inputs.find((input) => {
      const accept = (input.getAttribute('accept') || '').toLowerCase();
      return accept.includes('image') || accept.includes('video');
    }) || null;
  }

  async function waitForMediaInput(timeout = 6000, interval = 200) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const input = findMediaFileInput();
      if (input) return input;
      await sleep(interval);
    }
    return null;
  }

  async function sendMediaWithCaption(mediaPayload, captionText) {
    try {
      const media = sanitizeIncomingMedia(mediaPayload);
      if (!media) return { success: false, reason: 'invalid_media_payload' };

      // Open attachment tray if needed
      let input = await waitForMediaInput(2500, 150);
      if (!input) {
        const attachBtn = await waitForElement(SELECTORS.attachButton, 6000, 200);
        if (!attachBtn) return { success: false, reason: 'attach_button_not_found' };
        attachBtn.click();
        await sleep(350);
        input = await waitForMediaInput(6000, 200);
      }
      if (!input) return { success: false, reason: 'media_input_not_found' };

      const file = dataUrlToFile(media.dataUrl, media.name, media.type);
      if (!file) return { success: false, reason: 'media_decode_failed' };

      const dt = new DataTransfer();
      dt.items.add(file);
      input.files = dt.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));

      // Wait for media preview composer to appear
      await sleep(1300);

      const caption = (captionText || '').trim();
      if (caption) {
        const captionBox = await waitForElement([...SELECTORS.mediaCaptionBox, ...SELECTORS.composeBox], 8000, 200);
        if (!captionBox) return { success: false, reason: 'caption_box_not_found' };
        captionBox.click();
        captionBox.focus();
        await sleep(250);
        const typed = await humanType(captionBox, caption);
        if (!typed) {
          const fallback = await bulkInsert(captionBox, caption);
          if (!fallback) return { success: false, reason: 'caption_insert_failed' };
        }
        await sleep(randomBetween(400, 900));
      }

      const sent = await clickSend(document.activeElement);
      if (!sent) return { success: false, reason: 'send_failed' };
      await sleep(700);
      return { success: true };
    } catch (err) {
      console.error('[WAuto] sendMediaWithCaption error:', err);
      return { success: false, reason: 'send_failed' };
    }
  }

  // ═══════════════════════════════════════
  //  SECTION D: MESSAGE LISTENER
  // ═══════════════════════════════════════

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === 'CHECK_LOGIN') {
      const loggedIn = isLoggedIn();
      sendResponse({ loggedIn: loggedIn });
      return true;
    }

    if (msg.action === 'SEND_MESSAGE') {
      // msg contains: { phone, message }
      (async () => {
        try {
          // Step 1: Open the chat
          const chatResult = await openChat(msg.phone);
          if (!chatResult.success) {
            sendResponse({ success: false, reason: chatResult.reason });
            return;
          }

          // Step 2: Send text-only or media+caption
          const hasMedia = msg.media && typeof msg.media === 'object' && !!msg.media.dataUrl;
          const sendResult = hasMedia
            ? await sendMediaWithCaption(msg.media, msg.message || '')
            : await typeAndSend(msg.message || '');
          sendResponse(sendResult);
        } catch (err) {
          console.error('[WAuto] SEND_MESSAGE handler error:', err);
          sendResponse({ success: false, reason: 'send_failed' });
        }
      })();
      return true; // Keep channel open for async response
    }

    if (msg.action === 'TYPE_AND_SEND') {
      (async () => {
        try {
          if (msg.phone) {
            const switched = await switchChatByPhone(msg.phone);
            if (!switched) {
              sendResponse({ 
                success: false, 
                reason: 'chat_switch_failed' 
              });
              return;
            }
          }
          const result = await waitForChatOrError(15000, 500);
          if (result.status === 'error') {
            if (result.reason === 'number_not_on_whatsapp') await dismissDialog();
            sendResponse({ success: false, reason: result.reason });
            return;
          } else if (result.status === 'timeout') {
            sendResponse({ success: false, reason: 'chat_load_timeout' });
            return;
          }

          // Send text-only or media+caption
          const hasMedia = msg.media && typeof msg.media === 'object' && !!msg.media.dataUrl;
          const sendResult = hasMedia
            ? await sendMediaWithCaption(msg.media, msg.message || '')
            : await typeAndSend(msg.message || '');
          
          // Inject dynamic inline reply watcher for 5 mins
          if (sendResult.success) {
            startReplyWatcher(msg.phone, (replyData) => {
              if (replyData.detected) {
                chrome.runtime.sendMessage({
                  action: 'REPLY_DETECTED',
                  phone: msg.phone,
                  previewText: replyData.message,
                  timestamp: replyData.timestamp
                }).catch(() => {});
              }
            });
          }

          sendResponse(sendResult);
        } catch (err) {
          console.error('[WAuto] TYPE_AND_SEND handler error:', err);
          sendResponse({ success: false, reason: 'send_failed' });
        }
      })();
      return true;
    }

    if (msg.action === 'PING') {
      sendResponse({ alive: true });
      return true;
    }
  });

  // ═══════════════════════════════════════
  //  SECTION E: INLINE REPLY WATCHER
  // ═══════════════════════════════════════

  function startReplyWatcher(expectedPhone, callback) {
    const chatContainer = document.querySelector('#main div.copyable-area') ||
      document.querySelector('#main') ||
      document.querySelector('div[role="application"]');
    
    if (!chatContainer) {
      callback({ detected: false, reason: 'chat_container_not_found' });
      return;
    }

    console.log(`[ReplyWatcher] Observer attached for: ${expectedPhone}`);

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE) {
            const isIncoming = node.querySelector && (
              node.querySelector('div[data-testid="msg-container"]') ||
              node.querySelector('div.message-in')
            );
            
            if (isIncoming && !node.querySelector('.message-out')) {
              const textNode = node.querySelector('span[dir="ltr"]') || node;
              const text = textNode.innerText || textNode.textContent || '';
              
              if (text.trim()) {
                observer.disconnect();
                console.log(`[ReplyWatcher] Incoming message detected: "${text.trim()}"`);
                callback({ 
                  detected: true, 
                  message: text.trim(),
                  timestamp: Date.now()
                });
                return;
              }
            }
          }
        }
      }
    });

    observer.observe(chatContainer, { childList: true, subtree: true });

    setTimeout(() => {
      observer.disconnect();
      callback({ detected: false, reason: 'timeout' });
    }, 5 * 60000);
  }

  // ═══════════════════════════════════════
  //  INIT — Log that content script loaded
  // ═══════════════════════════════════════
  console.log('[WAuto Pro] Content script loaded on WhatsApp Web');
})();
