package com.vicious.assistant

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.content.Intent
import android.graphics.Path
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import okhttp3.Call
import okhttp3.Callback
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.util.UUID

/**
 * Watches WHICHEVER app is currently in the foreground for UI-freeze
 * (no content change for DELAY_THRESHOLD_MS) — no package name needs to
 * be configured. On a detected freeze it:
 *   1. Types a short fallback reply into the currently focused field
 *   2. Logs a developer-facing diagnosis (why it likely stalled + a fix to try)
 *      to VixLogStore, readable from the app's Settings screen.
 *
 * NOTE: this can only detect a *proxy* for "hasn't responded" — unchanged
 * screen content. It cannot inspect any app's internal AI/logic state.
 * It is intentionally unscoped (watches every foreground app, not just one) —
 * this was a deliberate choice, not an oversight; know that it will act on
 * ANY app that goes idle for the threshold window, not just the one you're
 * developing.
 */
class VixAccessibilityService : AccessibilityService() {

    private val handler = Handler(Looper.getMainLooper())
    private var currentPackage: String? = null
    private var lastChangeAt = System.currentTimeMillis()
    private var delayWatchdog: Runnable? = null
    private val httpClient = OkHttpClient()

    companion object {
        const val DELAY_THRESHOLD_MS = 6000L
        val GROQ_API_KEY = BuildConfig.GROQ_API_KEY
        const val GROQ_MODEL = "openai/gpt-oss-120b"
        private const val TAG = "VixAccessibility"
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        event ?: return
        val pkg = event.packageName?.toString() ?: return

        if (pkg != currentPackage) {
            currentPackage = pkg
        }

        lastChangeAt = System.currentTimeMillis()
        armWatchdog(pkg)
    }

    private fun armWatchdog(pkg: String) {
        delayWatchdog?.let { handler.removeCallbacks(it) }
        val check = Runnable {
            if (currentPackage == pkg) {
                val idleFor = System.currentTimeMillis() - lastChangeAt
                if (idleFor >= DELAY_THRESHOLD_MS) {
                    onResponseDelayDetected(pkg, idleFor)
                }
            }
        }
        delayWatchdog = check
        handler.postDelayed(check, DELAY_THRESHOLD_MS)
    }

    /** Called when the current foreground app has shown no UI change for the threshold window. */
    private fun onResponseDelayDetected(pkg: String, idleMs: Long) {
        askGroqDiagnosis(pkg, idleMs) { userReply, diagnosis ->
            if (userReply != null) {
                typeIntoFocusedField(userReply)
            }
            VixLogStore.append(
                applicationContext,
                VixLogEntry(
                    id = UUID.randomUUID().toString(),
                    timestamp = System.currentTimeMillis(),
                    packageName = pkg,
                    idleMs = idleMs,
                    typedReply = userReply,
                    diagnosis = diagnosis
                )
            )
        }
    }

    /**
     * Asks Groq for two things at once: a short safe reply to type into the
     * stalled field, and a developer-facing diagnosis of why it likely stalled.
     * If the network call fails outright (offline), still logs a useful
     * local, template-based diagnosis instead of losing the event.
     */
    private fun askGroqDiagnosis(pkg: String, idleMs: Long, onResult: (String?, String?) -> Unit) {
        if (GROQ_API_KEY.isBlank()) {
            handler.post {
                onResult(
                    null,
                    "No GROQ_API_KEY configured (set it in android/local.properties). " +
                        "Local pattern only: $pkg showed no UI change for ${idleMs}ms — " +
                        "either a bug (promise/callback with no timeout, blocked main thread, " +
                        "a loading state that never clears) or the app simply doesn't yet " +
                        "handle this kind of input/command."
                )
            }
            return
        }

        val prompt = """
            You are Vix, an on-device watchdog for an app under development (package: $pkg).
            Its UI has shown no change for ${idleMs}ms, which usually means the app's own
            response logic is stuck, looping, never returned a result, or simply doesn't
            understand/handle whatever the user just asked it to do.
            Respond with ONLY a JSON object, no other text, no markdown fences:
            {
              "userReply": "a short, generic, safe message to type into the current field so the user isn't left staring at nothing",
              "diagnosis": "1-3 sentences for the DEVELOPER of this app, covering whichever applies: (a) if it looks like a bug — the likely code-level cause (e.g. unresolved promise, missing timeout/fallback branch, infinite loop, blocked main thread, unhandled network error) and a concrete fix to try; (b) if it looks like the app just never learned to handle this kind of input — what command/intent it likely failed to recognize, and what handling it should add to understand it next time. Cover both if both plausibly apply."
            }
        """.trimIndent()

        val body = JSONObject().apply {
            put("model", GROQ_MODEL)
            put("messages", JSONArray().put(
                JSONObject().apply {
                    put("role", "user")
                    put("content", prompt)
                }
            ))
        }

        val request = Request.Builder()
            .url("https://api.groq.com/openai/v1/chat/completions")
            .addHeader("Authorization", "Bearer $GROQ_API_KEY")
            .post(body.toString().toRequestBody("application/json".toMediaType()))
            .build()

        httpClient.newCall(request).enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) {
                Log.e(TAG, "Groq request failed", e)
                // Offline / network-failure fallback — still log something useful
                handler.post {
                    onResult(
                        null,
                        "Network unreachable — could not reach Groq for a diagnosis. " +
                            "Local pattern only: $pkg showed no UI change for ${idleMs}ms — " +
                            "either a bug (hung network call, unresolved async task with no " +
                            "timeout, a loading state that never clears) or the app simply " +
                            "doesn't yet handle this kind of input/command."
                    )
                }
            }

            override fun onResponse(call: Call, response: okhttp3.Response) {
                val text = response.body?.string()
                var userReply: String? = null
                var diagnosis: String? = null
                try {
                    val content = JSONObject(text ?: "{}")
                        .getJSONArray("choices")
                        .getJSONObject(0)
                        .getJSONObject("message")
                        .getString("content")
                    val cleaned = content.replace("```json", "").replace("```", "").trim()
                    val parsed = JSONObject(cleaned)
                    userReply = parsed.optString("userReply").ifEmpty { null }
                    diagnosis = parsed.optString("diagnosis").ifEmpty { null }
                } catch (e: Exception) {
                    Log.e(TAG, "Failed to parse Groq response", e)
                    diagnosis = "Groq responded but the diagnosis couldn't be parsed. " +
                        "$pkg showed no UI change for ${idleMs}ms."
                }
                handler.post { onResult(userReply, diagnosis) }
            }
        })
    }

    // --- Actions a voice layer can call ---

    fun tapAt(x: Float, y: Float) {
        val path = Path().apply { moveTo(x, y) }
        val gesture = GestureDescription.Builder()
            .addStroke(GestureDescription.StrokeDescription(path, 0, 100))
            .build()
        dispatchGesture(gesture, null, null)
    }

    fun typeIntoFocusedField(text: String) {
        val root: AccessibilityNodeInfo = rootInActiveWindow ?: return
        val focused = root.findFocus(AccessibilityNodeInfo.FOCUS_INPUT) ?: return
        val arguments = android.os.Bundle().apply {
            putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, text)
        }
        focused.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, arguments)
    }

    fun openApp(packageName: String) {
        val launchIntent = packageManager.getLaunchIntentForPackage(packageName) ?: return
        launchIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        startActivity(launchIntent)
    }

    fun globalNav(action: String) {
        when (action) {
            "back" -> performGlobalAction(GLOBAL_ACTION_BACK)
            "home" -> performGlobalAction(GLOBAL_ACTION_HOME)
            "recents" -> performGlobalAction(GLOBAL_ACTION_RECENTS)
        }
    }

    override fun onInterrupt() {}
}
