package com.vicious.assistant

import android.content.ComponentName
import android.content.Intent
import android.provider.Settings
import android.text.TextUtils
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

@CapacitorPlugin(name = "VixAccessibility")
class VixAccessibilityPlugin : Plugin() {

    @PluginMethod
    fun openApp(call: PluginCall) {
        val candidates = call.getArray("packageNames")?.toList<String>() ?: emptyList()
        for (pkg in candidates) {
            val launchIntent = context.packageManager.getLaunchIntentForPackage(pkg)
            if (launchIntent != null) {
                launchIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                context.startActivity(launchIntent)
                val ret = JSObject()
                ret.put("opened", true)
                ret.put("packageName", pkg)
                call.resolve(ret)
                return
            }
        }
        val ret = JSObject()
        ret.put("opened", false)
        call.resolve(ret)
    }

    @PluginMethod
    fun isEnabled(call: PluginCall) {
        val ret = JSObject()
        ret.put("enabled", isAccessibilityServiceEnabled())
        call.resolve(ret)
    }

    @PluginMethod
    fun openSettings(call: PluginCall) {
        val intent = Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        context.startActivity(intent)
        call.resolve()
    }

    @PluginMethod
    fun getLog(call: PluginCall) {
        val entries = VixLogStore.getAll(context)
        val arr = JSArray()
        for (e in entries) {
            val obj = JSObject()
            obj.put("id", e.id)
            obj.put("timestamp", e.timestamp)
            obj.put("packageName", e.packageName)
            obj.put("idleMs", e.idleMs)
            obj.put("typedReply", e.typedReply ?: "")
            obj.put("diagnosis", e.diagnosis ?: "")
            arr.put(obj)
        }
        val ret = JSObject()
        ret.put("entries", arr)
        call.resolve(ret)
    }

    @PluginMethod
    fun clearLog(call: PluginCall) {
        VixLogStore.clear(context)
        call.resolve()
    }

    private fun isAccessibilityServiceEnabled(): Boolean {
        val expected = ComponentName(context, VixAccessibilityService::class.java)
        val enabledServices = Settings.Secure.getString(
            context.contentResolver,
            Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES
        ) ?: return false

        val splitter = TextUtils.SimpleStringSplitter(':')
        splitter.setString(enabledServices)
        while (splitter.hasNext()) {
            val componentName = ComponentName.unflattenFromString(splitter.next())
            if (componentName != null && componentName == expected) return true
        }
        return false
    }
}
