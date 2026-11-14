// Illustrated people and places for the "Apne Log" ad. Flat vector, no real people.
// person(o) draws a student in a 300 x 600 box (feet at the bottom): skin, hair style and
// colour, top and trouser colours, arm angles, expression, blink, and an optional phone or cup.

const SKIN = ["#F2C9A0", "#E0AC7E", "#C68A5E", "#9E6B45"];

function arm(x, y, angle, len, color, skin, hold) {
  // angle 0 = straight down; positive swings forward/out to the right.
  const r = (angle * Math.PI) / 180;
  const ex = x + Math.sin(r) * len, ey = y + Math.cos(r) * len;
  let held = "";
  if (hold === "phone") held = `<g transform="translate(${ex},${ey}) rotate(${-angle * 0.4})"><rect x="-17" y="-34" width="34" height="58" rx="7" fill="#1B1E25"/><rect x="-13" y="-29" width="26" height="46" rx="4" fill="#FFC800" opacity=".9"/></g>`;
  if (hold === "cup") held = `<g transform="translate(${ex},${ey - 6})"><path d="M-16 -26 h32 l-5 34 h-22 z" fill="#B65A2E"/><path d="M-16 -26 h32" stroke="#8E3F1C" stroke-width="5"/><path d="M-4 -34 q4 -10 0 -18 M6 -36 q4 -10 0 -18" stroke="#fff" stroke-width="3" fill="none" opacity=".7"/></g>`;
  return `<path d="M${x} ${y} L${ex} ${ey}" stroke="${color}" stroke-width="34" stroke-linecap="round"/>${held}<circle cx="${ex}" cy="${ey}" r="16" fill="${skin}"/>`;
}

function hairBack(style, c) {
  if (style === "long") return `<path d="M88 140 q-14 120 10 210 h104 q24 -90 10 -210 z" fill="${c}"/>`;
  if (style === "bun") return `<circle cx="150" cy="70" r="30" fill="${c}"/>`;
  if (style === "curly") return `<g fill="${c}">${[[100, 110], [120, 85], [150, 78], [180, 85], [200, 110], [210, 140], [92, 140]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="26"/>`).join("")}</g>`;
  return "";
}
function hairFront(style, c) {
  if (style === "long") return `<path d="M90 150 q0 -70 60 -72 q62 2 62 72 q-30 -40 -78 -30 q-26 6 -44 30z" fill="${c}"/>`;
  if (style === "bun") return `<path d="M92 148 q2 -64 58 -66 q58 2 58 66 q-22 -30 -58 -32 q-38 2 -58 32z" fill="${c}"/>`;
  if (style === "short") return `<path d="M92 145 q-4 -70 58 -72 q64 0 60 70 q-8 -26 -30 -34 q-30 14 -88 36z" fill="${c}"/>`;
  if (style === "curly") return `<g fill="${c}">${[[110, 100], [135, 88], [165, 88], [190, 100]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="22"/>`).join("")}</g>`;
  return "";
}

function face(expr, blink, look = 0) {
  const ey = blink ? `<path d="M118 160 q10 6 20 0 M162 160 q10 6 20 0" stroke="#2A1D17" stroke-width="5" fill="none" stroke-linecap="round"/>`
    : `<ellipse cx="${128 + look}" cy="158" rx="7" ry="9" fill="#2A1D17"/><ellipse cx="${172 + look}" cy="158" rx="7" ry="9" fill="#2A1D17"/><circle cx="${130 + look}" cy="155" r="2.5" fill="#fff"/><circle cx="${174 + look}" cy="155" r="2.5" fill="#fff"/>`;
  const brows = expr === "smug" ? `<path d="M114 138 q14 -10 28 -2 M158 134 q14 -4 28 4" stroke="#2A1D17" stroke-width="5" fill="none" stroke-linecap="round"/>`
    : `<path d="M116 140 q12 -8 26 -2 M158 138 q14 -6 26 2" stroke="#2A1D17" stroke-width="5" fill="none" stroke-linecap="round"/>`;
  let mouth = `<path d="M134 192 q16 14 32 0" stroke="#7A2E22" stroke-width="5" fill="none" stroke-linecap="round"/>`;
  if (expr === "laugh") mouth = `<path d="M128 186 q22 34 44 0 z" fill="#7A2E22"/><path d="M134 192 q16 10 32 0" fill="#fff"/>`;
  if (expr === "o") mouth = `<ellipse cx="150" cy="194" rx="9" ry="11" fill="#7A2E22"/>`;
  if (expr === "smug") mouth = `<path d="M136 194 q18 8 32 -6" stroke="#7A2E22" stroke-width="5" fill="none" stroke-linecap="round"/>`;
  if (expr === "sleepy") mouth = `<path d="M140 196 h20" stroke="#7A2E22" stroke-width="5" stroke-linecap="round"/>`;
  return `${brows}${ey}<ellipse cx="116" cy="182" rx="11" ry="6" fill="#E8836B" opacity=".35"/><ellipse cx="184" cy="182" rx="11" ry="6" fill="#E8836B" opacity=".35"/>${mouth}`;
}

function person(o) {
  const skin = o.skin ?? SKIN[1];
  const hair = o.hair ?? "#2A1D17";
  const top = o.top ?? "#4C6EF5";
  const pants = o.pants ?? "#2D3142";
  const aL = o.armL ?? 8, aR = o.armR ?? -8;
  const legs = o.sit ? `<rect x="104" y="430" width="92" height="60" rx="24" fill="${pants}"/>`
    : `<rect x="110" y="420" width="38" height="150" rx="18" fill="${pants}"/><rect x="152" y="420" width="38" height="150" rx="18" fill="${pants}"/><rect x="102" y="556" width="50" height="22" rx="11" fill="#F5F5F5"/><rect x="150" y="556" width="50" height="22" rx="11" fill="#F5F5F5"/>`;
  const bag = o.bag ? `<path d="M110 250 L190 430" stroke="${o.bag}" stroke-width="12"/>` : "";
  const glasses = o.glasses ? `<g stroke="#2A1D17" stroke-width="4" fill="none"><circle cx="128" cy="158" r="17"/><circle cx="172" cy="158" r="17"/><path d="M145 158 h10"/></g>` : "";
  return `<g>
    ${hairBack(o.hairStyle, hair)}
    ${legs}
    ${arm(98, 262, aL, 120, top, skin, o.holdL)}
    <path d="M88 300 q0 -60 62 -62 q62 2 62 62 v130 h-124z" fill="${top}"/>
    ${o.hood ? `<path d="M110 240 q40 30 80 0" stroke="rgba(0,0,0,.18)" stroke-width="10" fill="none"/>` : ""}
    ${o.print ? `<text x="150" y="350" text-anchor="middle" font-family="Inter" font-weight="900" font-size="26" fill="rgba(255,255,255,.85)">${o.print}</text>` : ""}
    ${bag}
    ${arm(202, 262, aR, 120, top, skin, o.holdR)}
    <rect x="134" y="210" width="32" height="34" fill="${skin}"/>
    <ellipse cx="150" cy="158" rx="62" ry="68" fill="${skin}"/>
    <ellipse cx="88" cy="162" rx="10" ry="14" fill="${skin}"/><ellipse cx="212" cy="162" rx="10" ry="14" fill="${skin}"/>
    ${o.earring ? `<circle cx="88" cy="182" r="5" fill="#FFC800"/><circle cx="212" cy="182" r="5" fill="#FFC800"/>` : ""}
    ${face(o.expr ?? "smile", o.blink, o.look ?? 0)}
    ${glasses}
    ${hairFront(o.hairStyle, hair)}
  </g>`;
}

// ---------- Places (1080 x 1920) ----------
const corridor = () => `
  <rect width="1080" height="1920" fill="#F6E7C8"/>
  <rect y="1380" width="1080" height="540" fill="#D9C3A0"/>
  <path d="M0 1380 h1080" stroke="#C7AE88" stroke-width="10"/>
  ${[0, 1, 2, 3, 4].map((i) => `<rect x="${40 + i * 210}" y="620" width="180" height="740" rx="10" fill="#7FA7C9"/><rect x="${60 + i * 210}" y="660" width="140" height="18" rx="6" fill="#6A92B4"/><rect x="${60 + i * 210}" y="700" width="140" height="18" rx="6" fill="#6A92B4"/><circle cx="${190 + i * 210}" cy="1000" r="9" fill="#4E7392"/>`).join("")}
  <rect x="300" y="260" width="480" height="260" rx="12" fill="#B9874F"/><rect x="320" y="280" width="440" height="220" rx="6" fill="#E9D3A8"/>
  <rect x="345" y="300" width="130" height="90" fill="#fff" transform="rotate(-4 410 345)"/><rect x="500" y="310" width="110" height="140" fill="#FFE07A" transform="rotate(3 555 380)"/><rect x="630" y="300" width="110" height="90" fill="#FFB3C1" transform="rotate(-2 685 345)"/>`;

const library = () => `
  <rect width="1080" height="1920" fill="#EADBC8"/>
  ${[0, 1, 2].map((r) => `<rect x="0" y="${380 + r * 300}" width="1080" height="24" fill="#8A5A3C"/>${Array.from({ length: 16 }, (_, i) => `<rect x="${20 + i * 66}" y="${230 + r * 300 + (i % 3) * 10}" width="52" height="${150 - (i % 3) * 10}" rx="4" fill="${["#C0392B", "#2E86AB", "#F4A259", "#5B8E7D", "#8E7DBE"][(i + r) % 5]}"/>`).join("")}`).join("")}
  <rect y="1300" width="1080" height="620" fill="#B98B64"/><rect y="1300" width="1080" height="30" fill="#9C7150"/>`;

const classroom = () => `
  <rect width="1080" height="1920" fill="#DDE8E4"/>
  <rect x="140" y="220" width="800" height="440" rx="14" fill="#2F4F46"/><rect x="160" y="240" width="760" height="400" rx="6" fill="#36594F"/>
  <text x="540" y="400" text-anchor="middle" font-family="Caveat, cursive" font-size="70" fill="#E8F0EC">∫ x² dx = x³/3 + C</text>
  <text x="540" y="500" text-anchor="middle" font-family="Caveat, cursive" font-size="54" fill="#E8F0EC">Lecture 7: Integration</text>
  <rect y="1340" width="1080" height="580" fill="#A7754E"/><rect y="1340" width="1080" height="28" fill="#8B5E3C"/>`;

const hostel = () => `
  <rect width="1080" height="1920" fill="#C9D6F2"/>
  <rect x="680" y="260" width="300" height="360" rx="10" fill="#FFF6D8"/><path d="M830 260 v360 M680 440 h300" stroke="#E2CF9C" stroke-width="12"/>
  <rect x="80" y="300" width="200" height="140" rx="8" fill="#FF8FA3"/><text x="180" y="385" text-anchor="middle" font-family="Inter" font-weight="900" font-size="40" fill="#fff">NO EXAMS</text>
  <rect x="0" y="1180" width="1080" height="300" rx="30" fill="#5C7AEA"/><rect x="40" y="1130" width="300" height="110" rx="40" fill="#F4F4F4"/>
  <rect y="1480" width="1080" height="440" fill="#8C6A54"/>`;

const tapri = (t = 0) => `
  <defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FF9A5A"/><stop offset=".55" stop-color="#FFC56B"/><stop offset="1" stop-color="#FFE3A3"/></linearGradient></defs>
  <rect width="1080" height="1920" fill="url(#sky)"/>
  <circle cx="820" cy="560" r="120" fill="#FFF1C1" opacity=".9"/>
  <path d="M0 900 q200 -60 400 -10 t400 -20 t280 10 v1040 h-1080z" fill="#E9A15A" opacity=".55"/>
  <rect x="60" y="560" width="560" height="700" rx="12" fill="#6B3E26"/>
  <rect x="150" y="300" width="380" height="120" rx="14" fill="#4A2A19"/><text x="340" y="385" text-anchor="middle" font-family="Yatra One, Inter" font-size="76" fill="#FFC800">चाय टपरी</text><path d="M30 560 h620 l-40 -120 h-540z" fill="#E63946"/>${[0, 1, 2, 3, 4, 5].map((i) => `<path d="M${70 + i * 90} 440 l-20 120 h45 l15 -120z" fill="#FFF" opacity=".85"/>`).join("")}
  
  <rect x="110" y="760" width="460" height="200" rx="10" fill="#4A2A19"/>
  <ellipse cx="240" cy="740" rx="70" ry="20" fill="#9AA0A6"/><path d="M175 740 q0 -90 65 -90 q65 0 65 90z" fill="#B0B6BC"/>
  <path d="M230 640 q10 -${30 + 6 * Math.sin(t * 3)} 0 -60 M260 630 q10 -${30 + 6 * Math.cos(t * 3)} 0 -60" stroke="#fff" stroke-width="7" fill="none" opacity=".6" stroke-linecap="round"/>
  ${[0, 1, 2, 3, 4].map((i) => `<path d="M${380 + i * 36} 720 h28 l-4 34 h-20z" fill="#B65A2E"/>`).join("")}
  <rect y="1500" width="1080" height="420" fill="#B07A50"/><rect y="1500" width="1080" height="20" fill="#946240"/>`;

const yellow = () => `<rect width="1080" height="1920" fill="#FFC800"/>`;

module.exports = { person, SKIN, corridor, library, classroom, hostel, tapri, yellow };
