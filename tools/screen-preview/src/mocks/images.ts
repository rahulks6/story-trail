// Sample pictures for the preview only: soft gradients drawn as SVG, no real people's photos.
const svg = (a: string, b: string, extra = "") =>
  // React Native for Web encodes inline SVG itself.
  "data:image/svg+xml;utf8," + (
    `<svg xmlns='http://www.w3.org/2000/svg' width='300' height='400' viewBox='0 0 300 400'><defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'><stop offset='0' stop-color='${a}'/><stop offset='1' stop-color='${b}'/></linearGradient></defs><rect width='300' height='400' fill='url(#g)'/>${extra}</svg>`);
const sun = "<circle cx='210' cy='120' r='46' fill='rgba(255,255,255,0.55)'/>";
const hills = "<path d='M0 300 Q80 220 160 290 T300 260 V400 H0Z' fill='rgba(0,0,0,0.25)'/>";
const waves = "<path d='M0 320 Q75 290 150 320 T300 320 V400 H0Z' fill='rgba(255,255,255,0.3)'/>";
export const covers: Record<string, string> = {
  m0: svg("#ff9a3c", "#c2185b", sun + hills),
  m1: svg("#43cea2", "#185a9d", waves),
  m2: svg("#f7971e", "#ffd200", "<circle cx='150' cy='200' r='70' fill='rgba(140,60,0,0.35)'/>"),
  m3: svg("#8e2de2", "#4a00e0", sun),
  m4: svg("#11998e", "#38ef7d", hills),
  m5: svg("#ee0979", "#ff6a00", waves),
};
export const avatars: Record<string, string> = {
  a_me: svg("#ffb347", "#ff5e62", "<circle cx='150' cy='150' r='70' fill='rgba(255,255,255,0.85)'/><rect x='60' y='240' width='180' height='160' rx='90' fill='rgba(255,255,255,0.85)'/>"),
  a_asha: svg("#36d1dc", "#5b86e5", "<circle cx='150' cy='150' r='70' fill='rgba(255,255,255,0.85)'/><rect x='60' y='240' width='180' height='160' rx='90' fill='rgba(255,255,255,0.85)'/>"),
  a_kabir: svg("#834d9b", "#d04ed6", "<circle cx='150' cy='150' r='70' fill='rgba(255,255,255,0.85)'/><rect x='60' y='240' width='180' height='160' rx='90' fill='rgba(255,255,255,0.85)'/>"),
};
