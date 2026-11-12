package com.katkee

import android.app.Application
import android.app.Notification
import android.app.NotificationChannel
import android.media.AudioAttributes
import android.media.RingtoneManager
import android.app.NotificationManager
import android.os.Build
import androidx.emoji2.bundled.BundledEmojiCompatConfig
import androidx.emoji2.text.EmojiCompat
import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactHost
import com.facebook.react.ReactNativeApplicationEntryPoint.loadReactNative
import com.facebook.react.defaults.DefaultReactHost.getDefaultReactHost

class MainApplication : Application(), ReactApplication {

  override val reactHost: ReactHost by lazy {
    getDefaultReactHost(
      context = applicationContext,
      packageList =
        PackageList(this).packages.apply {
          // Text that measures and draws emoji the system font lacks (EmojiTextPackage.kt).
          add(0, EmojiTextPackage())
          // Reloads the app when its appearance (light or dark) changes.
          add(AppRestartPackage())
          // Which invite a Google Play install came from (InstallReferrerPackage.kt).
          add(InstallReferrerPackage())
          // Google Play's in-app review card (InAppReviewPackage.kt).
          add(InAppReviewPackage())
          // OngoingCallPackage() (OngoingCallService.kt) comes back with calls; see the manifest.
        },
    )
  }

  override fun onCreate() {
    super.onCreate()
    // Before any view exists: AppCompat text views and inputs only use EmojiCompat when it is
    // configured as they are created. The bundled font, not the downloadable one, because the
    // phones that need it most are the ones with old or missing Google Play services
    // (the manifest removes androidx.startup's downloadable-font initialiser).
    EmojiCompat.init(BundledEmojiCompatConfig(this))
    createNotificationChannels()
    loadReactNative(this)
  }

  /**
   * The channels pushes are posted to: the server picks one per notification
   * (backend/src/modules/push/dispatcher.ts) and "activity" is the default (firebase.json).
   * Without them Android files every notification under "Miscellaneous", and people can't
   * silence likes without silencing their messages. Recreating them on each start is cheap
   * and keeps the names current; Android keeps the importance and sound each person chose.
   */
  private fun createNotificationChannels() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val manager = getSystemService(NotificationManager::class.java) ?: return
    manager.createNotificationChannels(
      listOf(
        NotificationChannel("messages", getString(R.string.notification_channel_messages), NotificationManager.IMPORTANCE_HIGH)
          .apply { description = getString(R.string.notification_channel_messages_description) },
        NotificationChannel("activity", getString(R.string.notification_channel_activity), NotificationManager.IMPORTANCE_DEFAULT)
          .apply { description = getString(R.string.notification_channel_activity_description) },
        // Incoming calls ring with the phone's ringtone, like a phone call; the ongoing-call
        // notification is posted here silently.
        NotificationChannel("calls", getString(R.string.notification_channel_calls), NotificationManager.IMPORTANCE_HIGH)
          .apply {
            description = getString(R.string.notification_channel_calls_description)
            setSound(
              RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE),
              AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build(),
            )
            enableVibration(true)
            vibrationPattern = longArrayOf(0, 1000, 1000, 1000, 1000)
            lockscreenVisibility = Notification.VISIBILITY_PUBLIC
          },
      ),
    )
  }
}
