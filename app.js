import { firebaseConfig } from "./firebase-config.js?v=6";

const SDK = "https://www.gstatic.com/firebasejs/10.14.1/";

/* ---------- public, non-personal data ---------- */
const TAG = { locked: "Locked", book: "To book", flex: "Flexible", trans: "Transit" };
const CATS = [["book", "Book & reserve"], ["docs", "Documents & entry"], ["phone", "Phone, data & money"], ["pack", "Packing"], ["go", "Departure day"]];
const SOS = [["Police", "110"], ["Ambulance / Fire", "119"]];
const PUBLIC_CONTACTS = [
  { n: "Japan Visitor Hotline", num: "050-3816-2787", note: "24/7 in English. Medical help, lost items, disasters." },
  { n: "Police, English line", num: "03-3503-8484", note: "Non-emergency questions." },
  { n: "U.S. Embassy Tokyo", num: "+81-3-3224-5000", note: "Lost passport or serious trouble." },
  { n: "U.S. Consulate Osaka-Kobe", num: "+81-6-6315-5900", note: "Closer while you're in Osaka and Kyoto." }
];
const MON = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/* ---------- helpers ---------- */
const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const fmt = d => { const [, m, dd] = d.split("-"); return MON[+m] + " " + (+dd); };
const jstNow = () => new Date(Date.now() + 9 * 3600e3);
const jstDate = () => jstNow().toISOString().slice(0, 10);
const gmap = q => "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(q);
const telHref = n => "tel:" + String(n).replace(/[^+\d]/g, "");

function copy(text, el) {
  try { navigator.clipboard.writeText(text).then(() => flash(el, "Copied"), () => selectNum(el)); } catch (e) { selectNum(el); }
}
function selectNum(el) {
  const n = el.closest(".contact")?.querySelector(".num");
  if (n) { const r = document.createRange(); r.selectNodeContents(n); const s = getSelection(); s.removeAllRanges(); s.addRange(r); }
  flash(el, "Selected");
}
function flash(el, t) { const o = el.textContent; el.textContent = t; setTimeout(() => (el.textContent = o), 1200); }

/* ---------- state ---------- */
const S = {
  fb: null, db: null, auth: null, storage: null,
  uid: null, email: null,
  trip: undefined, todos: null, photos: null, ours: null, users: {},
  busy: new Set(), armed: new Map(), filter: "all", lb: -1, lbList: [], lbAlbum: false, albumList: [], unsubs: [],
  journal: null, eats: null, tickets: null, kFile: null, tv: { list: [], i: 0 }, wake: null, jEdit: null, jFiles: [], eRating: 0, eKind: "all", eFile: null, eatsView: []
};
const days = () => (S.trip && Array.isArray(S.trip.days) ? S.trip.days : []);

/* ---------- tabs ---------- */
const TABS = ["plan", "todo", "journal", "eats", "photos", "info"];
const PANELS = { plan: ["plan"], todo: ["todo"], journal: ["journal"], eats: ["eats"], photos: ["photos"], info: ["tickets", "contacts", "map"] };
const ALL_PANELS = ["plan", "todo", "journal", "eats", "photos", "tickets", "contacts", "map"];
function show(tab) {
  if (tab === "map" || tab === "contacts" || tab === "tickets") tab = "info";
  if (!TABS.includes(tab)) tab = "plan";
  ALL_PANELS.forEach(p => { const el = $("p-" + p); if (el) el.hidden = !PANELS[tab].includes(p); });
  TABS.forEach(t => $("n-" + t)?.setAttribute("aria-current", t === tab ? "page" : "false"));
  try { localStorage.setItem("jt-tab", tab); } catch (e) {}
  window.scrollTo(0, 0);
  if (tab === "plan") { const el = $("d-" + jstDate()); if (el) el.scrollIntoView({ block: "start" }); }
}
window.addEventListener("hashchange", () => { if (S.uid) show(location.hash.slice(1)); });

/* ---------- header + clocks ---------- */
function renderHeader() {
  if (S.trip) {
    $("title").textContent = S.trip.title || "Our Japan Trip";
    $("subtitle").textContent = S.trip.subtitle || "";
  }
}
function tick() {
  const o = { hour: "2-digit", minute: "2-digit", weekday: "short", hour12: false };
  try {
    $("jst").textContent = new Intl.DateTimeFormat("en-US", { ...o, timeZone: "Asia/Tokyo" }).format(new Date());
    $("pt").textContent = new Intl.DateTimeFormat("en-US", { ...o, timeZone: "America/Los_Angeles" }).format(new Date());
  } catch (e) {}
  const dep = Date.parse(S.trip?.depart || ""), ret = Date.parse(S.trip?.return || ""), n = Date.now();
  if (!dep || !ret) { $("cdk").textContent = "Departure"; $("cd").textContent = "--"; return; }
  const total = Math.max(1, days().length);
  if (n < dep) { const d = Math.floor((dep - n) / 864e5), h = Math.floor(((dep - n) % 864e5) / 36e5); $("cdk").textContent = "Until departure"; $("cd").textContent = `${d}d ${h}h`; }
  else if (n < ret) { $("cdk").textContent = "Trip day"; $("cd").textContent = `${Math.min(Math.floor((n - dep) / 864e5) + 1, total)} of ${total}`; }
  else { $("cdk").textContent = "Trip"; $("cd").textContent = "Complete"; }
}

/* ---------- itinerary ---------- */
function renderPlan() {
  if (S.trip === undefined) return;
  if (!days().length) {
    $("strip").innerHTML = "";
    $("days").innerHTML = `<p class="notice">No trip data yet. Tap the person icon at the top right, then Load trip data, and pick trip-data.json.</p>`;
    return;
  }
  const today = jstDate(), nowT = jstNow().toISOString().slice(11, 16);
  $("strip").innerHTML = days().map(x => `<button type="button" class="chip${x.d === today ? " today" : ""}" data-d="${esc(x.d)}"><b>${fmt(x.d)}</b><span>${esc(String(x.cityL).split(" to ")[0])}</span></button>`).join("");
  $("days").innerHTML = days().map(x => {
    const evs = (x.ev || []).filter(e => S.filter === "all" || e.s === S.filter);
    let now = -1; if (x.d === today) evs.forEach((e, i) => { if (e.t <= nowT) now = i; });
    const items = evs.map((e, i) => `<li class="ev ${esc(e.s)}${i === now ? " now" : ""}"><span class="t">${esc(e.t)}</span><div class="card"><div class="row"><h4>${esc(e.h)}</h4><span class="tag ${esc(e.s)}">${TAG[e.s] || ""}</span></div>${e.p ? `<p>${esc(e.p)}</p>` : ""}${e.steps ? `<ol class="steps">${e.steps.map(s => `<li>${esc(s)}</li>`).join("")}</ol>` : ""}</div></li>`).join("");
    const nt = (S.tickets || []).filter(k => k.day === x.d).length;
    return `<section class="day" id="d-${esc(x.d)}"><div class="day-h"><h3>${esc(x.dow)}, ${fmt(x.d)}</h3><span class="city ${esc(x.city)}">${esc(x.cityL)}</span>${nt ? `<button type="button" class="tixbtn" data-tday="${esc(x.d)}">Tickets (${nt})</button>` : ""}</div><p class="stay">${esc(x.stay)}</p>${items ? `<ol class="rail">${items}</ol>` : `<p class="empty">Nothing in this filter.</p>`}</section>`;
  }).join("");
}

/* ---------- map ---------- */
function renderMap() {
  const W = 640, H = 300, lon0 = 135.0, lon1 = 140.3, lat0 = 34.4, lat1 = 36.1;
  const kx = W / (lon1 - lon0), ky = H / ((lat1 - lat0) / 0.82);
  const P = (lo, la) => [((lo - lon0) * kx).toFixed(1), (H - ((la - lat0) / 0.82) * ky).toFixed(1)];
  const pts = { osaka: [135.495, 34.705], shin: [135.5, 34.733], kyoto: [135.758, 34.985], arash: [135.672, 35.017], nagoya: [136.882, 35.171], tokyo: [139.767, 35.681], shina: [139.739, 35.628], haneda: [139.786, 35.549], disney: [139.888, 35.627] };
  const p = k => P(...pts[k]);
  const line = (ks, cls) => `<polyline class="${cls}" points="${ks.map(k => p(k).join(",")).join(" ")}"/>`;
  const dot = (k, lab, dx, dy, big, anchor) => { const [x, y] = p(k); return `<circle cx="${x}" cy="${y}" r="${big ? 6 : 3.5}" class="${big ? "bigdot" : "dot"}"/><text x="${+x + dx}" y="${+y + dy}" class="${big ? "lab big" : "lab"}" text-anchor="${anchor || "start"}">${lab}</text>`; };
  let grid = "";
  for (let la = 35; la <= 36; la++) { const y = P(lon0, la)[1]; grid += `<line x1="0" x2="${W}" y1="${y}" y2="${y}" class="grid"/><text x="4" y="${y - 4}" class="gl">${la}°N</text>`; }
  for (let lo = 136; lo <= 140; lo++) { const x = P(lo, lat0)[0]; grid += `<line y1="0" y2="${H}" x1="${x}" x2="${x}" class="grid"/><text x="${+x + 3}" y="${H - 6}" class="gl">${lo}°E</text>`; }
  $("mapbox").innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Route: Tokyo to Osaka by Shinkansen, Osaka to Kyoto by JR, Kyoto back to Shinagawa and Haneda">
  <style>
   .grid{stroke:var(--line);stroke-width:1}
   .gl{fill:var(--muted);font:10px var(--mono)}
   .shk{fill:none;stroke:var(--ai);stroke-width:3.5;stroke-linecap:round;stroke-linejoin:round}
   .ret{fill:none;stroke:var(--shu);stroke-width:2;stroke-dasharray:6 5;stroke-linecap:round}
   .loc{fill:none;stroke:var(--kin);stroke-width:3;stroke-linecap:round}
   .dot{fill:var(--surface);stroke:var(--ink);stroke-width:1.5}
   .bigdot{fill:var(--ink)}
   .lab{fill:var(--ink);font:12px var(--body)}
   .lab.big{font-weight:700;font-size:14px}
   .leg{fill:var(--muted);font:11px var(--body)}
  </style>
  ${grid}
  ${line(["tokyo", "shina", "nagoya", "kyoto", "shin"], "shk")}
  <path class="ret" d="M${p("kyoto").join(",")} Q ${P(137.6, 35.9).join(",")} ${p("shina").join(",")}"/>
  ${line(["shin", "osaka", "kyoto"], "loc")}
  ${dot("nagoya", "Nagoya (pass through)", 0, -12, false, "middle")}
  ${dot("osaka", "Osaka", -10, 18, true, "end")}
  ${dot("kyoto", "Kyoto", 10, -10, true)}
  ${dot("arash", "Arashiyama", -8, -8, false, "end")}
  ${dot("tokyo", "Tokyo", -14, -14, true, "end")}
  ${dot("haneda", "Haneda", 8, 16, false)}
  ${dot("disney", "DisneySea", 8, 4, false)}
  <g transform="translate(${W - 232},16)">
   <rect width="220" height="70" rx="6" fill="var(--surface)" stroke="var(--line)"/>
   <line x1="12" x2="40" y1="18" y2="18" class="shk"/><text x="48" y="22" class="leg">Nozomi, Tokyo to Shin-Osaka</text>
   <line x1="12" x2="40" y1="36" y2="36" class="loc"/><text x="48" y="40" class="leg">JR Special Rapid, Osaka to Kyoto</text>
   <line x1="12" x2="40" y1="54" y2="54" class="ret"/><text x="48" y="58" class="leg">Nozomi home to Shinagawa</text>
  </g></svg>`;
  const places = S.trip?.places || [];
  $("placelist").innerHTML = places.length
    ? places.map(c => `<h3 class="h3">${esc(c.city)}</h3><div class="places">${(c.list || []).map(pl => `<div class="place"><div class="body"><b>${esc(pl.name)}</b><span>${esc(pl.sub)}</span></div><a href="${gmap(pl.q || pl.name)}" target="_blank" rel="noopener">Open in Maps</a></div>`).join("")}</div>`).join("")
    : `<p class="empty">Places load with your trip data.</p>`;
}

/* ---------- contacts ---------- */
function contactCard(c, extraActs = "") {
  return `<div class="contact"><div class="row"><b>${esc(c.n)}</b></div>${c.num ? `<div class="num">${esc(c.num)}</div>` : ""}${c.note ? `<div class="cnote">${esc(c.note)}</div>` : ""}<div class="acts">${c.num ? `<button type="button" data-copy="${esc(c.num)}">Copy number</button><a href="${telHref(c.num)}">Call</a>` : ""}${extraActs}</div></div>`;
}
function renderContacts() {
  $("sos").innerHTML = SOS.map(([n, num]) => `<div class="contact sos"><div class="k">${n}</div><div class="num">${num}</div><div class="acts"><a href="tel:${num}">Call ${num}</a></div></div>`).join("");
  $("clist").innerHTML = PUBLIC_CONTACTS.map(c => contactCard(c)).join("");
  const hotels = S.trip?.hotels || [];
  $("hotels").innerHTML = hotels.length
    ? hotels.map((h, i) => `<div class="contact"><div class="row"><b>${esc(h.name)}</b></div>${h.phone ? `<div class="num">${esc(h.phone)}</div>` : ""}${h.en ? `<div class="cnote">${esc(h.en)}</div>` : ""}${h.jp ? `<div class="jp">${esc(h.jp)}</div>` : ""}${h.note ? `<div class="cnote">${esc(h.note)}</div>` : ""}<div class="acts">${h.phone ? `<button type="button" data-copy="${esc(h.phone)}">Copy number</button><a href="${telHref(h.phone)}">Call</a>` : ""}${h.jp ? `<button type="button" data-taxi="${i}">Show driver</button>` : ""}${h.en ? `<a href="${gmap(h.en)}" target="_blank" rel="noopener">Map</a>` : ""}</div></div>`).join("")
    : `<p class="empty">Hotels load with your trip data.</p>`;
}
function renderOurs() {
  const box = $("ourlist");
  if (!S.ours) { box.innerHTML = `<p class="empty">Loading…</p>`; return; }
  if (!S.ours.length) { box.innerHTML = `<p class="empty">No contacts yet. Add Miki's number first.</p>`; return; }
  box.innerHTML = S.ours.map(c => `<div class="contact"><div class="row"><b>${esc(c.name)}</b><button type="button" class="linkbtn" data-cdel="${esc(c.id)}">Remove</button></div>${c.phone ? `<div class="num">${esc(c.phone)}</div>` : ""}${c.note ? `<div class="cnote">${esc(c.note)}</div>` : ""}${c.phone ? `<div class="acts"><button type="button" data-copy="${esc(c.phone)}">Copy number</button><a href="${telHref(c.phone)}">Call</a></div>` : ""}</div>`).join("");
}

/* ---------- names ---------- */
function nameOf(uid) {
  if (!uid) return "someone";
  if (uid === S.uid) return "you";
  return S.users[uid]?.name || "your partner";
}

/* ---------- to-do ---------- */
function renderTodo() {
  const box = $("t-groups");
  if (!S.todos) return;
  const all = S.todos, done = all.filter(t => t.done).length;
  $("t-bar").style.width = (all.length ? (done / all.length) * 100 : 0) + "%";
  $("t-count").textContent = done + " / " + all.length;
  if (!all.length) { box.innerHTML = `<p class="empty">No items yet. Load trip-data.json from Settings, or add one below.</p>`; return; }
  box.innerHTML = CATS.map(([k, label]) => {
    const items = all.filter(t => (t.cat || "pack") === k).sort((a, b) => (a.order ?? 999) - (b.order ?? 999) || String(a.text).localeCompare(b.text));
    if (!items.length) return "";
    const d = items.filter(t => t.done).length;
    return `<div class="group"><div class="group-h"><h3>${label}</h3><span class="n">${d}/${items.length}</span></div><ul class="tlist">${items.map(t => {
      const armed = S.armed.has(t.id);
      return `<li class="titem${t.done ? " done" : ""}"><input type="checkbox" id="cb-${esc(t.id)}" data-id="${esc(t.id)}" ${t.done ? "checked" : ""} ${S.busy.has(t.id) ? "disabled" : ""}><div class="body"><label for="cb-${esc(t.id)}">${esc(t.text)}</label>${t.note ? `<div class="note">${esc(t.note)}</div>` : ""}${t.link ? `<div class="note"><a href="${esc(t.link)}" target="_blank" rel="noopener">${esc(String(t.link).replace(/^https?:\/\//, "").replace(/\/$/, ""))}</a></div>` : ""}${t.done && t.doneBy ? `<div class="who">Done by ${esc(nameOf(t.doneBy))}</div>` : ""}</div><button type="button" class="x${armed ? " arm" : ""}" data-tdel="${esc(t.id)}" aria-label="Remove ${esc(t.text)}">${armed ? "Remove?" : "×"}</button></li>`;
    }).join("")}</ul></div>`;
  }).join("");
}
function toast(boxId, msg) {
  const n = document.createElement("p"); n.className = "notice"; n.textContent = msg;
  $(boxId).prepend(n); setTimeout(() => n.remove(), 4500);
}

/* ---------- photos ---------- */
function tripDays() { return days().map(d => d.d); }
function defaultDay() { const t = jstDate(), td = tripDays(); if (!td.length) return "pre"; return td.includes(t) ? t : (t < td[0] ? "pre" : "post"); }
function dayLabel(d) {
  if (d === "pre") return "Before the trip";
  if (d === "post") return "After the trip";
  const x = days().find(y => y.d === d);
  return x ? `${x.dow}, ${fmt(d)} · ${x.cityL}` : d;
}
function fillDaySelect() {
  const opts = [["pre", "Before the trip"], ...days().map(x => [x.d, `${fmt(x.d)} · ${x.cityL}`]), ["post", "After the trip"]];
  ["p-day", "j-day", "e-day", "k-day"].forEach(id => {
    const sel = $(id), keep = sel.value;
    sel.innerHTML = opts.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join("");
    sel.value = opts.some(o => o[0] === keep) ? keep : defaultDay();
  });
}
function renderPhotos() {
  const box = $("p-grid");
  if (!S.photos) return;
  const w = $("p-who").value;
  const list = S.photos.filter(p => w === "all" || (w === "me" ? p.by === S.uid : p.by !== S.uid));
  if (!list.length) { S.albumList = []; box.innerHTML = `<p class="empty">${S.photos.length ? "No photos match this filter." : "No photos yet. Tap Add photos to share the first one."}</p>`; return; }
  const order = ["post", ...[...tripDays()].reverse(), "pre"];
  const known = new Set(order);
  const groups = order.map(d => [d, list.filter(p => (p.day || "pre") === d)]);
  const stray = list.filter(p => !known.has(p.day || "pre"));
  if (stray.length) groups.push(["other", stray]);
  const g2 = groups.filter(g => g[1].length);
  S.albumList = g2.flatMap(g => g[1]);
  box.innerHTML = g2.map(([d, ps]) => `<div class="pday"><h3>${esc(d === "other" ? "Other days" : dayLabel(d))} <span class="cnt">(${ps.length})</span></h3><div class="grid">${ps.map(p => `<button type="button" class="thumb" data-ph="${esc(p.id)}" aria-label="Photo by ${esc(nameOf(p.by))}${p.caption ? ": " + esc(p.caption) : ""}"><img loading="lazy" src="${esc(p.url)}" alt="${esc(p.caption || "Trip photo")}"><span class="by">${esc(nameOf(p.by))}</span></button>`).join("")}</div></div>`).join("");
}
async function shrink(file) {
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
    const s = Math.min(1, 2048 / Math.max(bmp.width, bmp.height));
    const w = Math.round(bmp.width * s), h = Math.round(bmp.height * s);
    const cv = document.createElement("canvas"); cv.width = w; cv.height = h;
    cv.getContext("2d").drawImage(bmp, 0, 0, w, h);
    const blob = await new Promise(r => cv.toBlob(r, "image/jpeg", 0.86));
    if (blob) return { blob, type: "image/jpeg", ext: "jpg", w, h };
  } catch (e) {}
  if (/^image\/(jpeg|png|webp|gif)$/.test(file.type)) return { blob: file, type: file.type, ext: file.type.split("/")[1], w: 0, h: 0 };
  throw { code: "unsupported" };
}

/* ---------- lightbox (album, journal, and eats photos share it) ---------- */
function openViewer(list, i, album) {
  if (!list.length) return;
  S.lbList = list; S.lbAlbum = !!album; S.lb = Math.max(0, Math.min(i, list.length - 1));
  paintLb(); $("lb").hidden = false; $("lb-close").focus();
}
function openLb(id) { const i = S.albumList.findIndex(p => p.id === id); if (i >= 0) openViewer(S.albumList, i, true); }
function paintLb() {
  const p = S.lbList[S.lb]; if (!p) { closeLb(); return; }
  $("lb-img").src = p.url; $("lb-img").alt = p.caption || "Trip photo";
  $("lb-pos").textContent = `${S.lb + 1} of ${S.lbList.length}`;
  $("lb-info").textContent = `${dayLabel(p.day || "pre")} · by ${nameOf(p.by)}${p.caption ? " · " + p.caption : ""}`;
  const editable = S.lbAlbum && p.by === S.uid;
  $("lb-cap").hidden = !editable; $("lb-save").hidden = !editable; $("lb-cap").value = p.caption || "";
  $("lb-del").hidden = !editable; $("lb-del").classList.remove("arm"); $("lb-del").textContent = "Delete";
}
function closeLb() { $("lb").hidden = true; S.lb = -1; }

/* ---------- tickets ---------- */
function sortedTickets() { return [...(S.tickets || [])].sort((a, b) => String(a.day || "").localeCompare(String(b.day || "")) || String(a.time || "").localeCompare(String(b.time || "")) || String(a.order || a.id).localeCompare(String(b.order || b.id))); }
function ticketWhen(k) { const d = k.day && /^\d{4}-/.test(k.day) ? dayLabel(k.day).split(" · ")[0] : (k.day ? dayLabel(k.day) : ""); return [d, k.time].filter(Boolean).join(", "); }
function renderTickets() {
  const box = $("k-list");
  if (!S.tickets) return;
  const list = sortedTickets();
  if (!list.length) { box.innerHTML = `<p class="empty">No tickets yet. Add one, or load a trip data file that includes them.</p>`; return; }
  box.innerHTML = `<div class="tix">${list.map(k => {
    const armed = S.armed.has("k:" + k.id);
    return `<div class="tick"><h4>${esc(k.title)}</h4><div class="when">${esc(ticketWhen(k))}${k.holder ? " · " + esc(k.holder) : ""}</div>${k.number ? `<div class="num">${esc(k.number)}</div>` : ""}${k.note ? `<div class="when">${esc(k.note)}</div>` : ""}<div class="acts">${k.img ? `<button type="button" class="show" data-tshow="${esc(k.id)}">Show ticket</button>` : ""}${k.link ? `<a href="${esc(k.link)}" target="_blank" rel="noopener">Open link</a>` : ""}${k.number ? `<button type="button" data-copy="${esc(k.number)}">Copy number</button>` : ""}<button type="button" class="${armed ? "arm" : ""}" data-kdel="${esc(k.id)}">${armed ? "Tap again to delete" : "Delete"}</button></div></div>`;
  }).join("")}</div>`;
}
async function openTickets(list, i) {
  if (!list.length) return;
  S.tv = { list, i: Math.max(0, i) }; paintTv(); $("tv").hidden = false; $("tv-close").focus();
  try { if ("wakeLock" in navigator) S.wake = await navigator.wakeLock.request("screen"); } catch (e) {}
}
function paintTv() {
  const { list, i } = S.tv, k = list[i]; if (!k) return;
  $("tv-pos").textContent = list.length > 1 ? `Ticket ${i + 1} of ${list.length}` : "";
  $("tv-title").textContent = k.title || "Ticket";
  $("tv-when").textContent = [ticketWhen(k), k.holder].filter(Boolean).join(" · ");
  const img = $("tv-img");
  if (k.img) { img.hidden = false; img.src = k.img; img.alt = "Ticket code for " + (k.title || "ticket"); img.style.imageRendering = String(k.img).startsWith("data:image/png") ? "pixelated" : "auto"; }
  else { img.hidden = true; img.removeAttribute("src"); }
  $("tv-num").textContent = k.number || "";
  $("tv-note").textContent = k.note || "";
  const a = $("tv-link"); if (k.link) { a.hidden = false; a.href = k.link; } else a.hidden = true;
  $("tv-prev").disabled = i === 0; $("tv-next").disabled = i >= list.length - 1;
}
function closeTv() { $("tv").hidden = true; try { S.wake && S.wake.release(); } catch (e) {} S.wake = null; }
async function shrinkToDataURL(file) {
  const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
  const s = Math.min(1, 1100 / Math.max(bmp.width, bmp.height));
  const cv = document.createElement("canvas"); cv.width = Math.round(bmp.width * s); cv.height = Math.round(bmp.height * s);
  const ctx = cv.getContext("2d"); ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, cv.width, cv.height); ctx.drawImage(bmp, 0, 0, cv.width, cv.height);
  return cv.toDataURL("image/jpeg", 0.88);
}

/* ---------- journal ---------- */
function renderJournal() {
  const box = $("j-list");
  if (!S.journal) return;
  if (!S.journal.length) { box.innerHTML = `<p class="empty">No entries yet. Write the first one above.</p>`; return; }
  const order = ["post", ...[...tripDays()].reverse(), "pre"];
  const known = new Set(order);
  const groups = order.map(d => [d, S.journal.filter(e => (e.day || "pre") === d)]);
  const stray = S.journal.filter(e => !known.has(e.day || "pre"));
  if (stray.length) groups.push(["other", stray]);
  box.innerHTML = groups.filter(g => g[1].length).map(([d, es]) => `<div class="jday"><h3>${esc(d === "other" ? "Other days" : dayLabel(d))}</h3>${es.map(e => {
    const mine = e.by === S.uid, armed = S.armed.has("j:" + e.id);
    const when = e.at ? new Date(e.at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "";
    return `<article class="entry"><div class="meta"><span><span class="by">${esc(nameOf(e.by) === "you" ? "You" : nameOf(e.by))}</span> wrote</span><span>${esc(when)}${e.edited ? " · edited" : ""}</span></div>${e.title ? `<h4>${esc(e.title)}</h4>` : ""}<div class="txt">${esc(e.text)}</div>${(e.photos || []).length ? `<div class="minigrid">${e.photos.map((ph, i) => `<button type="button" class="thumb" data-jph="${esc(e.id)}:${i}" aria-label="Open photo ${i + 1}"><img loading="lazy" src="${esc(ph.url)}" alt=""></button>`).join("")}</div>` : ""}${mine ? `<div class="acts"><button type="button" class="linkbtn" data-jedit="${esc(e.id)}">Edit</button><button type="button" class="linkbtn${armed ? " arm" : ""}" data-jdel="${esc(e.id)}">${armed ? "Tap again to delete" : "Delete"}</button></div>` : ""}</article>`;
  }).join("")}</div>`).join("");
}
function resetJournalForm() {
  S.jEdit = null; S.jFiles = [];
  $("j-title").value = ""; $("j-text").value = ""; $("j-files").textContent = ""; $("j-mode").textContent = "";
  $("j-cancel").hidden = true; $("j-save").textContent = "Save entry"; $("j-day").value = defaultDay();
}

/* ---------- eats & drinks ---------- */
function starsRO(n) { const r = Math.round(n || 0); return `<span class="stars ro" aria-label="${r} of 5 stars">${[1, 2, 3, 4, 5].map(i => `<span class="${i <= r ? "on" : ""}">★</span>`).join("")}</span>`; }
function starsInput(id, n) { return `<span class="stars" role="group" aria-label="Your rating">${[1, 2, 3, 4, 5].map(i => `<button type="button" class="${i <= (n || 0) ? "on" : ""}" data-rate="${esc(id)}:${i}" aria-label="${i} star${i > 1 ? "s" : ""}">★</button>`).join("")}</span>`; }
function avgOf(e) { const v = Object.values(e.ratings || {}).filter(x => x > 0); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0; }
function paintFormStars() { $("e-stars").innerHTML = [1, 2, 3, 4, 5].map(i => `<button type="button" class="${i <= S.eRating ? "on" : ""}" data-frate="${i}" aria-label="${i} star${i > 1 ? "s" : ""}">★</button>`).join(""); }
function renderEats() {
  const box = $("e-list");
  if (!S.eats) return;
  let list = S.eats.filter(e => S.eKind === "all" || e.kind === S.eKind);
  if ($("e-sort").value === "top") list = [...list].sort((a, b) => avgOf(b) - avgOf(a) || (b.at || 0) - (a.at || 0));
  S.eatsView = list;
  if (!list.length) { box.innerHTML = `<p class="empty">${S.eats.length ? "Nothing in this filter yet." : "Nothing logged yet. Tap Add food or drink after your first great bite."}</p>`; return; }
  const raters = [...new Set([S.uid, ...Object.keys(S.users)])];
  box.innerHTML = `<div class="elist">${list.map(e => {
    const mine = e.by === S.uid, armed = S.armed.has("e:" + e.id), avg = avgOf(e);
    const rows = raters.map(uid => {
      const n = (e.ratings || {})[uid] || 0, who = uid === S.uid ? "You" : (S.users[uid]?.name || "Your partner");
      return `<div class="rate"><span>${esc(who)}</span>${uid === S.uid ? starsInput(e.id, n) : (n ? starsRO(n) : `<span class="muted small">Not rated yet</span>`)}</div>`;
    }).join("");
    return `<article class="eat">${e.photo ? `<button type="button" class="pic" data-eph="${esc(e.id)}" aria-label="Open photo of ${esc(e.name)}"><img loading="lazy" src="${esc(e.photo.url)}" alt="${esc(e.name)}"></button>` : ""}<div class="body"><div class="top"><div><h4>${esc(e.name)}</h4><div class="where">${esc([e.place, e.day ? dayLabel(e.day).split(" · ")[0] : ""].filter(Boolean).join(" · "))}</div></div><div style="text-align:right"><span class="kind ${e.kind === "drink" ? "drink" : ""}">${e.kind === "drink" ? "Drink" : "Food"}</span>${avg ? `<div class="avg">${avg.toFixed(1)} ★</div>` : ""}</div></div><div class="rates">${rows}</div>${e.note ? `<div class="note">${esc(nameOf(e.by) === "you" ? "You" : nameOf(e.by))}: ${esc(e.note)}</div>` : ""}${mine ? `<div style="display:flex;justify-content:flex-end"><button type="button" class="linkbtn${armed ? " arm" : ""}" data-edel="${esc(e.id)}">${armed ? "Tap again to delete" : "Delete"}</button></div>` : ""}</div></article>`;
  }).join("")}</div>`;
}

/* ---------- boot ---------- */
$("t-cat").innerHTML = CATS.map(([k, l]) => `<option value="${k}">${l}</option>`).join("");
$("t-cat").value = "pack";
renderMap(); renderContacts(); tick(); setInterval(tick, 30000);
setInterval(() => { if (S.trip && !$("p-plan").hidden) renderPlan(); }, 5 * 60e3);
const setOnline = () => { $("offline").hidden = navigator.onLine; };
window.addEventListener("online", setOnline); window.addEventListener("offline", setOnline); setOnline();
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});

if (!firebaseConfig) {
  $("setup").hidden = false;
} else {
  start().catch(err => { console.error(err); $("setup").hidden = false; $("setup").querySelector(".lede").textContent = "The app couldn't load Firebase. Check your connection and reload."; });
}

async function start() {
  const [{ initializeApp }, A, F, ST] = await Promise.all([
    import(SDK + "firebase-app.js"), import(SDK + "firebase-auth.js"), import(SDK + "firebase-firestore.js"), import(SDK + "firebase-storage.js")
  ]);
  const app = initializeApp(firebaseConfig);
  const auth = A.getAuth(app);
  let db;
  try { db = F.initializeFirestore(app, { localCache: F.persistentLocalCache({ tabManager: F.persistentMultipleTabManager() }) }); }
  catch (e) { db = F.getFirestore(app); }
  const storage = ST.getStorage(app);
  Object.assign(S, { db, auth, storage });

  /* login */
  $("login").addEventListener("submit", async e => {
    e.preventDefault(); $("l-err").textContent = ""; $("l-btn").disabled = true;
    try { await A.signInWithEmailAndPassword(auth, $("l-email").value.trim(), $("l-pass").value); }
    catch (err) {
      const c = err && err.code;
      $("l-err").textContent = c === "auth/too-many-requests" ? "Too many tries. Wait a few minutes and try again."
        : c === "auth/network-request-failed" ? "No connection. Connect to Wi-Fi or data and try again."
        : "That email and password don't match. Check both and try again.";
    }
    $("l-btn").disabled = false;
  });

  A.onAuthStateChanged(auth, user => {
    S.unsubs.forEach(u => u()); S.unsubs = [];
    if (!user) {
      Object.assign(S, { uid: null, email: null, trip: undefined, todos: null, photos: null, ours: null, users: {}, journal: null, eats: null, tickets: null });
      $("gate").hidden = false; $("tabs").hidden = true; $("acct-btn").hidden = true;
      ALL_PANELS.forEach(t => ($("p-" + t).hidden = true));
      return;
    }
    S.uid = user.uid; S.email = user.email;
    $("gate").hidden = true; $("tabs").hidden = false; $("acct-btn").hidden = false;
    let startTab = "plan"; try { startTab = localStorage.getItem("jt-tab") || "plan"; } catch (e) {}
    show(location.hash.slice(1) || startTab);
    subscribe(F);
  });

  /* writes */
  document.addEventListener("change", async e => {
    const t = e.target;
    if (t.matches(".titem input[type=checkbox]")) {
      const id = t.dataset.id; if (S.busy.has(id)) return; S.busy.add(id);
      try { await F.updateDoc(F.doc(db, "todos", id), t.checked ? { done: true, doneBy: S.uid, doneAt: Date.now() } : { done: false, doneBy: null, doneAt: null }); }
      catch (err) { toast("t-groups", "That change didn't save. Try again."); }
      S.busy.delete(id); renderTodo();
    }
    if (t.id === "p-who") renderPhotos();
    if (t.id === "p-file" && t.files.length) uploadFiles([...t.files], F, ST);
    if (t.id === "s-import" && t.files.length) importTrip(t.files[0], F);
  });

  $("t-add").addEventListener("submit", async e => {
    e.preventDefault(); const text = $("t-text").value.trim(); if (!text) return;
    const cat = $("t-cat").value;
    const max = Math.max(0, ...(S.todos || []).filter(t => t.cat === cat).map(t => +t.order || 0));
    $("t-addbtn").disabled = true;
    try { await F.addDoc(F.collection(db, "todos"), { text, cat, order: max + 1, done: false, note: "", link: "" }); $("t-text").value = ""; }
    catch (err) { toast("t-groups", "That item didn't save. Try again."); }
    $("t-addbtn").disabled = false;
  });

  $("c-add").addEventListener("submit", async e => {
    e.preventDefault(); const name = $("c-name").value.trim(); if (!name) return;
    $("c-addbtn").disabled = true;
    try { await F.addDoc(F.collection(db, "contacts"), { name, phone: $("c-phone").value.trim(), note: $("c-note").value.trim(), at: Date.now() }); $("c-name").value = ""; $("c-phone").value = ""; $("c-note").value = ""; }
    catch (err) { toast("ourlist", "That contact didn't save. Try again."); }
    $("c-addbtn").disabled = false;
  });

  document.addEventListener("click", e => {
    const td = e.target.closest("[data-tdel]");
    if (td) {
      const id = td.dataset.tdel;
      if (S.armed.has(id)) { clearTimeout(S.armed.get(id)); S.armed.delete(id); F.deleteDoc(F.doc(db, "todos", id)).catch(() => toast("t-groups", "Couldn't remove that item.")); }
      else { S.armed.set(id, setTimeout(() => { S.armed.delete(id); renderTodo(); }, 3000)); renderTodo(); }
      return;
    }
    const cd = e.target.closest("[data-cdel]");
    if (cd) {
      if (cd.dataset.arm) F.deleteDoc(F.doc(db, "contacts", cd.dataset.cdel)).catch(() => {});
      else { cd.dataset.arm = "1"; cd.textContent = "Tap again to remove"; cd.classList.add("arm"); setTimeout(renderOurs, 3000); }
    }
  });

  $("lb-save").onclick = async () => {
    const p = S.lbList[S.lb]; if (!p) return;
    $("lb-save").disabled = true;
    try { await F.updateDoc(F.doc(db, "photos", p.id), { caption: $("lb-cap").value.trim() }); $("lb-info").textContent = "Caption saved."; }
    catch (err) { $("lb-info").textContent = "Caption didn't save. Try again."; }
    $("lb-save").disabled = false;
  };
  $("lb-del").onclick = async () => {
    const b = $("lb-del"), p = S.lbList[S.lb]; if (!p) return;
    if (!b.classList.contains("arm")) { b.classList.add("arm"); b.textContent = "Tap again to delete"; return; }
    try {
      if (p.path) { try { await ST.deleteObject(ST.ref(storage, p.path)); } catch (err) { if (err?.code !== "storage/object-not-found") throw err; } }
      await F.deleteDoc(F.doc(db, "photos", p.id)); closeLb();
    } catch (err) { $("lb-info").textContent = "Delete didn't go through. Try again."; }
  };

  /* tickets */
  $("k-new").onclick = () => { S.kFile = null; $("k-form").hidden = false; $("k-new").hidden = true; $("k-day").value = defaultDay(); $("k-title").focus(); };
  $("k-cancel").onclick = () => { $("k-form").reset(); $("k-form").hidden = true; $("k-new").hidden = false; $("k-filename").textContent = ""; $("k-msg").textContent = ""; S.kFile = null; };
  $("k-form").addEventListener("submit", async e => {
    e.preventDefault(); const title = $("k-title").value.trim(); if (!title) return;
    $("k-save").disabled = true; $("k-msg").textContent = "Saving…";
    try {
      const img = S.kFile ? await shrinkToDataURL(S.kFile) : "";
      await F.addDoc(F.collection(db, "tickets"), { title, day: $("k-day").value, time: $("k-time").value, number: $("k-number").value.trim(), link: $("k-link").value.trim(), note: $("k-note").value.trim(), holder: "", img, by: S.uid, at: Date.now() });
      $("k-cancel").click();
    } catch (err) { console.error(err); $("k-msg").textContent = "Ticket didn't save. If you added a screenshot, try a smaller one."; }
    $("k-save").disabled = false;
  });
  document.addEventListener("click", async e => {
    const kd = e.target.closest("[data-kdel]"); if (!kd) return;
    const id = kd.dataset.kdel, key = "k:" + id;
    if (!S.armed.has(key)) { S.armed.set(key, setTimeout(() => { S.armed.delete(key); renderTickets(); }, 3000)); renderTickets(); return; }
    clearTimeout(S.armed.get(key)); S.armed.delete(key);
    F.deleteDoc(F.doc(db, "tickets", id)).catch(() => toast("k-list", "Delete didn't go through."));
  });

  /* journal */
  $("j-form").addEventListener("submit", async e => {
    e.preventDefault();
    const text = $("j-text").value.trim(); if (!text) return;
    $("j-save").disabled = true; $("j-msg").textContent = S.jFiles.length ? "Uploading photos…" : "Saving…";
    try {
      const added = [];
      for (const f of S.jFiles) added.push(await uploadOne(f, ST));
      const base = { day: $("j-day").value, title: $("j-title").value.trim(), text };
      if (S.jEdit) {
        const old = (S.journal || []).find(x => x.id === S.jEdit);
        await F.updateDoc(F.doc(db, "journal", S.jEdit), { ...base, photos: [...(old?.photos || []), ...added], edited: Date.now() });
      } else {
        await F.addDoc(F.collection(db, "journal"), { ...base, photos: added, by: S.uid, at: Date.now() });
      }
      resetJournalForm(); $("j-msg").textContent = "Saved.";
    } catch (err) { console.error(err); $("j-msg").textContent = "Entry didn't save. " + uploadError(err?.code); }
    $("j-save").disabled = false;
  });
  $("j-cancel").onclick = () => { resetJournalForm(); $("j-msg").textContent = ""; };

  /* eats */
  $("e-new").onclick = () => { S.eRating = 0; S.eFile = null; paintFormStars(); document.querySelectorAll("[data-kind]").forEach(b => b.setAttribute("aria-checked", b.dataset.kind === "food")); $("e-form").hidden = false; $("e-new").hidden = true; $("e-day").value = defaultDay(); $("e-name").focus(); };
  $("e-cancel").onclick = () => { $("e-form").reset(); $("e-form").hidden = true; $("e-new").hidden = false; $("e-filename").textContent = ""; $("e-msg").textContent = ""; };
  $("e-form").addEventListener("submit", async e => {
    e.preventDefault();
    const name = $("e-name").value.trim(); if (!name) return;
    $("e-save").disabled = true; $("e-msg").textContent = S.eFile ? "Uploading photo…" : "Saving…";
    try {
      const photo = S.eFile ? await uploadOne(S.eFile, ST) : null;
      const kind = $("ek-drink").getAttribute("aria-checked") === "true" ? "drink" : "food";
      await F.addDoc(F.collection(db, "eats"), { kind, name, place: $("e-place").value.trim(), day: $("e-day").value, note: $("e-note").value.trim(), photo, ratings: S.eRating ? { [S.uid]: S.eRating } : {}, by: S.uid, at: Date.now() });
      $("e-cancel").click();
    } catch (err) { console.error(err); $("e-msg").textContent = "Didn't save. " + uploadError(err?.code); }
    $("e-save").disabled = false;
  });
  document.addEventListener("click", async e => {
    const r = e.target.closest("[data-rate]");
    if (r) {
      const [id, n] = r.dataset.rate.split(":"); const item = (S.eats || []).find(x => x.id === id); if (!item || S.busy.has("e" + id)) return;
      const cur = (item.ratings || {})[S.uid] || 0, val = cur === +n ? 0 : +n;
      S.busy.add("e" + id);
      try { await F.updateDoc(F.doc(db, "eats", id), { ["ratings." + S.uid]: val }); } catch (err) { toast("e-list", "Rating didn't save. Try again."); }
      S.busy.delete("e" + id); return;
    }
    const fr = e.target.closest("[data-frate]");
    if (fr) { S.eRating = S.eRating === +fr.dataset.frate ? 0 : +fr.dataset.frate; paintFormStars(); return; }
    const kb = e.target.closest("[data-kind]");
    if (kb) { document.querySelectorAll("[data-kind]").forEach(b => b.setAttribute("aria-checked", b === kb)); return; }
    const ed = e.target.closest("[data-edel]");
    if (ed) {
      const id = ed.dataset.edel, key = "e:" + id;
      if (!S.armed.has(key)) { S.armed.set(key, setTimeout(() => { S.armed.delete(key); renderEats(); }, 3000)); renderEats(); return; }
      clearTimeout(S.armed.get(key)); S.armed.delete(key);
      const item = (S.eats || []).find(x => x.id === id);
      try { if (item?.photo?.path) await ST.deleteObject(ST.ref(storage, item.photo.path)).catch(() => {}); await F.deleteDoc(F.doc(db, "eats", id)); }
      catch (err) { toast("e-list", "Delete didn't go through."); }
      return;
    }
    const je = e.target.closest("[data-jedit]");
    if (je) {
      const item = (S.journal || []).find(x => x.id === je.dataset.jedit); if (!item) return;
      S.jEdit = item.id; S.jFiles = [];
      $("j-day").value = item.day || "pre"; $("j-title").value = item.title || ""; $("j-text").value = item.text || "";
      $("j-mode").textContent = "Editing your entry"; $("j-cancel").hidden = false; $("j-save").textContent = "Save changes"; $("j-files").textContent = "";
      $("j-form").scrollIntoView({ block: "start" }); $("j-text").focus();
      return;
    }
    const jd = e.target.closest("[data-jdel]");
    if (jd) {
      const id = jd.dataset.jdel, key = "j:" + id;
      if (!S.armed.has(key)) { S.armed.set(key, setTimeout(() => { S.armed.delete(key); renderJournal(); }, 3000)); renderJournal(); return; }
      clearTimeout(S.armed.get(key)); S.armed.delete(key);
      const item = (S.journal || []).find(x => x.id === id);
      try { for (const ph of item?.photos || []) await ST.deleteObject(ST.ref(storage, ph.path)).catch(() => {}); await F.deleteDoc(F.doc(db, "journal", id)); if (S.jEdit === id) resetJournalForm(); }
      catch (err) { toast("j-list", "Delete didn't go through."); }
    }
  });

  /* settings */
  $("acct-btn").onclick = () => { $("who-email").textContent = "Signed in as " + (S.email || ""); $("s-name").value = S.users[S.uid]?.name || ""; $("s-msg").textContent = ""; $("sheet").hidden = false; $("s-name").focus(); };
  $("s-close").onclick = () => ($("sheet").hidden = true);
  $("sheet").addEventListener("click", e => { if (e.target.id === "sheet") $("sheet").hidden = true; });
  $("s-save").onclick = async () => {
    const name = $("s-name").value.trim(); if (!name) return;
    try { await F.setDoc(F.doc(db, "users", S.uid), { name }, { merge: true }); $("s-msg").textContent = "Name saved."; }
    catch (err) { $("s-msg").textContent = "Name didn't save. Try again."; }
  };
  $("s-out").onclick = async () => { $("sheet").hidden = true; await A.signOut(auth); };
}

function subscribe(F) {
  const { db } = S;
  const onErr = where => err => {
    console.error(where, err);
    if (err?.code === "permission-denied") {
      $("days").innerHTML = `<p class="notice">This account isn't on the trip's allowed list. Check that ${esc(S.email)} is in the Firebase security rules exactly as written, in lowercase.</p>`;
    }
  };
  S.unsubs.push(F.onSnapshot(F.doc(db, "trip", "main"), snap => {
    S.trip = snap.exists() ? snap.data() : null;
    renderHeader(); renderPlan(); renderMap(); renderContacts(); fillDaySelect(); renderPhotos(); renderJournal(); renderEats(); tick();
  }, onErr("trip")));
  S.unsubs.push(F.onSnapshot(F.collection(db, "todos"), snap => {
    S.todos = snap.docs.map(d => ({ id: d.id, ...d.data() })); renderTodo();
  }, onErr("todos")));
  S.unsubs.push(F.onSnapshot(F.query(F.collection(db, "photos"), F.orderBy("at", "desc"), F.limit(2000)), snap => {
    S.photos = snap.docs.map(d => ({ id: d.id, ...d.data() })); renderPhotos(); if (!$("lb").hidden && S.lbAlbum) { S.lbList = S.albumList; paintLb(); }
  }, onErr("photos")));
  S.unsubs.push(F.onSnapshot(F.query(F.collection(db, "contacts"), F.orderBy("at", "asc")), snap => {
    S.ours = snap.docs.map(d => ({ id: d.id, ...d.data() })); renderOurs();
  }, onErr("contacts")));
  let named = false;
  S.unsubs.push(F.onSnapshot(F.collection(db, "users"), snap => {
    S.users = {}; snap.docs.forEach(d => (S.users[d.id] = d.data()));
    if (!named && !snap.metadata.fromCache && !S.users[S.uid]) {
      named = true;
      const guess = (S.email || "").split("@")[0].replace(/[._\d]+/g, " ").trim().split(" ")[0] || "Me";
      F.setDoc(F.doc(db, "users", S.uid), { name: guess.charAt(0).toUpperCase() + guess.slice(1) }, { merge: true }).catch(() => {});
    }
    renderTodo(); renderPhotos(); renderJournal(); renderEats();
  }, onErr("users")));
  S.unsubs.push(F.onSnapshot(F.collection(db, "tickets"), snap => {
    S.tickets = snap.docs.map(d => ({ id: d.id, ...d.data() })); renderTickets(); renderPlan();
  }, onErr("tickets")));
  S.unsubs.push(F.onSnapshot(F.query(F.collection(db, "journal"), F.orderBy("at", "desc"), F.limit(1000)), snap => {
    S.journal = snap.docs.map(d => ({ id: d.id, ...d.data() })); renderJournal();
  }, onErr("journal")));
  S.unsubs.push(F.onSnapshot(F.query(F.collection(db, "eats"), F.orderBy("at", "desc"), F.limit(1000)), snap => {
    S.eats = snap.docs.map(d => ({ id: d.id, ...d.data() })); renderEats();
  }, onErr("eats")));
}

async function uploadOne(file, ST) {
  const { blob, type, ext, w, h } = await shrink(file);
  const path = `photos/${S.uid}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const r = ST.ref(S.storage, path);
  await ST.uploadBytes(r, blob, { contentType: type, cacheControl: "public,max-age=31536000" });
  return { path, url: await ST.getDownloadURL(r), w, h };
}
function uploadError(code) {
  return code === "unsupported" ? "That file type isn't supported. Pick photos from the Photos library so they convert to JPEG."
    : code === "storage/unauthorized" ? "Upload was refused. Check the Storage security rules."
    : code === "storage/quota-exceeded" ? "Photo storage is full."
    : "Check your connection and try again.";
}
async function uploadFiles(files, F, ST) {
  const st = $("p-status"), day = $("p-day").value; let ok = 0, fail = 0, why = "";
  for (let i = 0; i < files.length; i++) {
    st.textContent = `Uploading ${i + 1} of ${files.length}…`;
    try {
      const { path, url, w, h } = await uploadOne(files[i], ST);
      await F.addDoc(F.collection(S.db, "photos"), { path, url, by: S.uid, day, caption: "", at: Date.now(), w, h });
      ok++;
    } catch (e) { fail++; why = e?.code || ""; console.error(e); }
  }
  const msg = uploadError(why);
  st.textContent = fail ? `${ok} uploaded, ${fail} failed. ${msg}` : `${ok} photo${ok === 1 ? "" : "s"} added.`;
  $("p-file").value = "";
}

async function importTrip(file, F) {
  const msg = $("s-msg");
  try {
    const data = JSON.parse(await file.text());
    if (!data || (!Array.isArray(data.days) && !Array.isArray(data.tickets))) throw new Error("bad");
    const { todos = [], tickets = [], ...trip } = data;
    const existing = new Set((await F.getDocs(F.collection(S.db, "todos"))).docs.map(d => d.id));
    const batch = F.writeBatch(S.db);
    if (Array.isArray(trip.days)) batch.set(F.doc(S.db, "trip", "main"), { ...trip, updatedAt: Date.now() });
    tickets.forEach(k => { if (k && k.id && k.title) { const { id, ...rest } = k; batch.set(F.doc(S.db, "tickets", String(id)), { ...rest, by: S.uid, at: Date.now() }); } });
    let added = 0, updated = 0;
    todos.forEach(t => {
      if (!t || !t.id || !t.text) return;
      const { id, done, doneBy, doneAt, ...rest } = t;
      const r = F.doc(S.db, "todos", String(id));
      if (existing.has(String(id))) { batch.update(r, rest); updated++; }
      else { batch.set(r, { ...rest, done: false }); added++; }
    });
    await batch.commit();
    msg.textContent = [Array.isArray(trip.days) ? `Trip loaded: ${trip.days.length} days` : "", `${added} new checklist items, ${updated} updated`, tickets.length ? `${tickets.length} tickets` : ""].filter(Boolean).join(", ") + ".";
  } catch (e) {
    console.error(e);
    msg.textContent = e?.message === "bad" ? "That file isn't a trip-data.json file." : "Import didn't finish. Check your connection and try again.";
  }
  $("s-import").value = "";
}

/* ---------- static UI events ---------- */
document.addEventListener("click", e => {
  const c = e.target.closest(".chip"); if (c) { $("d-" + c.dataset.d)?.scrollIntoView({ block: "start" }); return; }
  const f = e.target.closest(".pills button");
  if (f) { S.filter = f.dataset.f; document.querySelectorAll(".pills button").forEach(x => x.setAttribute("aria-pressed", x === f)); renderPlan(); return; }
  const cp = e.target.closest("[data-copy]"); if (cp) { copy(cp.dataset.copy, cp); return; }
  const tx = e.target.closest("[data-taxi]");
  if (tx) { const h = (S.trip?.hotels || [])[+tx.dataset.taxi]; if (!h) return; $("taxi-jp").textContent = h.jp; $("taxi-en").textContent = h.en || ""; $("taxi").hidden = false; $("taxi-close").focus(); return; }
  const th = e.target.closest("[data-ph]"); if (th) { openLb(th.dataset.ph); }
});
document.addEventListener("change", e => {
  if (e.target.id === "j-file") { S.jFiles = [...e.target.files]; $("j-files").textContent = S.jFiles.length ? `${S.jFiles.length} photo${S.jFiles.length > 1 ? "s" : ""} ready` : ""; e.target.value = ""; }
  if (e.target.id === "e-file") { S.eFile = e.target.files[0] || null; $("e-filename").textContent = S.eFile ? "Photo ready" : ""; e.target.value = ""; }
  if (e.target.id === "e-sort") renderEats();
  if (e.target.id === "k-file") { S.kFile = e.target.files[0] || null; $("k-filename").textContent = S.kFile ? "Image ready" : ""; e.target.value = ""; }
});
document.addEventListener("click", e => {
  const k = e.target.closest(".etools .pills button");
  if (k) { S.eKind = k.dataset.k; document.querySelectorAll(".etools .pills button").forEach(x => x.setAttribute("aria-pressed", x === k)); renderEats(); return; }
  const ts = e.target.closest("[data-tshow]");
  if (ts) { const list = sortedTickets().filter(k => k.img); openTickets(list, list.findIndex(k => k.id === ts.dataset.tshow)); return; }
  const td2 = e.target.closest("[data-tday]");
  if (td2) { const all = sortedTickets().filter(k => k.day === td2.dataset.tday); const withImg = all.filter(k => k.img); if (withImg.length) openTickets(withImg, 0); else if (all[0]?.link) window.open(all[0].link, "_blank", "noopener"); else show("info"); return; }
  const jp = e.target.closest("[data-jph]");
  if (jp) { const [id, i] = jp.dataset.jph.split(":"); const en = (S.journal || []).find(x => x.id === id); if (en) openViewer(en.photos.map(ph => ({ url: ph.url, day: en.day, by: en.by, caption: en.title || "" })), +i, false); return; }
  const ep = e.target.closest("[data-eph]");
  if (ep) { const list = S.eatsView.filter(x => x.photo); const i = list.findIndex(x => x.id === ep.dataset.eph); openViewer(list.map(x => ({ url: x.photo.url, day: x.day, by: x.by, caption: [x.name, x.place].filter(Boolean).join(" at ") })), i, false); }
});
$("taxi-close").onclick = () => ($("taxi").hidden = true);
$("tv-close").onclick = closeTv;
$("tv-prev").onclick = () => { if (S.tv.i > 0) { S.tv.i--; paintTv(); } };
$("tv-next").onclick = () => { if (S.tv.i < S.tv.list.length - 1) { S.tv.i++; paintTv(); } };
$("lb-close").onclick = closeLb;
$("lb-prev").onclick = () => { if (S.lb > 0) { S.lb--; paintLb(); } };
$("lb-next").onclick = () => { if (S.lb < S.lbList.length - 1) { S.lb++; paintLb(); } };
document.addEventListener("keydown", e => {
  if (!$("lb").hidden) { if (e.key === "Escape") closeLb(); if (e.key === "ArrowLeft") $("lb-prev").click(); if (e.key === "ArrowRight") $("lb-next").click(); }
  if (e.key === "Escape") { $("taxi").hidden = true; $("sheet").hidden = true; if (!$("tv").hidden) closeTv(); }
});
