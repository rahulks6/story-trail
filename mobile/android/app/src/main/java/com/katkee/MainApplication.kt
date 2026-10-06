package com.katkee

import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager
import android.os.Build
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
          // Packages that cannot be autolinked yet can be added manually here, for example:
          // add(MyReactNativePackage())
        },
    )
  }

  override fun onCreate() {
    super.onCreate()
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
      ),
    )
  }
}
