package com.katkee

import android.text.Spannable
import androidx.emoji2.text.EmojiCompat
import com.facebook.react.ReactPackage
import com.facebook.react.ViewManagerOnDemandReactPackage
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager
import com.facebook.react.views.text.ReactTextViewManager
import com.facebook.react.views.text.ReactTextViewManagerCallback

/**
 * Emoji that the phone's own font lacks (each Android version stops at the emoji of its year)
 * get EmojiCompat's bundled glyphs instead of empty boxes (MainApplication initialises it).
 *
 * ReactTextView is an AppCompatTextView, so it already draws them; but Fabric measures text
 * separately, in TextLayoutManager, from the same Spannable before any view sees it. An emoji
 * drawn wider than the box it was measured as would wrap inside its measured frame and be cut
 * off (a short chat bubble, a Story caption). Adding EmojiCompat's spans here, where React
 * Native hands every <Text> Spannable to its RCTText manager for measuring and for drawing,
 * keeps the two the same. EmojiCompat only replaces emoji the system font can't draw, so newer
 * phones keep their own.
 */
private val emojiCompatSpans = ReactTextViewManagerCallback { text: Spannable ->
  // The font loads in the background while the JavaScript bundle starts, so it is ready before
  // the first screen; anything measured sooner keeps the system glyphs until it next changes.
  if (EmojiCompat.isConfigured() && EmojiCompat.get().loadState == EmojiCompat.LOAD_STATE_SUCCEEDED) {
    // A Spannable is updated in place, so the result is the same object.
    EmojiCompat.get().process(text)
  }
}

/** Replaces React Native's RCTText manager: listed before MainReactPackage, it is found first. */
class EmojiTextPackage : ReactPackage, ViewManagerOnDemandReactPackage {
  override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<in Nothing, in Nothing>> =
    listOf(ReactTextViewManager(emojiCompatSpans))

  override fun getViewManagerNames(reactContext: ReactApplicationContext): Collection<String> =
    listOf(ReactTextViewManager.REACT_CLASS)

  override fun createViewManager(reactContext: ReactApplicationContext, viewManagerName: String): ViewManager<in Nothing, in Nothing>? =
    if (viewManagerName == ReactTextViewManager.REACT_CLASS) ReactTextViewManager(emojiCompatSpans) else null
}
