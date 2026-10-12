import React from "react";
import Svg, { Path } from "react-native-svg";
import { colors } from "../theme/colors";
import { BRAND_MARK } from "./brandMarkPaths";

/**
 * The Katkee mark, the K and its dot from the app icon (traced from the master by
 * scripts/brand-assets.cjs, so it is the same shape as the icon and the launch screen). Drawn in
 * the app's own colours, to match the wordmark next to it (BRAND.md). Decorative: screens name
 * Katkee in text.
 */
export function BrandMark({ height }: { height: number }): React.JSX.Element {
  return (
    <Svg
      width={(height * BRAND_MARK.width) / BRAND_MARK.height}
      height={height}
      viewBox={BRAND_MARK.viewBox}
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      testID="brand-mark"
    >
      <Path d={BRAND_MARK.k} fill={colors.textPrimary} fillRule="evenodd" />
      <Path d={BRAND_MARK.dot} fill={colors.accent} />
    </Svg>
  );
}
