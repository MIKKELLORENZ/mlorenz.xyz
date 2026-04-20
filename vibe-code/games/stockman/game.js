// ══════════════════════════════════════════════════════════════
//  STOCKMAN – game.js  (Canvas-based JS port of pygame version)
// ══════════════════════════════════════════════════════════════
// variables loaded via variables.js (global scope)

// ─── helpers ─────────────────────────────────────────────────
const rand  = (a, b) => Math.random() * (b - a) + a;
const randInt = (a, b) => Math.floor(rand(a, b + 1));
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const shuffle = arr => { for (let i = arr.length - 1; i > 0; i--) { const j = randInt(0, i); [arr[i], arr[j]] = [arr[j], arr[i]]; } return arr; };
function lognormal(mu, sigma) { const u1 = Math.random(); const u2 = Math.random(); const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2); return Math.exp(mu + sigma * z); }
function getDaySuffix(d) { if (d >= 11 && d <= 13) return "th"; const l = d % 10; return l === 1 ? "st" : l === 2 ? "nd" : l === 3 ? "rd" : "th"; }

// ─── Catmull-Rom (for smooth graph lines) ────────────────────
function catmullRomChain(pts, res) {
  if (pts.length < 4) return pts;
  const chain = [];
  for (let i = 0; i < pts.length - 3; i++) {
    const [p0, p1, p2, p3] = [pts[i], pts[i+1], pts[i+2], pts[i+3]];
    for (let j = 0; j < res; j++) {
      const t = j / res, t2 = t * t, t3 = t2 * t;
      chain.push([
        0.5*((2*p1[0]) + (-p0[0]+p2[0])*t + (2*p0[0]-5*p1[0]+4*p2[0]-p3[0])*t2 + (-p0[0]+3*p1[0]-3*p2[0]+p3[0])*t3),
        0.5*((2*p1[1]) + (-p0[1]+p2[1])*t + (2*p0[1]-5*p1[1]+4*p2[1]-p3[1])*t2 + (-p0[1]+3*p1[1]-3*p2[1]+p3[1])*t3),
      ]);
    }
  }
  return chain;
}

// ─── constants ───────────────────────────────────────────────
let W = 1280, H = 720;
const WHITE = "#ecf0f1", GRAY = "#95a5a6", LIGHT_GRAY = "#bdc3c7";
const DARK_GRAY = "#2c3e50", BLACK = "#121212";
const GREEN = "#2ecc71", RED = "#e74c3c", DARK_RED = "#c82e1e";
const BLUE = "#3498db", ORANGE = "#f39c12", PAPER_YELLOW = "#f1c40f";
const TEAL = "#1abc9c", PURPLE = "#9b59b6", DARK_PANEL = "#1a252f";
const PANEL_BG = "rgba(26,37,47,0.92)";
const ACCENT_CYAN = "#00d2ff";

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const MONTH_DAYS = [31,28,31,30,31,30,31,31,30,31,30,31];

// ─── sector icons (emoji for 90s fun) ────────────────────────
const sectorIcons = {
  "All": "📊", "Food": "🍔", "Pharmaceutical": "💊", "Tech": "💾", "Energy": "⚡",
  "Defense": "🛡️", "Automotive": "🚗", "Entertainment": "🎬", "Agriculture": "🌾",
  "Fashion": "👗", "Retail": "🛒", "Finance": "💰", "Transportation": "✈️",
  "Healthcare": "🏥", "Telecommunications": "📞", "Real Estate": "🏠",
  "Consumer Goods": "📦", "Gaming": "🎮", "Biotech": "🧬", "Aerospace": "🚀",
  "Hospitality": "🏨", "Insurance": "📋", "E-commerce": "🖥️", "Media": "📰",
  "Construction": "🏗️", "Chemicals": "⚗️", "Mining": "⛏️", "Logistics": "📦",
  "Education": "📚", "Luxury Goods": "💎",
};

// ─── audio ───────────────────────────────────────────────────
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
function loadSound(src, vol) {
  const a = new Audio(src);
  a.volume = vol;
  a.preload = "auto";
  return a;
}
function playSound(a) {
  if (audioCtx.state === "suspended") audioCtx.resume();
  a.currentTime = 0;
  a.play().catch(() => {});
}
function loopSound(a) {
  if (audioCtx.state === "suspended") audioCtx.resume();
  a.loop = true;
  a.currentTime = 0;
  a.play().catch(() => {});
}
const sounds = {
  menu:       loadSound("intro.wav", 0.45),
  game:       loadSound("game_music.mp3", 0.25),
  sell:       loadSound("sell.mp3", 0.5),
  buy:        loadSound("buy.mp3", 0.32),
  dateInc:    loadSound("date_increment.mp3", 0.6),
  qtyChange:  loadSound("quantity_change_sound.mp3", 0.15),
  acctBeep:   loadSound("account_beep.mp3", 0.18),
  dayTick:    loadSound("day_ending_tick.mp3", 0.75),
  click:      loadSound("small_click.mp3", 0.80),
};

// ─── canvas (fullscreen) ─────────────────────────────────────
const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

function resizeCanvas() {
  W = window.innerWidth;
  H = window.innerHeight;
  canvas.width = W;
  canvas.height = H;
}
resizeCanvas();
window.addEventListener("resize", resizeCanvas);

// Preload images
const bgImg = new Image();   bgImg.src = "wallpaper.webp";
const menuImg = new Image();  menuImg.src = "menu_wallpaper.png";
let bgLoaded = false, menuLoaded = false;
bgImg.onload = () => { bgLoaded = true; };
menuImg.onload = () => { menuLoaded = true; };

// ─── seasonal / market effects (identical to python) ─────────
const monthlyMarketEffects = { 0:0.1, 8:-0.1, 9:-0.1, 10:0.1, 11:0.1 };
const industryMonthlyEffects = {
  Retail:{10:0.2,11:0.2}, Agriculture:{5:0.2,6:0.2},
  Energy:{0:0.2,1:0.2,6:0.2,7:0.2}, Hospitality:{5:0.2,6:0.5,7:0.2},
  Fashion:{1:0.2,8:0.2}, Entertainment:{5:0.2,6:0.2,11:0.2},
  Tech:{8:0.2,9:0.2}, Automotive:{8:0.2,9:0.2},
  Education:{7:0.2,8:0.2}, "Real Estate":{3:0.2,4:0.2,5:0.2},
  Transportation:{5:0.2,6:0.2,11:0.2}, "Luxury Goods":{10:0.2,11:0.2},
  "Consumer Goods":{10:0.2,11:0.2}, "E-commerce":{10:0.2,11:0.2},
  Pharmaceutical:{0:0.2,1:0.2,2:0.2}, Gaming:{10:0.2,11:0.2},
  Media:{5:0.2,6:0.2}, Insurance:{11:0.2}, Finance:{11:0.2},
};
function getSeasonalEffect(cat, mi) {
  let e = 0;
  if (Math.random() < 0.05) e += (monthlyMarketEffects[mi] || 0);
  if (Math.random() < 0.10) e += ((industryMonthlyEffects[cat] || {})[mi] || 0);
  return e;
}

// ─── Stock class ─────────────────────────────────────────────
class Stock {
  constructor(name, category, price) {
    this.name = name;
    this.category = category;
    this.price = price;
    this.displayPrice = price;
    this.prevPrice = price;
    this.history = [[0, price]];
    this.dividendYield = rand(0, 5);
  }
  updatePrice(t, mi, sentimentEffects) {
    let sentiment = 0;
    const ms = sentimentEffects.get("Market|");
    if (ms) sentiment += ms[0];
    const cs = sentimentEffects.get("Category|" + this.category);
    if (cs) sentiment += cs[0];
    const ss = sentimentEffects.get("Stock|" + this.name);
    if (ss) sentiment += ss[0];
    let change = rand(-0.2, 0.2) + 0.0020 + sentiment * 0.1;
    change += getSeasonalEffect(this.category, mi);
    this.price += change;
    if (this.price < 0.1) this.price = 0.1;
    this.history.push([t, this.price]);
  }
  updateDisplayPrice() {
    this.prevPrice = this.displayPrice;
    this.displayPrice = this.price;
  }
}

// ─── build stock list ────────────────────────────────────────
let stocks = [];
const allCategories = Object.keys(fictionalStocks);
for (const [cat, names] of Object.entries(fictionalStocks))
  for (const n of names) stocks.push(new Stock(n, cat, lognormal(Math.log(40), 0.6)));
stocks.sort((a, b) => a.name.localeCompare(b.name));

// ─── graph helpers ───────────────────────────────────────────
function getGraphData(history, totalTime, scale) {
  if (scale === "history" || graphTimeScales[scale] == null) return history;
  const dur = graphTimeScales[scale];
  let start = totalTime - dur; if (start < 0) start = 0;
  return history.filter(([t]) => t >= start);
}

function drawGraph(rx, ry, rw, rh, data, color, minRef, splitColor) {
  if (data.length < 2) return;
  const times = data.map(d => d[0]), vals = data.map(d => d[1]);
  const minT = Math.min(...times), maxT = Math.max(...times);
  let minV = Math.min(...vals), maxV = Math.max(...vals);
  let tSpan = maxT - minT || 1, vSpan = maxV - minV || 1;
  const mx = 0.05 * rw, my = 0.05 * rh;

  const pts = data.map(([t, v]) => [
    clamp(rx + mx + ((t - minT) / tSpan) * (rw - 2 * mx), rx + mx, rx + rw - mx),
    clamp(ry + rh - my - ((v - minV) / vSpan) * (rh - 2 * my), ry + my, ry + rh - my),
  ]);

  // grid lines + y-axis labels
  ctx.font = "11px monospace"; ctx.fillStyle = GRAY;
  for (let i = 0; i < 4; i++) {
    const lv = minV + i * (maxV - minV) / 3;
    const ly = clamp(ry + rh - my - ((lv - minV) / vSpan) * (rh - 2 * my), ry + my, ry + rh - my);
    ctx.fillText("$" + lv.toFixed(1), rx + 5, ly + 4);
    ctx.strokeStyle = "rgba(149,165,166,0.3)"; ctx.lineWidth = 0.5; ctx.beginPath();
    ctx.moveTo(rx + mx, ly); ctx.lineTo(rx + rw - mx, ly); ctx.stroke();
  }

  if (splitColor && minRef != null) {
    for (let i = 0; i < pts.length - 1; i++) {
      const [v1, v2] = [data[i][1], data[i + 1][1]];
      const [p1, p2] = [pts[i], pts[i + 1]];
      if (v1 >= minRef && v2 >= minRef) { drawSeg(p1, p2, GREEN); }
      else if (v1 < minRef && v2 < minRef) { drawSeg(p1, p2, RED); }
      else {
        const tc = v2 !== v1 ? clamp((minRef - v1) / (v2 - v1), 0, 1) : 0;
        const xi = p1[0] + tc * (p2[0] - p1[0]), yi = p1[1] + tc * (p2[1] - p1[1]);
        if (v1 < minRef) { drawSeg(p1, [xi, yi], RED); drawSeg([xi, yi], p2, GREEN); }
        else { drawSeg(p1, [xi, yi], GREEN); drawSeg([xi, yi], p2, RED); }
      }
    }
  } else {
    let line = pts;
    if (pts.length >= 4) {
      const ext = [pts[0], ...pts, pts[pts.length - 1]];
      line = catmullRomChain(ext, 10);
      line = line.map(([x, y]) => [clamp(x, rx + mx, rx + rw - mx), clamp(y, ry + my, ry + rh - my)]);
    }
    ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.beginPath();
    ctx.moveTo(line[0][0], line[0][1]);
    for (let i = 1; i < line.length; i++) ctx.lineTo(line[i][0], line[i][1]);
    ctx.stroke();
  }
}
function drawSeg(a, b, c) { ctx.strokeStyle = c; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); }

// ─── input state ─────────────────────────────────────────────
let mouseX = 0, mouseY = 0, mouseDown = false, mouseClicked = false, wheelDelta = 0;
let searchText = "", searchActive = false;
let keysPressed = [];

canvas.addEventListener("mousemove", e => { mouseX = e.clientX; mouseY = e.clientY; });
canvas.addEventListener("mousedown", e => { mouseDown = true; mouseClicked = true; });
canvas.addEventListener("mouseup",   () => { mouseDown = false; });
canvas.addEventListener("wheel", e => { wheelDelta += e.deltaY > 0 ? -30 : 30; e.preventDefault(); }, { passive: false });
canvas.addEventListener("contextmenu", e => e.preventDefault());

// keyboard input for search
document.addEventListener("keydown", e => {
  if (searchActive) {
    if (e.key === "Backspace") {
      searchText = searchText.slice(0, -1);
      e.preventDefault();
    } else if (e.key === "Escape") {
      searchActive = false;
      searchText = "";
    } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
      searchText += e.key;
      e.preventDefault();
    }
  }
});

// ─── drawing helpers ─────────────────────────────────────────
function fillRect(x, y, w, h, c) { ctx.fillStyle = c; ctx.fillRect(x, y, w, h); }
function strokeRect(x, y, w, h, c, lw = 2) { ctx.strokeStyle = c; ctx.lineWidth = lw; ctx.strokeRect(x, y, w, h); }
function drawText(txt, x, y, font, color, align = "left") { ctx.font = font; ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = "top"; ctx.fillText(txt, x, y); }
function measureText(txt, font) { ctx.font = font; return ctx.measureText(txt).width; }
function inRect(mx, my, x, y, w, h) { return mx >= x && mx < x + w && my >= y && my < y + h; }

// ─── panel drawing (90s beveled look) ────────────────────────
function drawPanel(x, y, w, h, bg) {
  ctx.fillStyle = bg || PANEL_BG;
  ctx.fillRect(x, y, w, h);
  // top-left highlight
  ctx.strokeStyle = "rgba(255,255,255,0.12)";
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(x, y + h); ctx.lineTo(x, y); ctx.lineTo(x + w, y); ctx.stroke();
  // bottom-right shadow
  ctx.strokeStyle = "rgba(0,0,0,0.3)";
  ctx.beginPath(); ctx.moveTo(x + w, y); ctx.lineTo(x + w, y + h); ctx.lineTo(x, y + h); ctx.stroke();
}

function drawButton(x, y, w, h, text, bg, hovered, textColor) {
  const c = hovered ? lightenColor(bg, 20) : bg;
  ctx.fillStyle = c;
  ctx.fillRect(x, y, w, h);
  // 90s bevel
  ctx.strokeStyle = hovered ? "rgba(255,255,255,0.3)" : "rgba(255,255,255,0.15)";
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(x, y + h); ctx.lineTo(x, y); ctx.lineTo(x + w, y); ctx.stroke();
  ctx.strokeStyle = "rgba(0,0,0,0.4)";
  ctx.beginPath(); ctx.moveTo(x + w, y); ctx.lineTo(x + w, y + h); ctx.lineTo(x, y + h); ctx.stroke();
  drawText(text, x + w / 2, y + (h - 14) / 2, "bold 14px monospace", textColor || WHITE, "center");
}

function lightenColor(hex, amt) {
  let r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
  r = Math.min(255, r + amt); g = Math.min(255, g + amt); b = Math.min(255, b + amt);
  return `rgb(${r},${g},${b})`;
}

// ─── main menu ───────────────────────────────────────────────
function mainMenu() {
  sounds.game.pause(); sounds.game.currentTime = 0;
  loopSound(sounds.menu);

  const sloganText = shuffle([...cheesySlogans]).join("   ★   ");
  let sloganX = W;
  const sloganSpeed = 90;

  let lastT = performance.now();
  function tick(now) {
    const dt = (now - lastT) / 1000; lastT = now;

    // draw
    if (menuLoaded) ctx.drawImage(menuImg, 0, 0, W, H);
    else { fillRect(0, 0, W, H, BLACK); }

    // scrolling slogans
    sloganX -= sloganSpeed * dt;
    const sw = measureText(sloganText, "16px monospace");
    if (sloganX + sw < 0) sloganX = W;
    drawText(sloganText, sloganX, H - 56, "16px monospace", DARK_GRAY);

    // start button
    const bx = W / 2 - 120, by = H / 2, bw = 240, bh = 56;
    const hover = inRect(mouseX, mouseY, bx, by, bw, bh);
    drawButton(bx, by, bw, bh, "▶  START TRADING", hover ? DARK_RED : RED, hover, WHITE);

    if (mouseClicked && hover) {
      mouseClicked = false;
      sounds.menu.pause(); sounds.menu.currentTime = 0;
      gameLoop();
      return;
    }
    mouseClicked = false; wheelDelta = 0;
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

// ─── game loop ───────────────────────────────────────────────
function gameLoop() {
  // Reset game state
  for (const s of stocks) {
    s.price = lognormal(Math.log(40), 0.6);
    s.displayPrice = s.price;
    s.prevPrice = s.price;
    s.history = [[0, s.price]];
    s.dividendYield = rand(0, 5);
  }

  const startCapital = 2000, brokerFee = 5, accountFee = 30, dayLength = 20;
  let capital = startCapital;
  let selectedStock = null, buyQty = 1, sellQty = 1;
  const portfolio = {};
  const sentimentEffects = new Map();
  let currentYear = 1985, monthIdx = 7, dayInMonth = 1;
  let currentDay = 1, dayTimer = 0, dayProgress = 0;
  let dayEndingSoundPlayed = false, dayEndPause = false, dayEndPauseTimer = 0;
  let totalTime = 0, netWorthTimer = 0;
  const netWorthHistory = [], marketHistory = [];
  let selectedScale = "1 week";
  const scaleKeys = Object.keys(graphTimeScales);

  let moneyPouring = false, moneyPouringAmt = 0, moneyPouringTimer = 0;
  const moneyPouringSpeed = 0.05;

  let stockUpdateTimer = 0, stockDisplayTimer = 0, stockDisplayInterval = rand(2, 3);
  let feeDeductedToday = false;
  const pendingNews = [];

  // sector filter state
  let selectedSector = "All";
  let sectorScrollOff = 0;

  // search
  searchText = "";
  searchActive = false;

  // news
  const newsList = Object.keys(newsDict);
  let currentNews = newsList[randInt(0, newsList.length - 1)];
  let [targetType, targetName, newsSentiment] = newsDict[currentNews];
  let sentimentDuration = rand(0.5, 2.75);
  sentimentEffects.set(targetType + "|" + targetName, [newsSentiment, sentimentDuration]);
  let newsX = W, newsSpeed = 70, lastNews = "";

  // scrollbar state
  let stockScrollOff = 0, portScrollOff = 0;

  loopSound(sounds.game);

  let lastT = performance.now();

  function tick(now) {
    const dt = clamp((now - lastT) / 1000, 0, 0.1); lastT = now;

    // ─── LAYOUT (responsive) ───
    const margin = 8;
    const topBarH = 32;
    const sectorBarH = 34;
    const searchBarH = 30;
    const progressBarH = 24;
    const stockPanelW = Math.min(280, Math.floor(W * 0.2));
    const portPanelW = Math.min(300, Math.floor(W * 0.22));
    const bottomControlH = 90;

    const stockListX = margin;
    const stockListY = topBarH + margin;
    const stockListW = stockPanelW;
    const sectorAreaY = stockListY;
    const searchBarY = sectorAreaY + sectorBarH + 4;
    const stockContentY = searchBarY + searchBarH + 4;
    const stockListH = H - stockContentY - bottomControlH - progressBarH - margin * 2;

    const portX = W - portPanelW - margin;
    const portY = topBarH + margin;
    const portW = portPanelW;
    const portH = H - portY - bottomControlH - progressBarH - margin * 2;

    const gLeft = stockListX + stockListW + margin;
    const gRight = portX - margin;
    const gW = gRight - gLeft;

    // ── update timers ──
    totalTime += dt; netWorthTimer += dt; stockUpdateTimer += dt; stockDisplayTimer += dt;

    if (dayEndPause) {
      dayEndPauseTimer += dt;
      if (dayEndPauseTimer >= 1.0) {
        dayEndPause = false;
        const n = Math.min(Math.floor(stocks.length * 0.15), stocks.length);
        const sample = shuffle([...stocks]).slice(0, n);
        for (const s of sample) { s.price += rand(-2, 2); if (s.price < 0.1) s.price = 0.1; s.history.push([totalTime, s.price]); }
      }
    } else {
      dayTimer += dt;
      dayProgress = dayTimer / dayLength;
    }

    // money pouring
    if (moneyPouring) {
      moneyPouringTimer += dt;
      if (moneyPouringTimer >= moneyPouringSpeed) {
        const inc = Math.min(10, moneyPouringAmt);
        capital += inc; moneyPouringAmt -= inc; moneyPouringTimer = 0;
        playSound(sounds.acctBeep);
        if (moneyPouringAmt <= 0) moneyPouring = false;
      }
    }

    // day ending tick
    if ((dayLength - dayTimer) <= 5 && !dayEndingSoundPlayed && !dayEndPause) {
      playSound(sounds.dayTick); dayEndingSoundPlayed = true;
    }

    // end of day
    if (dayTimer >= dayLength && !dayEndPause) {
      dayTimer = 0; dayEndingSoundPlayed = false; currentDay++;
      playSound(sounds.dateInc);
      dayInMonth++;
      if (dayInMonth > MONTH_DAYS[monthIdx]) {
        dayInMonth = 1; monthIdx++;
        if (monthIdx >= 12) { monthIdx = 0; currentYear++; }
      }
      if (dayInMonth === 1 && !feeDeductedToday) {
        for (const item of Object.values(portfolio)) {
          const dp = (item.stock.price * (item.stock.dividendYield / 100)) * item.quantity / 12;
          if (dp > 0) { capital += dp; pendingNews.push(`Received $${dp.toFixed(2)} in dividends from ${item.stock.name}.`); }
        }
        capital -= accountFee;
        pendingNews.push(`Account fees of $${accountFee.toFixed(2)} have been deducted.`);
        feeDeductedToday = true;
      } else if (dayInMonth !== 1) feeDeductedToday = false;

      if (dayInMonth >= MONTH_DAYS[monthIdx] - 1) {
        const msg = `Account fees of $${accountFee.toFixed(2)} will be deducted on the 1st of next month.`;
        if (!pendingNews.includes(msg)) pendingNews.push(msg);
      }

      for (const [k, [s, d]] of sentimentEffects) {
        if (d - 1 <= 0) sentimentEffects.delete(k);
        else sentimentEffects.set(k, [s, d - 1]);
      }
      dayEndPause = true; dayEndPauseTimer = 0; dayProgress = 1;
    }

    // update stocks
    if (stockUpdateTimer >= 1.0) {
      stockUpdateTimer = 0;
      for (const s of stocks) s.updatePrice(totalTime, monthIdx, sentimentEffects);
    }
    if (stockDisplayTimer >= stockDisplayInterval) {
      stockDisplayTimer = 0; stockDisplayInterval = 2;
      for (const s of stocks) s.updateDisplayPrice();
    }

    // news ticker
    newsX -= newsSpeed * dt;
    const nw = measureText(currentNews, "14px monospace");
    if (newsX + nw < 0) {
      if (pendingNews.length) { currentNews = pendingNews.shift(); }
      else {
        lastNews = currentNews;
        currentNews = newsList[randInt(0, newsList.length - 1)];
        while (currentNews === lastNews && newsList.length > 1) currentNews = newsList[randInt(0, newsList.length - 1)];
        [targetType, targetName, newsSentiment] = newsDict[currentNews];
      }
      newsX = W - 150;
    }
    sentimentDuration = rand(0.5, 2.75);
    sentimentEffects.set(targetType + "|" + targetName, [newsSentiment, sentimentDuration]);

    // net worth
    const netWorth = capital + moneyPouringAmt + Object.values(portfolio).reduce((s, i) => s + i.stock.price * i.quantity, 0);
    if (netWorthTimer >= 1.0) {
      netWorthHistory.push([totalTime, netWorth]);
      marketHistory.push([totalTime, stocks.reduce((s, st) => s + st.price, 0) / stocks.length]);
      netWorthTimer = 0;
    }

    // ── filter stocks ──
    let filteredStocks = stocks;
    if (selectedSector !== "All") {
      filteredStocks = stocks.filter(s => s.category === selectedSector);
    }
    if (searchText.length > 0) {
      const q = searchText.toLowerCase();
      filteredStocks = filteredStocks.filter(s =>
        s.name.toLowerCase().includes(q) || s.category.toLowerCase().includes(q)
      );
    }

    const rowH = 28;
    const contentHeightStock = filteredStocks.length * rowH;
    const visibleHeightStock = stockListH;
    const portItems = Object.values(portfolio).sort((a, b) => a.stock.name.localeCompare(b.stock.name));
    const contentHeightPort = portItems.length * 28 + 110;

    // ── handle scroll ──
    if (wheelDelta) {
      if (inRect(mouseX, mouseY, stockListX, stockContentY, stockListW, stockListH)) {
        stockScrollOff = clamp(stockScrollOff + wheelDelta, -Math.max(contentHeightStock - visibleHeightStock, 0), 0);
      } else if (inRect(mouseX, mouseY, portX, portY, portW, portH)) {
        portScrollOff = clamp(portScrollOff + wheelDelta, -Math.max(contentHeightPort - portH, 0), 0);
      }
      wheelDelta = 0;
    }

    // button layout
    const btnY = H - bottomControlH - progressBarH - margin;
    const buyBtnR  = { x: stockListX + 6, y: btnY + 6, w: 70, h: 34 };
    const buyMaxR  = { x: buyBtnR.x + 78, y: btnY + 8, w: 50, h: 28 };
    const buyPlusR = { x: buyMaxR.x + 58, y: btnY + 6, w: 34, h: 34 };
    const buyMinR  = { x: buyPlusR.x + 40, y: btnY + 6, w: 34, h: 34 };
    const sellBtnR  = { x: portX + 6, y: btnY + 6, w: 70, h: 34 };
    const sellMaxR  = { x: sellBtnR.x + 78, y: btnY + 8, w: 50, h: 28 };
    const sellPlusR = { x: sellMaxR.x + 58, y: btnY + 6, w: 34, h: 34 };
    const sellMinR  = { x: sellPlusR.x + 40, y: btnY + 6, w: 34, h: 34 };

    if (mouseClicked) {
      // ── search bar click ──
      if (inRect(mouseX, mouseY, stockListX, searchBarY, stockListW, searchBarH)) {
        searchActive = true;
        playSound(sounds.click);
      } else {
        // clicking elsewhere deactivates search (but keeps text)
        if (searchActive && !inRect(mouseX, mouseY, stockListX, sectorAreaY, stockListW, sectorBarH + searchBarH + 8)) {
          // keep search active if clicking in sector area too
        }
      }

      // ── sector bar click ──
      {
        const cats = ["All", ...allCategories];
        let sx = stockListX + 2 + sectorScrollOff;
        for (const cat of cats) {
          const icon = sectorIcons[cat] || "📁";
          const label = cat.length > 8 ? cat.slice(0, 7) + "…" : cat;
          const bw = measureText(icon + " " + label, "11px monospace") + 14;
          if (inRect(mouseX, mouseY, Math.max(sx, stockListX), sectorAreaY, Math.min(bw, stockListX + stockListW - sx), sectorBarH)) {
            if (sx >= stockListX - bw && sx <= stockListX + stockListW) {
              selectedSector = cat;
              stockScrollOff = 0;
              searchText = "";
              playSound(sounds.click);
            }
          }
          sx += bw + 4;
        }
      }

      // stock list click
      if (inRect(mouseX, mouseY, stockListX, stockContentY, stockListW, stockListH)) {
        const relY = mouseY - stockContentY - stockScrollOff;
        const idx = Math.floor(relY / rowH);
        if (idx >= 0 && idx < filteredStocks.length) {
          selectedStock = filteredStocks[idx]; buyQty = 1; sellQty = 1;
          playSound(sounds.click);
        }
      }
      // portfolio click
      else if (inRect(mouseX, mouseY, portX, portY + 110, portW, portH - 110)) {
        const relY = mouseY - portY - 110 - portScrollOff;
        const idx = Math.floor(relY / 28);
        if (idx >= 0 && idx < portItems.length) {
          selectedStock = portItems[idx].stock; buyQty = 1; sellQty = 1;
          playSound(sounds.click);
        }
      }

      // buy +/-/max/buy
      if (inRect(mouseX, mouseY, buyPlusR.x, buyPlusR.y, buyPlusR.w, buyPlusR.h)) {
        if (selectedStock) { const mx2 = Math.floor((capital - brokerFee) / selectedStock.price); if (buyQty < mx2) { buyQty++; playSound(sounds.qtyChange); } }
      }
      if (inRect(mouseX, mouseY, buyMinR.x, buyMinR.y, buyMinR.w, buyMinR.h)) {
        if (buyQty > 1) { buyQty--; playSound(sounds.qtyChange); }
      }
      if (inRect(mouseX, mouseY, buyMaxR.x, buyMaxR.y, buyMaxR.w, buyMaxR.h)) {
        if (selectedStock) { const mx2 = Math.floor((capital - brokerFee) / selectedStock.price); if (mx2 > 0) { buyQty = mx2; playSound(sounds.qtyChange); } }
      }
      if (inRect(mouseX, mouseY, buyBtnR.x, buyBtnR.y, buyBtnR.w, buyBtnR.h)) {
        if (selectedStock) {
          const total = selectedStock.price * buyQty + brokerFee;
          if (capital >= total) {
            capital -= total; playSound(sounds.buy);
            if (portfolio[selectedStock.name]) portfolio[selectedStock.name].quantity += buyQty;
            else portfolio[selectedStock.name] = { stock: selectedStock, quantity: buyQty };
          }
        }
      }

      // sell +/-/max/sell
      if (inRect(mouseX, mouseY, sellPlusR.x, sellPlusR.y, sellPlusR.w, sellPlusR.h)) {
        if (selectedStock && portfolio[selectedStock.name]) { if (sellQty < portfolio[selectedStock.name].quantity) { sellQty++; playSound(sounds.qtyChange); } }
      }
      if (inRect(mouseX, mouseY, sellMinR.x, sellMinR.y, sellMinR.w, sellMinR.h)) {
        if (sellQty > 1) { sellQty--; playSound(sounds.qtyChange); }
      }
      if (inRect(mouseX, mouseY, sellMaxR.x, sellMaxR.y, sellMaxR.w, sellMaxR.h)) {
        if (selectedStock && portfolio[selectedStock.name]) { const mx2 = portfolio[selectedStock.name].quantity; if (mx2 > 0) { sellQty = mx2; playSound(sounds.qtyChange); } }
      }
      if (inRect(mouseX, mouseY, sellBtnR.x, sellBtnR.y, sellBtnR.w, sellBtnR.h)) {
        if (selectedStock && portfolio[selectedStock.name] && portfolio[selectedStock.name].quantity >= sellQty) {
          portfolio[selectedStock.name].quantity -= sellQty;
          if (portfolio[selectedStock.name].quantity === 0) delete portfolio[selectedStock.name];
          moneyPouring = true; moneyPouringAmt += selectedStock.price * sellQty - brokerFee;
          playSound(sounds.sell);
        }
      }

      // time scale buttons
      const tsTotalW = scaleKeys.length * 82;
      const tsX0 = gLeft + (gW - tsTotalW) / 2;
      const tsY0 = portY + Math.floor((portH + 110) * 0.48);
      scaleKeys.forEach((opt, i) => {
        const bx = tsX0 + i * 82, bw = 76, bh = 26;
        if (inRect(mouseX, mouseY, bx, tsY0, bw, bh)) { selectedScale = opt; playSound(sounds.click); }
      });

      mouseClicked = false;
    }

    // ══════════════ DRAW ══════════════
    ctx.clearRect(0, 0, W, H);
    if (bgLoaded) ctx.drawImage(bgImg, 0, 0, W, H);
    else fillRect(0, 0, W, H, BLACK);

    // darken overlay for readability
    ctx.fillStyle = "rgba(18,18,18,0.45)";
    ctx.fillRect(0, 0, W, H);

    // ── top news bar ──
    fillRect(0, 0, W, topBarH, DARK_PANEL);
    // beveled edge
    ctx.strokeStyle = "rgba(255,255,255,0.08)"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, topBarH); ctx.lineTo(W, topBarH); ctx.stroke();

    ctx.save(); ctx.beginPath(); ctx.rect(80, 0, W - 250, topBarH); ctx.clip();
    drawText(currentNews, newsX, 9, "14px monospace", PAPER_YELLOW);
    ctx.restore();
    fillRect(0, 0, 80, topBarH, DARK_PANEL);
    drawText("📰 News", 8, 9, "bold 13px monospace", PAPER_YELLOW);

    // date
    const dateStr = `${dayInMonth}${getDaySuffix(dayInMonth)} ${MONTHS[monthIdx]}, ${currentYear}`;
    const dw = measureText(dateStr, "bold 13px monospace");
    fillRect(W - dw - 20, 0, dw + 20, topBarH, DARK_PANEL);
    drawText(dateStr, W - dw - 10, 9, "bold 13px monospace", ACCENT_CYAN);

    // ── sector filter bar (horizontal scrollable pills) ──
    drawPanel(stockListX, sectorAreaY, stockListW, sectorBarH);
    ctx.save();
    ctx.beginPath(); ctx.rect(stockListX + 1, sectorAreaY + 1, stockListW - 2, sectorBarH - 2); ctx.clip();
    {
      const cats = ["All", ...allCategories];
      let sx = stockListX + 4 + sectorScrollOff;
      const pillH = 22;
      const pillY = sectorAreaY + (sectorBarH - pillH) / 2;
      for (const cat of cats) {
        const icon = sectorIcons[cat] || "📁";
        const label = cat.length > 9 ? cat.slice(0, 8) + "…" : cat;
        const text = icon + " " + label;
        const tw = measureText(text, "10px monospace") + 12;
        const isActive = selectedSector === cat;
        const isHovered = inRect(mouseX, mouseY, sx, pillY, tw, pillH);

        if (isActive) {
          ctx.fillStyle = TEAL;
          ctx.fillRect(sx, pillY, tw, pillH);
        } else if (isHovered) {
          ctx.fillStyle = "rgba(26,188,156,0.3)";
          ctx.fillRect(sx, pillY, tw, pillH);
        } else {
          ctx.fillStyle = "rgba(255,255,255,0.06)";
          ctx.fillRect(sx, pillY, tw, pillH);
        }
        // square border
        ctx.strokeStyle = isActive ? ACCENT_CYAN : "rgba(255,255,255,0.15)";
        ctx.lineWidth = 1;
        ctx.strokeRect(sx, pillY, tw, pillH);

        drawText(text, sx + 6, pillY + 4, "10px monospace", isActive ? BLACK : WHITE);
        sx += tw + 4;
      }
    }
    ctx.restore();

    // Scroll sector bar with mouse drag/wheel near it
    if (wheelDelta && inRect(mouseX, mouseY, stockListX, sectorAreaY, stockListW, sectorBarH)) {
      sectorScrollOff = clamp(sectorScrollOff + wheelDelta, -600, 0);
      wheelDelta = 0;
    }

    // ── search bar ──
    {
      const sbX = stockListX, sbY = searchBarY, sbW = stockListW, sbH = searchBarH;
      ctx.fillStyle = searchActive ? "#1e2d3d" : DARK_PANEL;
      ctx.fillRect(sbX, sbY, sbW, sbH);
      ctx.strokeStyle = searchActive ? ACCENT_CYAN : "rgba(255,255,255,0.15)";
      ctx.lineWidth = searchActive ? 2 : 1;
      ctx.strokeRect(sbX, sbY, sbW, sbH);

      const placeholder = searchText.length === 0 ? "🔍 Search stocks..." : "";
      if (placeholder) {
        drawText(placeholder, sbX + 8, sbY + 8, "12px monospace", GRAY);
      } else {
        drawText("🔍 " + searchText, sbX + 8, sbY + 8, "12px monospace", WHITE);
        // blinking cursor
        if (searchActive && Math.floor(now / 500) % 2 === 0) {
          const cursorX = sbX + 8 + measureText("🔍 " + searchText, "12px monospace") + 2;
          fillRect(cursorX, sbY + 6, 1, 16, ACCENT_CYAN);
        }
      }
    }

    // ── stock list panel ──
    drawPanel(stockListX, stockContentY, stockListW, stockListH);
    ctx.save();
    ctx.beginPath(); ctx.rect(stockListX, stockContentY, stockListW, stockListH); ctx.clip();
    let yOff = stockContentY + stockScrollOff;
    for (const s of filteredStocks) {
      if (yOff + rowH > stockContentY && yOff < stockContentY + stockListH) {
        const isHovered = inRect(mouseX, mouseY, stockListX, yOff, stockListW, rowH) && yOff >= stockContentY;
        const isSelected = selectedStock === s;
        const change = s.displayPrice - s.prevPrice;
        const changeColor = change >= 0 ? GREEN : RED;
        const arrow = change >= 0 ? "▲" : "▼";

        if (isSelected) {
          ctx.fillStyle = "rgba(26,188,156,0.25)";
          ctx.fillRect(stockListX, yOff, stockListW, rowH);
          ctx.strokeStyle = TEAL; ctx.lineWidth = 1;
          ctx.strokeRect(stockListX + 1, yOff, stockListW - 2, rowH);
        } else if (isHovered) {
          ctx.fillStyle = "rgba(255,255,255,0.06)";
          ctx.fillRect(stockListX, yOff, stockListW, rowH);
        }

        // alternating subtle stripe
        if (!isSelected && !isHovered && filteredStocks.indexOf(s) % 2 === 0) {
          ctx.fillStyle = "rgba(255,255,255,0.02)";
          ctx.fillRect(stockListX, yOff, stockListW, rowH);
        }

        const nameW = stockListW - 90;
        const displayName = s.name.length > 18 ? s.name.slice(0, 17) + "…" : s.name;
        drawText(displayName, stockListX + 8, yOff + 6, "12px monospace", WHITE);
        drawText(`$${s.displayPrice.toFixed(1)}`, stockListX + nameW, yOff + 6, "12px monospace", changeColor);
        drawText(arrow, stockListX + stockListW - 20, yOff + 6, "10px monospace", changeColor);
      }
      yOff += rowH;
    }
    ctx.restore();

    // scrollbar for stocks
    if (contentHeightStock > visibleHeightStock) {
      const ratio = visibleHeightStock / contentHeightStock;
      const barH = Math.max(20, stockListH * ratio);
      const scrollRatio = -stockScrollOff / Math.max(1, contentHeightStock - visibleHeightStock);
      const barY = stockContentY + scrollRatio * (stockListH - barH);
      ctx.fillStyle = "rgba(149,165,166,0.4)";
      ctx.fillRect(stockListX + stockListW - 8, barY, 6, barH);
    }

    // stock count badge
    {
      const countText = `${filteredStocks.length} stocks`;
      const ctW = measureText(countText, "10px monospace") + 10;
      fillRect(stockListX + stockListW - ctW - 2, stockContentY + stockListH - 18, ctW, 16, DARK_PANEL);
      drawText(countText, stockListX + stockListW - ctW + 3, stockContentY + stockListH - 16, "10px monospace", GRAY);
    }

    // ── buy controls ──
    drawPanel(stockListX, btnY, stockListW, bottomControlH - 4);
    drawText(`Qty: ${buyQty}`, buyBtnR.x + 4, btnY + 4, "11px monospace", ACCENT_CYAN);
    drawButton(buyBtnR.x, buyBtnR.y, buyBtnR.w, buyBtnR.h, "BUY", GREEN, inRect(mouseX, mouseY, buyBtnR.x, buyBtnR.y, buyBtnR.w, buyBtnR.h), BLACK);
    drawButton(buyMaxR.x, buyMaxR.y, buyMaxR.w, buyMaxR.h, "MAX", ORANGE, inRect(mouseX, mouseY, buyMaxR.x, buyMaxR.y, buyMaxR.w, buyMaxR.h), BLACK);
    drawButton(buyPlusR.x, buyPlusR.y, buyPlusR.w, buyPlusR.h, "+", GRAY, inRect(mouseX, mouseY, buyPlusR.x, buyPlusR.y, buyPlusR.w, buyPlusR.h), PAPER_YELLOW);
    drawButton(buyMinR.x, buyMinR.y, buyMinR.w, buyMinR.h, "−", GRAY, inRect(mouseX, mouseY, buyMinR.x, buyMinR.y, buyMinR.w, buyMinR.h), PAPER_YELLOW);

    if (selectedStock) {
      const tb = selectedStock.price * buyQty + brokerFee;
      drawText(`Total: $${tb.toFixed(2)}`, buyBtnR.x + 4, buyBtnR.y + 40, "11px monospace", WHITE);
    }

    // ── portfolio panel ──
    drawPanel(portX, portY, portW, portH);
    ctx.save(); ctx.beginPath(); ctx.rect(portX, portY, portW, portH); ctx.clip();

    // capital + net worth header
    let py = portY + 8;
    const capitalColor = capital >= startCapital ? GREEN : (capital > 500 ? PAPER_YELLOW : RED);
    drawText("CAPITAL", portX + 10, py, "bold 10px monospace", GRAY); py += 14;
    drawText(`$${capital.toFixed(2)}`, portX + 10, py, "bold 18px monospace", capitalColor); py += 24;

    drawText("NET WORTH", portX + 10, py, "bold 10px monospace", GRAY); py += 14;
    const nwColor = netWorth >= startCapital ? GREEN : RED;
    const nwChange = netWorth - startCapital;
    const nwPct = ((nwChange / startCapital) * 100).toFixed(1);
    drawText(`$${netWorth.toFixed(2)}`, portX + 10, py, "bold 18px monospace", nwColor);
    drawText(`${nwChange >= 0 ? "+" : ""}${nwPct}%`, portX + portW - 60, py + 4, "11px monospace", nwColor);
    py += 26;

    // divider
    ctx.strokeStyle = "rgba(255,255,255,0.1)"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(portX + 10, py); ctx.lineTo(portX + portW - 10, py); ctx.stroke();
    py += 6;

    drawText("PORTFOLIO", portX + 10, py, "bold 12px monospace", ACCENT_CYAN); py += 20;

    const portStartY = py;
    py += portScrollOff;
    for (const item of portItems) {
      if (py + 28 > portY && py < portY + portH) {
        const isSelected = selectedStock === item.stock;
        const isHovered = inRect(mouseX, mouseY, portX, py, portW, 28);

        if (isSelected) {
          ctx.fillStyle = "rgba(26,188,156,0.2)";
          ctx.fillRect(portX + 2, py, portW - 4, 28);
        } else if (isHovered) {
          ctx.fillStyle = "rgba(255,255,255,0.05)";
          ctx.fillRect(portX + 2, py, portW - 4, 28);
        }

        const totalVal = (item.stock.price * item.quantity).toFixed(0);
        drawText(`${item.stock.name}`, portX + 10, py + 4, "11px monospace", WHITE);
        drawText(`×${item.quantity}`, portX + portW - 100, py + 4, "11px monospace", GRAY);
        drawText(`$${totalVal}`, portX + portW - 50, py + 4, "11px monospace", GREEN, "right");
      }
      py += 28;
    }

    if (portItems.length === 0) {
      drawText("No holdings yet", portX + 10, portStartY + 10, "11px monospace", GRAY);
      drawText("Buy stocks to start!", portX + 10, portStartY + 26, "11px monospace", GRAY);
    }
    ctx.restore();

    // scrollbar for portfolio
    if (contentHeightPort > portH) {
      const ratio = portH / contentHeightPort;
      const barH2 = Math.max(20, portH * ratio);
      const scrollRatio = -portScrollOff / Math.max(1, contentHeightPort - portH);
      const barY = portY + scrollRatio * (portH - barH2);
      ctx.fillStyle = "rgba(149,165,166,0.4)";
      ctx.fillRect(portX + portW - 8, barY, 6, barH2);
    }

    // ── sell controls ──
    drawPanel(portX, btnY, portW, bottomControlH - 4);
    drawText(`Qty: ${sellQty}`, sellBtnR.x + 4, btnY + 4, "11px monospace", ACCENT_CYAN);
    drawButton(sellBtnR.x, sellBtnR.y, sellBtnR.w, sellBtnR.h, "SELL", RED, inRect(mouseX, mouseY, sellBtnR.x, sellBtnR.y, sellBtnR.w, sellBtnR.h), WHITE);
    drawButton(sellMaxR.x, sellMaxR.y, sellMaxR.w, sellMaxR.h, "MAX", ORANGE, inRect(mouseX, mouseY, sellMaxR.x, sellMaxR.y, sellMaxR.w, sellMaxR.h), BLACK);
    drawButton(sellPlusR.x, sellPlusR.y, sellPlusR.w, sellPlusR.h, "+", GRAY, inRect(mouseX, mouseY, sellPlusR.x, sellPlusR.y, sellPlusR.w, sellPlusR.h), PAPER_YELLOW);
    drawButton(sellMinR.x, sellMinR.y, sellMinR.w, sellMinR.h, "−", GRAY, inRect(mouseX, mouseY, sellMinR.x, sellMinR.y, sellMinR.w, sellMinR.h), PAPER_YELLOW);

    if (selectedStock && portfolio[selectedStock.name]) {
      const ts = Math.max(0, selectedStock.price * sellQty);
      drawText(`Total: $${ts.toFixed(2)} (-$${brokerFee})`, sellBtnR.x + 4, sellBtnR.y + 40, "11px monospace", PAPER_YELLOW);
    }

    // ── day progress bar ──
    const pbY = H - progressBarH - margin;
    const pbW = W - margin * 2;
    fillRect(margin, pbY, pbW, progressBarH, DARK_PANEL);
    const progColor = (dayEndingSoundPlayed || dayEndPause) ? ORANGE : GREEN;
    // gradient fill for progress
    const progGrad = ctx.createLinearGradient(margin, pbY, margin + pbW * dayProgress, pbY);
    progGrad.addColorStop(0, progColor);
    progGrad.addColorStop(1, lightenColor(progColor, 30));
    ctx.fillStyle = progGrad;
    ctx.fillRect(margin, pbY, pbW * dayProgress, progressBarH);
    // border
    ctx.strokeStyle = "rgba(255,255,255,0.2)"; ctx.lineWidth = 1;
    ctx.strokeRect(margin, pbY, pbW, progressBarH);
    // day label
    drawText(`Day ${currentDay}`, margin + 8, pbY + 5, "bold 12px monospace", WHITE);
    if (dayEndPause) {
      drawText("MARKET CLOSED", margin + pbW / 2, pbY + 5, "bold 12px monospace", PAPER_YELLOW, "center");
    }

    // ── graphs area ──
    const graphAreaY = topBarH + margin;
    const graphAreaH = H - graphAreaY - bottomControlH - progressBarH - margin * 2;

    // time scale buttons
    const tsTotalW = scaleKeys.length * 82;
    const tsX0 = gLeft + (gW - tsTotalW) / 2;
    const tsY0 = graphAreaY + Math.floor(graphAreaH * 0.48);
    scaleKeys.forEach((opt, i) => {
      const bx = tsX0 + i * 82, bw = 76, bh = 24;
      const isActive = selectedScale === opt;
      const hov = inRect(mouseX, mouseY, bx, tsY0, bw, bh);
      drawButton(bx, tsY0, bw, bh, opt, isActive ? TEAL : DARK_PANEL, hov, isActive ? BLACK : WHITE);
    });

    // upper graph (stock price / market index)
    const ugY = graphAreaY;
    const ugH = tsY0 - ugY - 8;
    drawPanel(gLeft, ugY, gW, ugH);

    let graphTitle;
    if (!selectedStock) {
      graphTitle = "📈 Market Index";
      const d = getGraphData(marketHistory, totalTime, selectedScale);
      if (d.length > 1) drawGraph(gLeft, ugY, gW, ugH, d, RED, null, false);
    } else {
      const change = selectedStock.displayPrice - selectedStock.prevPrice;
      const arrow = change >= 0 ? "▲" : "▼";
      const cc = change >= 0 ? GREEN : RED;
      graphTitle = selectedStock.name;
      const d = getGraphData(selectedStock.history, totalTime, selectedScale);
      if (d.length > 1) drawGraph(gLeft, ugY, gW, ugH, d, cc, null, false);

      // stock info overlay
      drawText(`$${selectedStock.displayPrice.toFixed(2)}`, gLeft + gW - 10, ugY + 6, "bold 16px monospace", cc, "right");
      drawText(`${arrow} ${Math.abs(change).toFixed(2)}`, gLeft + gW - 10, ugY + 24, "12px monospace", cc, "right");
      drawText(`[${selectedStock.category}]`, gLeft + gW - 10, ugY + 38, "10px monospace", GRAY, "right");
    }
    drawText(graphTitle, gLeft + 10, ugY + 6, "bold 16px monospace", WHITE);

    // lower graph (net worth)
    const lgY = tsY0 + 32;
    const lgH = graphAreaY + graphAreaH - lgY;
    drawPanel(gLeft, lgY, gW, lgH);
    const nwd = getGraphData(netWorthHistory, totalTime, selectedScale);
    if (nwd.length > 1) drawGraph(gLeft, lgY, gW, lgH, nwd, BLUE, startCapital, true);
    drawText("💼 Net Worth", gLeft + 10, lgY + 6, "bold 14px monospace", WHITE);
    drawText(`$${netWorth.toFixed(2)}`, gLeft + gW - 10, lgY + 6, "bold 14px monospace", nwColor, "right");

    mouseClicked = false; wheelDelta = 0;
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

// ─── kick off ────────────────────────────────────────────────
mainMenu();
