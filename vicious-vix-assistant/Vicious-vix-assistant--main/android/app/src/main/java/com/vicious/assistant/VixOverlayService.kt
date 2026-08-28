package com.vicious.assistant

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.graphics.Color
import android.graphics.PixelFormat
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.IBinder
import android.provider.MediaStore
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import android.widget.Button
import android.widget.EditText
import android.widget.ImageView
import android.widget.LinearLayout
import kotlin.math.abs

/**
 * A small floating bubble (like a chat head) that stays on top of whatever
 * app is in front. Tap it to open a tiny panel with a text field and a mic
 * button, so you can fire a quick command — call, navigate, open camera,
 * open files, open the repo — without switching back to Vicious first.
 *
 * Anything it doesn't recognize as a device action just brings the main
 * Vicious app to the foreground instead, so you can finish it there.
 */
class VixOverlayService : Service() {

    private lateinit var windowManager: WindowManager
    private var bubbleView: View? = null
    private var panelView: View? = null
    private var speechRecognizer: android.speech.SpeechRecognizer? = null

    companion object {
        private const val CHANNEL_ID = "vix_overlay_channel"
        private const val NOTIF_ID = 1001
        const val ACTION_STOP = "com.vicious.assistant.STOP_OVERLAY"
        private const val GITHUB_USERNAME = "renaealisha54-debug"
        private const val DEFAULT_REPO = "VICIOUSASSISTANT"
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        windowManager = getSystemService(WINDOW_SERVICE) as WindowManager
        startForegroundWithNotification()
        showBubble()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            stopSelf()
        }
        return START_STICKY
    }

    private fun startForegroundWithNotification() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID, "Vicious Bubble", NotificationManager.IMPORTANCE_MIN
            )
            (getSystemService(NOTIFICATION_SERVICE) as NotificationManager)
                .createNotificationChannel(channel)
        }

        val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Notification.Builder(this, CHANNEL_ID)
        } else {
            @Suppress("DEPRECATION")
            Notification.Builder(this)
        }

        val notification = builder
            .setContentTitle("Vicious is active")
            .setContentText("Tap the bubble to send a quick command")
            .setSmallIcon(android.R.drawable.ic_menu_send)
            .setOngoing(true)
            .build()

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            startForeground(NOTIF_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
        } else {
            startForeground(NOTIF_ID, notification)
        }
    }

    // --- Bubble ---------------------------------------------------------

    private fun overlayType() =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
        else
            @Suppress("DEPRECATION") WindowManager.LayoutParams.TYPE_PHONE

    private fun showBubble() {
        val bubble = ImageView(this).apply {
            setImageResource(android.R.drawable.ic_btn_speak_now)
            setBackgroundColor(Color.parseColor("#3B82F6"))
            setPadding(28, 28, 28, 28)
        }

        val params = WindowManager.LayoutParams(
            140, 140,
            overlayType(),
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE,
            PixelFormat.TRANSLUCENT
        )
        params.gravity = Gravity.TOP or Gravity.START
        params.x = 0
        params.y = 300

        var initialX = 0
        var initialY = 0
        var initialTouchX = 0f
        var initialTouchY = 0f
        var moved = false

        bubble.setOnTouchListener { _, event ->
            when (event.action) {
                MotionEvent.ACTION_DOWN -> {
                    initialX = params.x
                    initialY = params.y
                    initialTouchX = event.rawX
                    initialTouchY = event.rawY
                    moved = false
                    true
                }
                MotionEvent.ACTION_MOVE -> {
                    val dx = (event.rawX - initialTouchX).toInt()
                    val dy = (event.rawY - initialTouchY).toInt()
                    if (abs(dx) > 12 || abs(dy) > 12) moved = true
                    params.x = initialX + dx
                    params.y = initialY + dy
                    runCatching { windowManager.updateViewLayout(bubble, params) }
                    true
                }
                MotionEvent.ACTION_UP -> {
                    if (!moved) togglePanel()
                    true
                }
                else -> false
            }
        }

        runCatching { windowManager.addView(bubble, params) }
        bubbleView = bubble
    }

    private fun togglePanel() {
        if (panelView != null) hidePanel() else showPanel()
    }

    private fun showPanel() {
        val context = this
        val container = LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.parseColor("#1c2226"))
            setPadding(28, 28, 28, 28)
        }

        val input = EditText(context).apply {
            hint = "Command..."
            setTextColor(Color.WHITE)
            setHintTextColor(Color.LTGRAY)
        }

        val row = LinearLayout(context).apply { orientation = LinearLayout.HORIZONTAL }
        val micButton = Button(context).apply { text = "Mic" }
        val sendButton = Button(context).apply { text = "Send" }
        val closeButton = Button(context).apply { text = "Close" }
        row.addView(micButton)
        row.addView(sendButton)
        row.addView(closeButton)

        container.addView(input)
        container.addView(row)

        val params = WindowManager.LayoutParams(
            WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.WRAP_CONTENT,
            overlayType(),
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE,
            PixelFormat.TRANSLUCENT
        )
        params.gravity = Gravity.TOP or Gravity.START
        params.x = 40
        params.y = 460

        sendButton.setOnClickListener {
            val text = input.text.toString()
            if (text.isNotBlank()) handleCommand(text)
        }

        micButton.setOnClickListener {
            startListening { transcript -> handleCommand(transcript) }
        }

        closeButton.setOnClickListener { hidePanel() }

        runCatching { windowManager.addView(container, params) }
        panelView = container
    }

    private fun hidePanel() {
        panelView?.let { runCatching { windowManager.removeView(it) } }
        panelView = null
    }

    // --- Offline-capable native speech-to-text ---------------------------

    private fun startListening(onResult: (String) -> Unit) {
        if (!android.speech.SpeechRecognizer.isRecognitionAvailable(this)) return
        speechRecognizer?.destroy()
        speechRecognizer = android.speech.SpeechRecognizer.createSpeechRecognizer(this)

        val intent = Intent(android.speech.RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
            putExtra(android.speech.RecognizerIntent.EXTRA_LANGUAGE_MODEL, android.speech.RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            putExtra(android.speech.RecognizerIntent.EXTRA_PREFER_OFFLINE, true)
        }

        speechRecognizer?.setRecognitionListener(object : android.speech.RecognitionListener {
            override fun onResults(results: Bundle?) {
                val matches = results?.getStringArrayList(android.speech.SpeechRecognizer.RESULTS_RECOGNITION)
                matches?.firstOrNull()?.let { onResult(it) }
            }
            override fun onReadyForSpeech(params: Bundle?) {}
            override fun onBeginningOfSpeech() {}
            override fun onRmsChanged(rmsdB: Float) {}
            override fun onBufferReceived(buffer: ByteArray?) {}
            override fun onEndOfSpeech() {}
            override fun onError(error: Int) {}
            override fun onPartialResults(partialResults: Bundle?) {}
            override fun onEvent(eventType: Int, params: Bundle?) {}
        })

        runCatching { speechRecognizer?.startListening(intent) }
    }

    // --- Same device-action set as the JS layer, so this works standalone ---

    private fun handleCommand(text: String) {
        val lower = text.lowercase().trim()
        var handled = false

        Regex("""\b(?:call|dial|phone)\s+([\d()+\-.\s]{6,})$""").find(lower)?.let {
            val digits = it.groupValues[1].filter { c -> c.isDigit() || c == '+' }
            runCatching {
                startActivity(
                    Intent(Intent.ACTION_DIAL, Uri.parse("tel:$digits"))
                        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                )
            }
            handled = true
        }

        if (!handled) {
            Regex("""^(?:navigate to|directions to|take me to|drive to|map)\s+(.+)""", RegexOption.IGNORE_CASE)
                .find(text)?.let {
                    val dest = Uri.encode(it.groupValues[1].trim())
                    val uri = Uri.parse("https://www.google.com/maps/dir/?api=1&destination=$dest")
                    runCatching {
                        startActivity(Intent(Intent.ACTION_VIEW, uri).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                    }
                    handled = true
                }
        }

        if (!handled && (lower == "open camera" || lower == "launch camera" ||
                lower.contains("take a photo") || lower.contains("take a picture"))
        ) {
            runCatching {
                startActivity(Intent(MediaStore.ACTION_IMAGE_CAPTURE).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            }
            handled = true
        }

        if (!handled && (lower == "open files" || lower == "open file manager" || lower == "open my files")) {
            val candidates = listOf(
                "com.sec.android.app.myfiles",
                "com.google.android.apps.nbu.files",
                "com.android.documentsui"
            )
            for (pkg in candidates) {
                val launch = packageManager.getLaunchIntentForPackage(pkg)
                if (launch != null) {
                    launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    runCatching { startActivity(launch) }
                    handled = true
                    break
                }
            }
        }

        if (!handled && (lower.contains("repo") || lower.contains("github"))) {
            val uri = Uri.parse("https://github.com/$GITHUB_USERNAME/$DEFAULT_REPO")
            runCatching {
                startActivity(Intent(Intent.ACTION_VIEW, uri).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            }
            handled = true
        }

        // Anything else — just bring the full app to the front so it can be finished there
        if (!handled) {
            val launch = packageManager.getLaunchIntentForPackage(packageName)
            launch?.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT)
            launch?.let { runCatching { startActivity(it) } }
        }

        hidePanel()
    }

    override fun onDestroy() {
        super.onDestroy()
        bubbleView?.let { runCatching { windowManager.removeView(it) } }
        panelView?.let { runCatching { windowManager.removeView(it) } }
        speechRecognizer?.destroy()
    }
}
