# Vicious Vix Assistant

A voice-controlled AI assistant built with Next.js and Capacitor, packaged as
a native Android app. Uses Groq (Llama/GPT-OSS models) for reasoning and
image analysis, and an Android Accessibility Service for hands-free
navigation.

---

## Features

- 🧠 AI reasoning, greetings, reminders, and image analysis via Groq
- 🎙️ Voice-driven navigation with `VixAccessibilityService` — watches the
  foreground app for stalled responses and can tap, type, open apps, and
  navigate back/home/recents
- 📦 `vix-plugin/` — the original standalone JS module (`vixFill` /
  `vixNavigate`) this app's navigation logic was prototyped from, kept here
  for reference and reuse in non-Android JS projects

---

## Project layout

- `src/ai/` — Groq-backed flows (general query, greeting, reminders, image analysis)
- `android/` — native Android project (Capacitor + `VixAccessibilityService`)
- `vix-plugin/` — standalone Node.js module with the same fuzzy-navigation
  matching logic, usable independently of this app

---

## Requirements

- Node.js + npm
- A Groq API key (`GROQ_API_KEY` in `.env`)
- Android SDK (for building the APK via `android/gradlew`)

## Setup

```bash
npm install
npm run build
npx cap sync android
cd android && ./gradlew assembleDebug
```

The debug APK lands at `android/app/build/outputs/apk/debug/app-debug.apk`.
After installing, enable the navigation service under
**Settings → Accessibility**.
