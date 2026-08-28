# PROJECT CONTEXT — read this before doing anything else

## Rules for any AI working on this project
1. This is an **existing** project. Do NOT scaffold a new app, do NOT create a
   new project folder, do NOT start over. Work only within the files already here.
2. Before making any change, look at what already exists — this project has
   working native Android code (Kotlin) alongside the Next.js/Capacitor web layer.
   Read the relevant files first.
3. If genuinely unsure what a feature is for or whether something already
   exists, ask before building a duplicate.

## What this app is
"Vicious Assistant" — an Android app built with Next.js (static export) +
Capacitor, developed entirely from a phone via Termux. Two parts:
1. A Groq-powered AI chat/utility app with real device actions (call, maps,
   camera, file manager, GitHub repo shortcuts).
2. A native Android **Accessibility Service watchdog** that watches the
   foreground app for stalls (6+ seconds with no UI change), auto-types a
   fallback reply into the focused field, and logs a developer-facing
   diagnosis (why it likely stalled + a fix to try). Long-term goal: make
   this work fully offline as a QA aid for other apps under development.

## Build & deploy — the ONLY way this project builds
```bash
cd ~/vicious-clean
./build-and-push.sh
```
Run from `~/vicious-clean` (git root), NOT from the project folder. It builds
the web bundle, syncs Capacitor, builds the APK, copies it to
`~/storage/downloads/app-debug.apk`, and auto-commits + pushes to GitHub if
anything changed. Do not manually run `npm run build` / `gradlew` steps
separately unless actively debugging — use the script.

## Environment facts (already fought through, don't rediscover)
- Termux, Node LTS, Gradle. Installed JDK resolves to **version 21**
  (despite the package being named `openjdk-17`) — Kotlin `jvmTarget` and
  Java `compileOptions` must both be set to 21, or the build fails with a
  JVM-target mismatch.
- `compileSdk`/`targetSdk` = 36, `minSdk` = 24 — this is a very new target
  SDK, so newer Android manifest requirements apply (e.g. foreground
  service types must declare `android:foregroundServiceType` and, for
  `specialUse`, a `PROPERTY_SPECIAL_USE_FGS_SUBTYPE` property).
- Kotlin Gradle plugin (`1.9.24`) had to be added manually — it wasn't
  configured at all originally, so `.kt` files were silently not compiling.
- Two separate Groq API keys exist on purpose:
  - Web layer: entered in the app's own Settings screen, stored in
    `localStorage`.
  - Native layer: `android/local.properties` → `GROQ_API_KEY=...`
    (gitignored, used by the Kotlin Accessibility Service via `BuildConfig`).

## Repo layout
- Git root: `~/vicious-clean`
- Actual project root (package.json, src/, android/):
  `~/vicious-clean/vicious-vix-assistant/Vicious-vix-assistant--main/`
- Main UI: `src/components/vicious/vicious-hud.tsx`
- Native plugin bridge: `src/lib/vix-accessibility.ts`
- Native Kotlin: `android/app/src/main/java/com/vicious/assistant/`
  (`MainActivity.java`, `VixAccessibilityService.kt`,
  `VixAccessibilityPlugin.kt`, `VixLogStore.kt`, `VixOverlayService.kt`)

## Explicit design decisions — do not silently change these
- The Accessibility watchdog is **intentionally unscoped**: it watches
  whichever app is currently in the foreground, not just one target app.
  The user was warned about this and chose it deliberately.
- On a detected stall it **both** logs the event **and** auto-types a
  fallback reply (not log-only).
- A floating draggable "bubble" overlay (`VixOverlayService.kt`) exists so
  the user can fire quick device-action commands (call, navigate, camera,
  files, open repo) without switching back to the main app — it has its
  own standalone copy of the command logic in Kotlin.

## Not built yet (known gaps, not oversights)
- Microphone in the main chat UI is still broken (uses browser-only
  `webkitSpeechRecognition`, which doesn't exist in a Capacitor WebView).
- Reminders are an in-app list only — not real scheduled OS notifications.
- No weather feature.
- No real GitHub push (only "open repo in browser" was built).
- No on-device/offline LLM — diagnosis falls back to a local template when
  Groq is unreachable, but there's no offline model.

## Security context
The GitHub repo (`renaealisha54-debug/VICIOUSASSISTANT`, private) originally
leaked the user's entire Termux home directory before being locked down.
`.gitignore` at the git root now prevents that recurring — don't remove or
weaken it.
