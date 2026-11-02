package com.katkee

import android.Manifest
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.uimanager.ViewManager

/**
 * Keeps a call's microphone (and, on a video call, camera) working while Katkee is in the
 * background: since Android 9 an app in the background hears only silence unless a foreground
 * service of the right type is running. It shows the "Ongoing call" notification (on the "calls"
 * channel, silently) that returns to the call, and stops when the call ends (calls/callAudio.ts)
 * or the app is swiped away.
 */
class OngoingCallService : Service() {
  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val title = intent?.getStringExtra(EXTRA_TITLE)?.takeIf { it.isNotBlank() } ?: getString(R.string.app_name)
    val video = intent?.getBooleanExtra(EXTRA_VIDEO, false) ?: false
    val open = packageManager.getLaunchIntentForPackage(packageName)?.apply {
      // this.flags: the Intent's, not onStartCommand's `flags` parameter of the same name.
      this.flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT
    }
    val notification = NotificationCompat.Builder(this, "calls")
      .setSmallIcon(R.drawable.ic_notification)
      .setColor(ContextCompat.getColor(this, R.color.notification_accent))
      .setContentTitle(title)
      .setContentText(getString(if (video) R.string.ongoing_video_call else R.string.ongoing_voice_call))
      .setCategory(NotificationCompat.CATEGORY_CALL)
      .setOngoing(true)
      .setSilent(true)
      .setUsesChronometer(true)
      .apply { if (open != null) setContentIntent(PendingIntent.getActivity(this@OngoingCallService, 0, open, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)) }
      .build()
    var types = 0
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
      types = ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
      // The camera type only with the camera permission granted (Android 14 refuses it otherwise).
      if (video && ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
        types = types or ServiceInfo.FOREGROUND_SERVICE_TYPE_CAMERA
      }
    }
    try {
      ServiceCompat.startForeground(this, NOTIFICATION_ID, notification, types)
    } catch (_: Exception) {
      // Not allowed now (started from the background, permission withdrawn): the call goes on in the foreground.
      stopSelf()
    }
    return START_NOT_STICKY
  }

  // Swiped away from recent apps: the call ended with the app, so the notification goes too.
  override fun onTaskRemoved(rootIntent: Intent?) {
    stopSelf()
  }

  companion object {
    const val EXTRA_TITLE = "title"
    const val EXTRA_VIDEO = "video"
    private const val NOTIFICATION_ID = 7268
  }
}

class OngoingCallModule(context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  override fun getName() = "KatkeeOngoingCall"

  @ReactMethod
  fun start(title: String, video: Boolean) {
    val intent = Intent(reactApplicationContext, OngoingCallService::class.java)
      .putExtra(OngoingCallService.EXTRA_TITLE, title)
      .putExtra(OngoingCallService.EXTRA_VIDEO, video)
    try {
      ContextCompat.startForegroundService(reactApplicationContext, intent)
    } catch (_: Exception) {
      // Android 12+ refuses to start it from the background; the app starts it as the call connects.
    }
  }

  @ReactMethod
  fun stop() {
    reactApplicationContext.stopService(Intent(reactApplicationContext, OngoingCallService::class.java))
  }
}

class OngoingCallPackage : ReactPackage {
  override fun createNativeModules(context: ReactApplicationContext): List<NativeModule> = listOf(OngoingCallModule(context))
  override fun createViewManagers(context: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
}
