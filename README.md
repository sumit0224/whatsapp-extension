# WAuto Pro — WhatsApp Lead Outreach Tool

> **Phase 4 (Production)** — Comprehensive WhatsApp outreach CRM with DOM automation, scheduling, analytics, and follow-up tracking for IT training sales teams.

![Version](https://img.shields.io/badge/version-4.0.0-brightgreen)
![Manifest](https://img.shields.io/badge/manifest-v3-blue)
![License](https://img.shields.io/badge/license-private-red)

---

## 🚀 Features

- **Excel / CSV Upload** — Drag-and-drop `.xlsx` or `.csv` files with auto column detection
- **Smart Phone Parsing** — Auto-cleans numbers, adds `+91`, removes duplicates
- **Dual Sending Modes**:
  - `DOM Mode`: Fully automated sending by interacting directly with the WhatsApp Web interface (simulates human typing).
  - `Link Mode`: Automated sequential `wa.me` tab opens (requires manual send).
- **Template Library & Rotation** — Save templates, use variables (`{{name}}`, `{{course}}`, `{{city}}`), and automatically rotate between 2–5 templates for A/B testing and anti-spam.
- **Campaign Scheduler** — Schedule campaigns for future dates/times.
- **Automated Follow-ups** — Define 24/48/72-hour sequence delays with automatic halting if a lead replies.
- **Analytics Dashboard** — Visual CRM funnel, daily activity charts, and template performance (reply rates).
- **Robust Error Retry** — Automatically queues failed sends (e.g., chat load timeouts) and retries them intelligently while skipping permanently invalid numbers.
- **Anti-Ban Protection** — Random jitter delays, human typing speeds, configurable daily limits, and mandated pause breaks.
- **Leads Management & Export** — View contacts, filter by tags (🔥 Hot, ☀️ Warm, ❄️ Cold), auto-tag replies, and export directly to `.xlsx` or `.csv`.

---

## 📦 Installation (Chrome Developer Mode)

1. **Download / Clone** this project folder to your computer.
2. **Open Chrome** and navigate to:
   ```text
   chrome://extensions
   ```
3. **Enable Developer Mode** — Toggle the switch in the top-right corner.
4. **Click "Load unpacked"** — Select the `whatsapp-extension` folder (the one containing `manifest.json`).
5. **Pin the extension** — Click the puzzle icon in Chrome's toolbar and pin **WAuto Pro**.
6. You're ready! Click the WAuto Pro icon to open the popup.

---

## 📖 How to Use

### Step 1: Prepare Your Contact File

Create an Excel (`.xlsx`) or CSV file with these columns:

| Name | Phone | Course | City |
|------|-------|--------|------|
| Rahul Sharma | 9876543210 | Python | Delhi |

### Step 2: Configure Settings
1. Go to the **Settings** tab.
2. Configure your **Daily message limit** and **Break intervals** (e.g., take a 3-minute break every 30 messages).
3. Ensure **Enable typing simulation (DOM mode)** is checked for maximum safety.

### Step 3: Write or Select Templates
1. Go to the **Templates** tab.
2. Create your templates using `{{name}}`, `{{course}}`, and `{{city}}` variables.
3. In the **Campaign** tab, you can choose to send a single template or rotate between multiple templates.

### Step 4: Schedule or Start Campaign
1. In the **Campaign** tab, upload your `.xlsx` or `.csv` file.
2. Ensure **DOM Mode** is selected. The extension will verify if WhatsApp Web is open and logged in.
3. Configure the delay (e.g., 10s fixed + 3s jitter).
4. Click **Start Campaign** for immediate execution, or enable **Schedule this campaign for later** to run it at a future date and time.
5. The extension will automatically handle sending, breaks, and logging.

### Step 5: Follow-Ups & Analytics
- **Leads Tab**: Monitor live replies. The extension auto-detects keywords (e.g., "interested", "price") and tags leads as 🔥 **Hot**. You can manually add notes to leads here.
- **Dashboard Tab**: Check the funnel view, daily activity bar charts, and see which templates have the highest reply rates.

---

## ⚙️ Anti-Ban Protections

WAuto Pro is designed with safety first:
- **Human Typing Simulation:** Characters are typed with 30-80ms delays to mimic real keystrokes.
- **Minimum Delays:** 5-second floor between messages.
- **Random Jitter:** `actualDelay = fixed + random(0, jitter)`.
- **Scheduled Breaks:** Configurable breaks after a set number of messages.
- **Daily Limits:** Hard caps on messages sent per day.

---

## 🗂 Project Structure

```text
whatsapp-extension/
├── manifest.json              # Chrome Extension manifest v3
├── background/
│   └── service-worker.js      # Background task orchestrator, queues, & alarms 
├── content/
│   ├── whatsapp.js            # DOM automation & typing simulator
│   └── reply-monitor.js       # Auto-detects in-bound messages & reads chat list
├── popup/
│   ├── popup.html             # React-like 5-tab DOM structure
│   ├── popup.js               # Main tab routing & campaign engine UI
│   ├── dashboard.js           # Analytics & SVG chart rendering
│   ├── leads.js               # CRM pipeline & Excel export modal
│   ├── scheduler.js           # Future-campaign execution logic
│   └── templates.js           # Reusable template manager & A/B testing
├── libs/
│   ├── db.js                  # Advanced IndexedDB Schema (Dexie wrapper)
│   ├── dexie.min.js           # IndexedDB promises
│   └── xlsx.full.min.js       # Fast, client-side Excel parsing
├── icons/
│   └── icon128.png            
└── README.md                  # This documentation
```

---

## ⚡ Known Limitations & Tips

1. **Keep Chrome Open:** The campaign pausing relies on Chrome's Service Worker lifecycle. While Alarms handles scheduling and retries, Chrome must remain running in the background for them to execute.
2. **Tab Focus in DOM mode:** For DOM mode to function flawlessly, the WhatsApp Web tab should ideally remain open and not be entirely throttled by Chrome's Memory Saver.
3. **WhatsApp Web Login:** You must be logged into WhatsApp Web and your phone must have connectivity if you are not using the multi-device features.

---

## 📞 Support

For issues or feature requests regarding WAuto Pro, contact the development team.
