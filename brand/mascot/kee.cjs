// Kee, Katkee's mascot, drawn as SVG so every pose and animation frame is sharp at any size.
// Kee is the app icon come to life: the light rounded card is the body, the dark screen is the
// face, and the amber dot from the logo floats above the head as Kee's "spark".
//
//   const { kee } = require("./kee.cjs");
//   kee({ eyes: "happy", mouth: "grin", armR: 160, spark: "heart" })  -> "<g>…</g>" (viewBox 0 0 400 500)

const C = {
  card: "#E4E8F0", // body: the logo's light card
  screen: "#0B0F17", // face: the logo's dark screen
  ink: "#0B0F17", // outlines, so Kee reads on light and dark backgrounds
  amber: "#FFC800", // Katkee amber
  amberDeep: "#FCB020", // the logo dot
  red: "#FF3040", // like-heart red
  white: "#FFFFFF",
};

const SHOULDER_L = [90, 242];
const SHOULDER_R = [310, 242];
const ARM = 84;

// angle: degrees away from hanging straight down, measured outward (0 = down, 90 = sideways, 180 = up).
function hand(side, angle) {
  const [sx, sy] = side === "L" ? SHOULDER_L : SHOULDER_R;
  const a = (angle * Math.PI) / 180;
  const dx = Math.sin(a) * ARM * (side === "L" ? -1 : 1);
  const dy = Math.cos(a) * ARM;
  return [sx + dx, sy + dy];
}

function limb(x1, y1, x2, y2, bend = 0) {
  // A soft cartoon limb: a dark outline under a light stroke, slightly curved.
  const mx = (x1 + x2) / 2 + bend;
  const my = (y1 + y2) / 2;
  const d = `M${x1},${y1} Q${mx},${my} ${x2},${y2}`;
  return `<path d="${d}" stroke="${C.ink}" stroke-width="30" fill="none" stroke-linecap="round"/>
          <path d="${d}" stroke="${C.card}" stroke-width="18" fill="none" stroke-linecap="round"/>`;
}

function heartPath(cx, cy, s) {
  return `M${cx},${cy + s * 0.9} C${cx - s * 1.6},${cy - s * 0.1} ${cx - s * 0.9},${cy - s * 1.3} ${cx},${cy - s * 0.45}
          C${cx + s * 0.9},${cy - s * 1.3} ${cx + s * 1.6},${cy - s * 0.1} ${cx},${cy + s * 0.9}Z`;
}

function starPath(cx, cy, r) {
  let d = "";
  for (let i = 0; i < 10; i++) {
    const rr = i % 2 ? r * 0.45 : r;
    const a = (Math.PI / 5) * i - Math.PI / 2;
    d += `${i ? "L" : "M"}${cx + Math.cos(a) * rr},${cy + Math.sin(a) * rr}`;
  }
  return d + "Z";
}

function eye(cx, cy, kind, look) {
  const [lx, ly] = look;
  switch (kind) {
    case "happy": // ^ ^
      return `<path d="M${cx - 15},${cy + 6} Q${cx},${cy - 16} ${cx + 15},${cy + 6}" stroke="${C.white}" stroke-width="7" fill="none" stroke-linecap="round"/>`;
    case "closed":
      return `<path d="M${cx - 14},${cy + 2} Q${cx},${cy + 9} ${cx + 14},${cy + 2}" stroke="${C.white}" stroke-width="6" fill="none" stroke-linecap="round"/>`;
    case "heart":
      return `<path d="${heartPath(cx, cy, 15)}" fill="${C.red}"/>`;
    case "star":
      return `<path d="${starPath(cx, cy, 19)}" fill="${C.amber}"/>`;
    case "wide":
      return `<ellipse cx="${cx}" cy="${cy}" rx="20" ry="25" fill="${C.white}"/>
              <circle cx="${cx + lx}" cy="${cy + ly}" r="6" fill="${C.screen}"/>`;
    case "sad":
      return `<ellipse cx="${cx}" cy="${cy + 3}" rx="15" ry="18" fill="${C.white}"/>
              <circle cx="${cx + lx}" cy="${cy + 7 + ly}" r="8" fill="${C.screen}"/>
              <path d="M${cx - 18},${cy - 18} L${cx + 14},${cy - 26}" stroke="${C.white}" stroke-width="5" stroke-linecap="round" transform="${cx < 200 ? "" : `scale(-1,1) translate(${-2 * cx},0)`}"/>`;
    default: // open
      return `<ellipse cx="${cx}" cy="${cy}" rx="20" ry="26" fill="${C.white}"/>
              <circle cx="${cx + lx}" cy="${cy + 3 + ly}" r="11" fill="${C.screen}"/>
              <circle cx="${cx + lx + 4}" cy="${cy - 2 + ly}" r="4" fill="${C.white}"/>`;
  }
}

function mouth(kind) {
  const y = 282;
  switch (kind) {
    case "grin":
      return `<path d="M176,${y - 6} Q200,${y - 2} 224,${y - 6} Q222,${y + 22} 200,${y + 24} Q178,${y + 22} 176,${y - 6}Z" fill="${C.white}"/>
              <path d="M188,${y + 16} Q200,${y + 8} 212,${y + 16} Q206,${y + 23} 200,${y + 23} Q194,${y + 23} 188,${y + 16}Z" fill="${C.red}"/>`;
    case "o":
      return `<ellipse cx="200" cy="${y + 6}" rx="10" ry="13" fill="${C.white}"/>
              <ellipse cx="200" cy="${y + 8}" rx="5" ry="7" fill="${C.screen}"/>`;
    case "frown":
      return `<path d="M184,${y + 12} Q200,${y - 2} 216,${y + 12}" stroke="${C.white}" stroke-width="6" fill="none" stroke-linecap="round"/>`;
    case "flat":
      return `<path d="M186,${y + 4} L214,${y + 4}" stroke="${C.white}" stroke-width="6" stroke-linecap="round"/>`;
    case "smirk":
      return `<path d="M184,${y + 4} Q204,${y + 14} 218,${y - 2}" stroke="${C.white}" stroke-width="6" fill="none" stroke-linecap="round"/>`;
    default: // smile
      return `<path d="M182,${y} Q200,${y + 18} 218,${y}" stroke="${C.white}" stroke-width="6" fill="none" stroke-linecap="round"/>`;
  }
}

function spark(kind, glow) {
  const cx = 200;
  const cy = 64;
  const halo = `<circle cx="${cx}" cy="${cy}" r="${34 + glow * 8}" fill="${C.amber}" opacity="${0.18 + glow * 0.12}"/>`;
  switch (kind) {
    case "none":
      return "";
    case "heart":
      return `<circle cx="${cx}" cy="${cy}" r="${34 + glow * 8}" fill="${C.red}" opacity="0.18"/>
              <path d="${heartPath(cx, cy + 2, 22)}" fill="${C.red}" stroke="${C.ink}" stroke-width="5"/>`;
    case "note":
      return `${halo}<g fill="${C.amberDeep}" stroke="${C.ink}" stroke-width="5" stroke-linejoin="round">
                <path d="M188,40 L218,32 L218,78 A11,9 0 1,1 210,70 L210,48 L196,52 L196,86 A11,9 0 1,1 188,78Z"/></g>`;
    case "bang":
      return `${halo}<circle cx="${cx}" cy="${cy}" r="24" fill="${C.amberDeep}" stroke="${C.ink}" stroke-width="5"/>
              <path d="M200,48 L200,68" stroke="${C.ink}" stroke-width="7" stroke-linecap="round"/><circle cx="200" cy="79" r="4.5" fill="${C.ink}"/>`;
    case "star":
      return `${halo}<path d="${starPath(cx, cy, 30)}" fill="${C.amber}" stroke="${C.ink}" stroke-width="5" stroke-linejoin="round"/>`;
    default: // dot: the logo's amber dot
      return `${halo}<circle cx="${cx}" cy="${cy}" r="24" fill="${C.amberDeep}" stroke="${C.ink}" stroke-width="5"/>
              <circle cx="${cx - 8}" cy="${cy - 8}" r="6" fill="${C.white}" opacity="0.7"/>`;
  }
}

function phoneProp(x, y, rot) {
  return `<g transform="translate(${x},${y}) rotate(${rot})">
    <rect x="-22" y="-38" width="44" height="76" rx="10" fill="${C.screen}" stroke="${C.card}" stroke-width="5"/>
    <circle cx="-7" cy="-20" r="6" fill="${C.amberDeep}"/></g>`;
}

/**
 * Draw Kee. All options are optional.
 * eyes: open | happy | closed | heart | star | wide | sad | wink
 * mouth: smile | grin | o | frown | flat | smirk
 * armL / armR: angle in degrees (0 down, 90 out, 180 up)
 * legs: stand | jump | walkA | walkB
 * spark: dot | heart | note | bang | star | none
 * look: [x, y] pupil offset; tilt: body rotation; bob: vertical offset; squash: 1 = normal
 * phone: "R" to hold a phone in the right hand; blush: true/false
 */
function kee(o = {}) {
  const eyes = o.eyes || "open";
  const armL = o.armL ?? 22;
  const armR = o.armR ?? 22;
  const look = o.look || [0, 0];
  const tilt = o.tilt || 0;
  const bob = o.bob || 0;
  const squash = o.squash || 1;
  const glow = o.glow ?? 0.5;

  const [hlx, hly] = hand("L", armL);
  const [hrx, hry] = hand("R", armR);

  let legs;
  switch (o.legs) {
    case "jump":
      legs = limb(165, 368, 150, 412, -6) + limb(235, 368, 250, 412, 6);
      legs += `<ellipse cx="143" cy="420" rx="24" ry="13" fill="${C.amber}" stroke="${C.ink}" stroke-width="5" transform="rotate(-18 143 420)"/>
               <ellipse cx="257" cy="420" rx="24" ry="13" fill="${C.amber}" stroke="${C.ink}" stroke-width="5" transform="rotate(18 257 420)"/>`;
      break;
    case "walkA":
    case "walkB": {
      const f = o.legs === "walkA" ? 1 : -1;
      legs = limb(165, 368, 165 - 16 * f, 432, 0) + limb(235, 368, 235 + 16 * f, 432, 0);
      legs += `<ellipse cx="${161 - 16 * f}" cy="440" rx="25" ry="13" fill="${C.amber}" stroke="${C.ink}" stroke-width="5"/>
               <ellipse cx="${239 + 16 * f}" cy="440" rx="25" ry="13" fill="${C.amber}" stroke="${C.ink}" stroke-width="5"/>`;
      break;
    }
    default:
      legs = limb(168, 368, 164, 432, 0) + limb(232, 368, 236, 432, 0);
      legs += `<ellipse cx="158" cy="440" rx="26" ry="13" fill="${C.amber}" stroke="${C.ink}" stroke-width="5"/>
               <ellipse cx="242" cy="440" rx="26" ry="13" fill="${C.amber}" stroke="${C.ink}" stroke-width="5"/>`;
  }

  const eyeL = eye(166, 218, eyes === "wink" ? "open" : eyes, look);
  const eyeR = eye(234, 218, eyes === "wink" ? "happy" : eyes, look);
  const blush = o.blush === false ? "" : `<ellipse cx="146" cy="260" rx="13" ry="7" fill="#FF7A8A" opacity="0.6"/>
                 <ellipse cx="254" cy="260" rx="13" ry="7" fill="#FF7A8A" opacity="0.6"/>`;
  const handDot = (x, y) => `<circle cx="${x}" cy="${y}" r="15" fill="${C.card}" stroke="${C.ink}" stroke-width="6"/>`;
  const phone = o.phone === "R" ? phoneProp(hrx + 4, hry - 22, -12) : "";

  // Squash/stretch around the feet so jumps feel alive.
  const body = `
    <g transform="translate(0,${bob}) rotate(${tilt} 200 300) translate(200,440) scale(${1 / Math.sqrt(squash)},${squash}) translate(-200,-440)">
      ${legs}
      ${limb(SHOULDER_L[0], SHOULDER_L[1], hlx, hly, armL > 100 ? 10 : -6)}
      ${limb(SHOULDER_R[0], SHOULDER_R[1], hrx, hry, armR > 100 ? -10 : 6)}
      <rect x="96" y="108" width="208" height="268" rx="62" fill="${C.card}" stroke="${C.ink}" stroke-width="7"/>
      <rect x="120" y="132" width="160" height="220" rx="44" fill="${C.screen}"/>
      ${blush}${eyeL}${eyeR}${mouth(o.mouth || "smile")}
      ${handDot(hlx, hly)}${handDot(hrx, hry)}${phone}
      <g transform="translate(0,${Math.sin((o.t || 0) * 3) * 4})">${spark(o.spark || "dot", glow)}</g>
    </g>`;
  return body;
}

function svg(inner, { w = 400, h = 500, viewBox = "0 0 400 500", bg = "" } = {}) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="${viewBox}">${bg}${inner}</svg>`;
}

// The named poses people will reuse in videos.
const POSES = {
  hello: { eyes: "happy", mouth: "grin", armR: 155, spark: "dot" },
  happy: { eyes: "open", mouth: "smile" },
  excited: { eyes: "star", mouth: "grin", armL: 150, armR: 150, legs: "jump", spark: "star" },
  love: { eyes: "heart", mouth: "smile", spark: "heart", armL: 60, armR: 60 },
  surprised: { eyes: "wide", mouth: "o", spark: "bang", armL: 110, armR: 110 },
  wink: { eyes: "wink", mouth: "smirk", armR: 120 },
  sad: { eyes: "sad", mouth: "frown", spark: "none", blush: false, armL: 8, armR: 8 },
  music: { eyes: "closed", mouth: "smile", spark: "note", tilt: -8, armL: 130, armR: 60 },
  selfie: { eyes: "open", mouth: "grin", phone: "R", armR: 150, look: [5, -3], spark: "dot" },
  pointUp: { eyes: "open", mouth: "grin", armR: 178, look: [3, -6], spark: "dot" },
  thinking: { eyes: "open", mouth: "flat", look: [6, -7], armR: 150, spark: "dot" },
  celebrate: { eyes: "happy", mouth: "grin", armL: 165, armR: 165, legs: "jump", spark: "star" },
};

module.exports = { kee, svg, POSES, C };
