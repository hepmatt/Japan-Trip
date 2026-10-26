import { firebaseConfig } from "./firebase-config.js";

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
  busy: new Set(), armed: new Map(), filter: "all", lb: -1, lbList: [], unsubs: []
};
const days = () => (S.trip && Array.isArray(S.trip.days) ? S.trip.days : []);

/* ---------- tabs ---------- */
const TABS = ["plan", "todo", "map", "contacts", "photos"];
function show(tab) {
  if (!TABS.includes(tab)) tab = "plan";
  TABS.forEach(t => { $("p-" + t).hidden = t !== tab; $("n-" + t).setAttribute("aria-current", t === tab ? "page" : "false"); });
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
    return `<section class="day" id="d-${esc(x.d)}"><div class="day-h"><h3>${esc(x.dow)}, ${fmt(x.d)}</h3><span class="city ${esc(x.city)}">${esc(x.cityL)}</span></div><p class="stay">${esc(x.stay)}</p>${items ? `<ol class="rail">${items}</ol>` : `<p class="empty">Nothing in this filter.</p>`}</section>`;
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
  const sel = $("p-day"), keep = sel.value;
  const opts = [["pre", "Before the trip"], ...days().map(x => [x.d, `${fmt(x.d)} · ${x.cityL}`]), ["post", "After the trip"]];
  sel.innerHTML = opts.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join("");
  sel.value = opts.some(o => o[0] === keep) ? keep : defaultDay();
}
function renderPhotos() {
  const box = $("p-grid");
  if (!S.photos) return;
  const w = $("p-who").value;
  const list = S.photos.filter(p => w === "all" || (w === "me" ? p.by === S.uid : p.by !== S.uid));
  if (!list.length) { S.lbList = []; box.innerHTML = `<p class="empty">${S.photos.length ? "No photos match this filter." : "No photos yet. Tap Add photos to share the first one."}</p>`; return; }
  const order = ["post", ...[...tripDays()].reverse(), "pre"];
  const known = new Set(order);
  const groups = order.map(d => [d, list.filter(p => (p.day || "pre") === d)]);
  const stray = list.filter(p => !known.has(p.day || "pre"));
  if (stray.length) groups.push(["other", stray]);
  const g2 = groups.filter(g => g[1].length);
  S.lbList = g2.flatMap(g => g[1]);
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

/* ---------- lightbox ---------- */
function openLb(id) { const i = S.lbList.findIndex(p => p.id === id); if (i < 0) return; S.lb = i; paintLb(); $("lb").hidden = false; $("lb-close").focus(); }
function paintLb() {
  const p = S.lbList[S.lb]; if (!p) { closeLb(); return; }
  $("lb-img").src = p.url; $("lb-img").alt = p.caption || "Trip photo";
  $("lb-pos").textContent = `${S.lb + 1} of ${S.lbList.length}`;
  $("lb-info").textContent = `${dayLabel(p.day || "pre")} · by ${nameOf(p.by)}${p.caption ? " · " + p.caption : ""}`;
  const mine = p.by === S.uid;
  $("lb-cap").hidden = !mine; $("lb-save").hidden = !mine; $("lb-cap").value = p.caption || "";
  $("lb-del").hidden = !mine; $("lb-del").classList.remove("arm"); $("lb-del").textContent = "Delete";
}
function closeLb() { $("lb").hidden = true; S.lb = -1; }

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
      Object.assign(S, { uid: null, email: null, trip: undefined, todos: null, photos: null, ours: null, users: {} });
      $("gate").hidden = false; $("tabs").hidden = true; $("acct-btn").hidden = true;
      TABS.forEach(t => ($("p-" + t).hidden = true));
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
    renderHeader(); renderPlan(); renderMap(); renderContacts(); fillDaySelect(); renderPhotos(); tick();
  }, onErr("trip")));
  S.unsubs.push(F.onSnapshot(F.collection(db, "todos"), snap => {
    S.todos = snap.docs.map(d => ({ id: d.id, ...d.data() })); renderTodo();
  }, onErr("todos")));
  S.unsubs.push(F.onSnapshot(F.query(F.collection(db, "photos"), F.orderBy("at", "desc"), F.limit(2000)), snap => {
    S.photos = snap.docs.map(d => ({ id: d.id, ...d.data() })); renderPhotos(); if (!$("lb").hidden) paintLb();
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
    renderTodo(); renderPhotos();
  }, onErr("users")));
}

async function uploadFiles(files, F, ST) {
  const st = $("p-status"), day = $("p-day").value; let ok = 0, fail = 0, why = "";
  for (let i = 0; i < files.length; i++) {
    st.textContent = `Uploading ${i + 1} of ${files.length}…`;
    try {
      const { blob, type, ext, w, h } = await shrink(files[i]);
      const path = `photos/${S.uid}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const r = ST.ref(S.storage, path);
      await ST.uploadBytes(r, blob, { contentType: type, cacheControl: "public,max-age=31536000" });
      const url = await ST.getDownloadURL(r);
      await F.addDoc(F.collection(S.db, "photos"), { path, url, by: S.uid, day, caption: "", at: Date.now(), w, h });
      ok++;
    } catch (e) { fail++; why = e?.code || ""; console.error(e); }
  }
  const msg = why === "unsupported" ? "That file type isn't supported. Pick photos from the Photos library so they convert to JPEG."
    : why === "storage/unauthorized" ? "Upload was refused. Check the Storage security rules."
    : why === "storage/quota-exceeded" ? "Photo storage is full."
    : "Check your connection and try again.";
  st.textContent = fail ? `${ok} uploaded, ${fail} failed. ${msg}` : `${ok} photo${ok === 1 ? "" : "s"} added.`;
  $("p-file").value = "";
}

async function importTrip(file, F) {
  const msg = $("s-msg");
  try {
    const data = JSON.parse(await file.text());
    if (!data || !Array.isArray(data.days)) throw new Error("bad");
    const { todos = [], ...trip } = data;
    const existing = new Set((await F.getDocs(F.collection(S.db, "todos"))).docs.map(d => d.id));
    const batch = F.writeBatch(S.db);
    batch.set(F.doc(S.db, "trip", "main"), { ...trip, updatedAt: Date.now() });
    let added = 0, updated = 0;
    todos.forEach(t => {
      if (!t || !t.id || !t.text) return;
      const { id, done, doneBy, doneAt, ...rest } = t;
      const r = F.doc(S.db, "todos", String(id));
      if (existing.has(String(id))) { batch.update(r, rest); updated++; }
      else { batch.set(r, { ...rest, done: false }); added++; }
    });
    await batch.commit();
    msg.textContent = `Trip loaded: ${trip.days.length} days, ${added} new checklist items, ${updated} updated.`;
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
$("taxi-close").onclick = () => ($("taxi").hidden = true);
$("lb-close").onclick = closeLb;
$("lb-prev").onclick = () => { if (S.lb > 0) { S.lb--; paintLb(); } };
$("lb-next").onclick = () => { if (S.lb < S.lbList.length - 1) { S.lb++; paintLb(); } };
document.addEventListener("keydown", e => {
  if (!$("lb").hidden) { if (e.key === "Escape") closeLb(); if (e.key === "ArrowLeft") $("lb-prev").click(); if (e.key === "ArrowRight") $("lb-next").click(); }
  if (e.key === "Escape") { $("taxi").hidden = true; $("sheet").hidden = true; }
});
