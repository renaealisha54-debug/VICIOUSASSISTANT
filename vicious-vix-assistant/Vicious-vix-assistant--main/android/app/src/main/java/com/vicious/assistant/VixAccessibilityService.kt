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

/**
 * Watches WHICHEVER app is currently in the foreground for UI-freeze
 * (no content change for DELAY_THRESHOLD_MS) — no package name needs to
 * be configured. On a detected freeze, asks Groq for a short fallback
 * response.
 *
 * NOTE: this can only detect a *proxy* for "hasn't responded" — unchanged
 * screen content. It cannot inspect any app's internal AI state.
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
                    onResponseDelayDetected(pkg)
                }
            }
        }
        delayWatchdog = check
        handler.postDelayed(check, DELAY_THRESHOLD_MS)
    }

    /** Called when the current foreground app has shown no UI change for the threshold window. */
    private fun onResponseDelayDetected(pkg: String) {
        askGroq("The app $pkg seems to be taking a while to respond. In one short sentence, suggest what the user could try next.") { reply ->
            if (reply != null) {
                typeIntoFocusedField(reply)
            }
        }
    }

    /** Fire-and-callback Groq chat completion request. */
    private fun askGroq(prompt: String, onResult: (String?) -> Unit) {
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
                handler.post { onResult(null) }
            }

            override fun onResponse(call: Call, response: okhttp3.Response) {
                val text = response.body?.string()
                val reply = try {
                    JSONObject(text ?: "{}")
                        .getJSONArray("choices")
                        .getJSONObject(0)
                        .getJSONObject("message")
                        .getString("content")
                } catch (e: Exception) {
                    Log.e(TAG, "Failed to parse Groq response", e)
                    null
                }
                handler.post { onResult(reply) }
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
