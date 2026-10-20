package com.katkee

import android.content.pm.ActivityInfo
import android.content.res.Configuration
import android.os.Bundle

import androidx.activity.enableEdgeToEdge
import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate

class MainActivity : ReactActivity() {
  // react-native-screens: never restore fragments after process death; the
  // navigator rebuilds its own state, and restoring stale fragments crashes.
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    lockPortraitOnPhones(resources.configuration)
    super.onCreate(null)
  }

  // A foldable can open into a tablet-sized screen without recreating the activity.
  override fun onConfigurationChanged(newConfig: Configuration) {
    super.onConfigurationChanged(newConfig)
    lockPortraitOnPhones(newConfig)
  }

  /**
   * Phones stay portrait; tablets and unfolded foldables (600 dp and wider) follow the device, as
   * Android 16 expects of large screens. Done here rather than in the manifest so it can tell them apart.
   */
  private fun lockPortraitOnPhones(config: Configuration) {
    val wanted =
        if (config.smallestScreenWidthDp < 600) ActivityInfo.SCREEN_ORIENTATION_PORTRAIT
        else ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
    if (requestedOrientation != wanted) requestedOrientation = wanted
  }

  /**
   * Returns the name of the main component registered from JavaScript. This is used to schedule
   * rendering of the component.
   */
  override fun getMainComponentName(): String = "KatkeeMobile"

  /**
   * Returns the instance of the [ReactActivityDelegate]. We use [DefaultReactActivityDelegate]
   * which allows you to enable New Architecture with a single boolean flags [fabricEnabled]
   */
  override fun createReactActivityDelegate(): ReactActivityDelegate =
      DefaultReactActivityDelegate(this, mainComponentName, fabricEnabled)
}
