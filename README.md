cd ~/clean/VICIOUSASSISTANT

cat > README.md << 'EOF'
# Vicious Assistant

A voice-controlled AI assistant for Android, built with Next.js + Capacitor
and packaged as a native app. Uses Groq (Llama/GPT-OSS models) for reasoning
and image analysis, plus an Android Accessibility Service for hands-free
device navigation.

This repo consolidates four earlier prototype builds (Vicious-ai, Vix-assistant,
Vicious-vix-assistant, Viciously) into one project. See `MERGE_NOTES.md` for
the full breakdown of what came from where.

---

## Features

- 🧠 AI reasoning, greetings, reminders, and image analysis via Groq
- 🎙️ Voice-driven navigation with `VixAccessibilityService` — watches the
  foreground app and can tap, type, open apps, and navigate back/home/recents
- 📱 `AppLauncherPlugin` — opens the camera, gallery, browser, dialer, maps,
  settings, or any installed app by package name
- 📦 `vix-plugin/` — standalone JS module with the same fuzzy-navigation
  matching logic, reusable outside this app

---

## Project layout

- `src/ai/` — Groq-backed flows (general query, greeting, reminders, image analysis)
- `android/` — native Android project (Capacitor + `VixAccessibilityService` + `AppLauncherPlugin`)
- `vix-plugin/` — standalone Node.js navigation module
- `legacy/` — reference-only code from earlier incompatible-stack prototypes
  (Termux CLI, Python/Kivy offline assistant) — not built into the app

---

## Requirements

- Node.js + npm
- A Groq API key (`GROQ_API_KEY`)
- Android SDK (for local builds) — or just use the included GitHub Actions
  workflow, which builds the APK in the cloud with no local SDK setup needed

## Setup (local build)

```bash
npm install
npm run build
npx cap sync android
cd android && ./gradlew assembleDebug
