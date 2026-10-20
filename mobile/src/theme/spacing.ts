export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
} as const;

export const radii = {
  sm: 8,
  md: 14,
  lg: 20,
  pill: 999,
} as const;

/**
 * Widest a sign-in or sign-up form gets: on a tablet (or a phone held sideways) it stays a
 * centred column instead of stretching edge to edge.
 */
export const FORM_MAX_WIDTH = 480;
