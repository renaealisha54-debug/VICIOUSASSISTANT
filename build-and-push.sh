#!/data/data/com.termux/files/usr/bin/bash
set -e

GIT_ROOT="$HOME/vicious-clean"
PROJECT_DIR="$GIT_ROOT/vicious-vix-assistant/Vicious-vix-assistant--main"

cd "$PROJECT_DIR"
echo "==> Building web bundle"
npm run build

echo "==> Syncing Capacitor"
npx cap sync android

echo "==> Building APK"
cd android
./gradlew assembleDebug
cd "$PROJECT_DIR"

APK_SRC="android/app/build/outputs/apk/debug/app-debug.apk"
APK_DEST="$HOME/storage/downloads/app-debug.apk"
cp "$APK_SRC" "$APK_DEST"
echo "==> APK copied to $APK_DEST"

echo "==> Committing build to git"
cd "$GIT_ROOT"
git add -A

if git diff --cached --quiet; then
  echo "==> No source changes since last build — nothing to commit"
else
  TIMESTAMP=$(date "+%Y-%m-%d %H:%M:%S")
  git commit -m "Build: $TIMESTAMP"
  git push
  echo "==> Pushed to GitHub"
fi
