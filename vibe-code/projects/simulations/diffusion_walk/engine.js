// CONFIG: tweakable parameters for behavior and style
export const CONFIG = {
	// Spawn & burst
	satellitesPerBurst: 36,
	spawnRadiusMin: 12,
	spawnRadiusMax: 120,
	spawnRadiusDistribution: "gaussian", // 'uniform' | 'gaussian'

	// Dots
	baseRadius: 2.2, // default particle radius
	centroidRadius: 4.0, // target radius for centroid dot
	shadowBlur: 8, // soft edge
	color: "#0a0a0a", // near-black

	// Motion
	driftSpeed: 8, // px per second (small)
	driftNoiseScale: 0.0006, // perlin-ish hash noise scale in 1/ms
	edgePolicy: "wrap", // 'wrap' | 'clamp'

	// Growth and fade
	growMs: 700,
	easing: "easeOutCubic", // see Easings below
	alphaHalfLifeMs: 3800, // exponential decay half-life
	minAlpha: 0.008, // remove at or below

	// Centroid computation
	centroidScope: "burst", // 'burst' | 'all'
	centroidWeighting: "alpha", // 'uniform' | 'alpha'

	// System
	hiDPIScale: true,
	maxParticles: 3000,
	cullBatch: 200, // when over capacity, remove oldest this many

	// Idle autopilot
	autopilot: true,
	autopilotIntervalMs: 2500,
	inactivityMs: 5000, // time since last user input to allow autopilot

	// Input
	allowTouch: true,
};

// Utility: Easings
const Easings = {
	linear: t => t,
	easeOutCubic: t => 1 - Math.pow(1 - t, 3),
	easeOutQuad: t => 1 - (1 - t) * (1 - t),
};

// Utility: random helpers
const rand = (a = 1, b) => (b === undefined ? Math.random() * a : a + Math.random() * (b - a));
const randInt = (a, b) => Math.floor(rand(a, b + 1));
const randSign = () => (Math.random() < 0.5 ? -1 : 1);
const TWO_PI = Math.PI * 2;

// Sample radius with chosen distribution within [min, max]
function sampleRadius(min, max, distribution) {
	if (distribution === "gaussian") {
		// Box-Muller transform for normal(0,1)
		let u = 0, v = 0;
		while (u === 0) u = Math.random();
		while (v === 0) v = Math.random();
		const n = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v); // ~N(0,1)
		const z = (n + 3) / 6; // map ~[-3,3] to [0,1]
		const t = Math.max(0, Math.min(1, z));
		return min + t * (max - min);
	}
	// uniform fallback
	return rand(min, max);
}

// Lightweight pseudo-noise using hash of position and time
function hashNoise(x, y, t) {
	// x,y in px, t in ms
	const n = Math.sin(x * 12.9898 + y * 78.233 + t * 0.000125) * 43758.5453;
	return n - Math.floor(n);
}

class Particle {
	constructor() { this.reset(); }
	reset() {
		this.x = 0; this.y = 0;
		this.vx = 0; this.vy = 0;
		this.r = CONFIG.baseRadius;
		this.alpha = 1;
		this.birth = 0;
		this.growFrom = null; // {t0, dur, rTarget}
		this.isCentroid = false;
	}
}

class Pool {
	constructor(capacity) {
		this.capacity = capacity;
		this.items = new Array(capacity).fill(null).map(() => new Particle());
		this.free = [...this.items];
		this.active = [];
	}
	acquire() {
		return this.free.length ? this.free.pop() : (this.active.shift() || new Particle());
	}
	release(p) {
		this.free.push(p);
	}
}

class Renderer {
	constructor(canvas, ctx) {
		this.canvas = canvas; this.ctx = ctx;
	}
	clear(bg) {
	const { ctx, canvas } = this;
		ctx.save();
		ctx.fillStyle = bg;
	const rect = canvas.getBoundingClientRect();
	ctx.fillRect(0, 0, rect.width, rect.height);
		ctx.restore();
	}
	drawParticles(particles, color, blur) {
		const { ctx } = this;
		ctx.save();
		ctx.fillStyle = color;
		ctx.shadowColor = color;
		ctx.shadowBlur = blur;
		for (let i = 0; i < particles.length; i++) {
			const p = particles[i];
			const a = p.alpha;
			if (a <= 0) continue;
			ctx.globalAlpha = a;
			ctx.beginPath();
			ctx.arc(p.x, p.y, p.r, 0, TWO_PI);
			ctx.fill();
		}
		ctx.restore();
	}
}

class Emitter {
	constructor(pool) {
		this.pool = pool;
	}

	burst(x, y, now) {
		const created = [];
		// seed dot
		created.push(this.spawnDot(x, y, CONFIG.baseRadius, now, false));
		// satellites
		const n = CONFIG.satellitesPerBurst;
		for (let i = 0; i < n; i++) {
			const ang = rand(0, TWO_PI);
			const dist = sampleRadius(CONFIG.spawnRadiusMin, CONFIG.spawnRadiusMax, CONFIG.spawnRadiusDistribution);
			const px = x + Math.cos(ang) * dist;
			const py = y + Math.sin(ang) * dist;
			created.push(this.spawnDot(px, py, CONFIG.baseRadius, now, false));
		}
			// centroid (burst scope only; 'all' scope handled by App)
			if (CONFIG.centroidScope === 'burst') {
				const centroid = this.computeCentroid(created, now);
				const c = this.spawnDot(centroid.x, centroid.y, CONFIG.centroidRadius, now, true);
				// growth animation
				c.growFrom = { t0: now, dur: CONFIG.growMs, rTarget: CONFIG.centroidRadius };
				c.r = 0.001; // start from zero
				created.push(c);
			}
		return created;
	}

	computeCentroid(set, now) {
		// Either from this burst or from all active particles handled by App
		if (CONFIG.centroidScope === "burst") {
			return weightedCentroid(set);
		} else {
			// Fallback to burst if all not available here; App will override.
			return weightedCentroid(set);
		}
	}

	spawnDot(x, y, r, now, isCentroid) {
		const p = this.pool.acquire();
		p.x = x; p.y = y; p.vx = 0; p.vy = 0; p.r = r; p.alpha = 1; p.birth = now; p.isCentroid = !!isCentroid; p.growFrom = null;
		return p;
	}
}

function weightedCentroid(particles) {
	const mode = CONFIG.centroidWeighting;
	let sx = 0, sy = 0, sw = 0;
	for (const p of particles) {
		if (!p) continue;
		const w = mode === "alpha" ? (p.alpha || 1) : 1;
		sx += p.x * w; sy += p.y * w; sw += w;
	}
	return { x: sw ? sx / sw : 0, y: sw ? sy / sw : 0 };
}

class App {
	constructor(canvas) {
		this.canvas = canvas;
		this.ctx = canvas.getContext("2d", { alpha: false, desynchronized: true });
		this.renderer = new Renderer(canvas, this.ctx);
		this.pool = new Pool(CONFIG.maxParticles + CONFIG.cullBatch);
		this.emitter = new Emitter(this.pool);
		this.particles = [];
		this.running = true;
		this.lastT = performance.now();
		this.bg = getComputedStyle(document.documentElement).getPropertyValue('--bg')?.trim() || '#f7f6f3';
		this.lastInputMs = this.lastT;
		this.autopilotOn = CONFIG.autopilot;
		this.resize();
		this.bindEvents();
		requestAnimationFrame(this.loop);
	}

		resize = () => {
			const dpr = CONFIG.hiDPIScale ? Math.max(1, Math.min(3, window.devicePixelRatio || 1)) : 1;
			const rect = this.canvas.getBoundingClientRect();
			this.cssW = rect.width; this.cssH = rect.height; // CSS pixels for logic coords
			const W = Math.max(1, Math.floor(this.cssW * dpr));
			const H = Math.max(1, Math.floor(this.cssH * dpr));
			if (this.canvas.width !== W || this.canvas.height !== H) {
				this.canvas.width = W; this.canvas.height = H;
			}
			this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		};

	bindEvents() {
		window.addEventListener('resize', this.resize, { passive: true });
		const pointer = (e) => {
			if (!CONFIG.allowTouch && e.pointerType === 'touch') return;
			const rect = this.canvas.getBoundingClientRect();
			const x = (e.clientX - rect.left);
			const y = (e.clientY - rect.top);
			this.userBurst(x, y);
		};
		this.canvas.addEventListener('pointerdown', pointer);

		window.addEventListener('keydown', (e) => {
		if (e.key === ' ' || e.code === 'Space') { e.preventDefault(); this.running = !this.running; if (this.running) this.tick(performance.now()); }
			else if (e.key === 'r' || e.key === 'R') { this.reset(); }
			else if (e.key === 's' || e.key === 'S') { this.savePNG(); }
			else if (e.key === 'a' || e.key === 'A') { this.autopilotOn = !this.autopilotOn; }
		});
	}

	userBurst(x, y) {
		this.lastInputMs = performance.now();
		const now = this.lastInputMs;
		const created = this.emitter.burst(x, y, now);
		this.addParticles(created);
		// If centroid scope is 'all', add an extra centroid over all active
		if (CONFIG.centroidScope === 'all') {
			const cxy = weightedCentroid(this.particles);
			const c = this.emitter.spawnDot(cxy.x, cxy.y, CONFIG.centroidRadius, now, true);
			c.growFrom = { t0: now, dur: CONFIG.growMs, rTarget: CONFIG.centroidRadius };
			c.r = 0.001;
			this.addParticles([c]);
		}
	}

	addParticles(arr) {
		const now = performance.now();
		for (const p of arr) { p.birth = now; this.particles.push(p); }
		// capacity control
		if (this.particles.length > CONFIG.maxParticles + CONFIG.cullBatch) {
			const remove = this.particles.splice(0, this.particles.length - CONFIG.maxParticles);
			for (const p of remove) this.pool.release(p);
		}
	}

	reset() {
		for (const p of this.particles) this.pool.release(p);
		this.particles.length = 0;
		this.renderer.clear(this.bg);
	}

	savePNG() {
		try {
			const link = document.createElement('a');
			link.download = `calm-point-cloud-${Date.now()}.png`;
			link.href = this.canvas.toDataURL('image/png');
			link.click();
		} catch {}
	}

	update(dt, now) {
		const W = this.cssW || this.canvas.getBoundingClientRect().width;
		const H = this.cssH || this.canvas.getBoundingClientRect().height;
		const halfLife = CONFIG.alphaHalfLifeMs;
		const decay = Math.pow(0.5, dt / halfLife);
		const speed = CONFIG.driftSpeed; // px/s in CSS pixels, dt in ms
		const v = speed * (dt / 1000);
		const nScale = CONFIG.driftNoiseScale;

		for (let i = 0; i < this.particles.length; i++) {
			const p = this.particles[i];

			// Grow animation for centroid
			if (p.growFrom) {
				const { t0, dur, rTarget } = p.growFrom;
				const t = Math.min(1, (now - t0) / dur);
				const ease = Easings[CONFIG.easing] || Easings.easeOutCubic;
				p.r = Math.max(0.001, (ease(t)) * rTarget);
				if (t >= 1) p.growFrom = null;
			}

			// Drift via noise
			const nAng = hashNoise(p.x * 0.5, p.y * 0.5, now * nScale) * TWO_PI;
			p.x += Math.cos(nAng) * v;
			p.y += Math.sin(nAng) * v;

			// Edge policy
			if (CONFIG.edgePolicy === 'wrap') {
				if (p.x < 0) p.x += W; else if (p.x >= W) p.x -= W;
				if (p.y < 0) p.y += H; else if (p.y >= H) p.y -= H;
			} else {
				if (p.x < 0) p.x = 0; else if (p.x > W) p.x = W;
				if (p.y < 0) p.y = 0; else if (p.y > H) p.y = H;
			}

			// Fade
			p.alpha *= decay;
		}

		// Remove dead
		const minA = CONFIG.minAlpha;
		let write = 0;
		for (let read = 0; read < this.particles.length; read++) {
			const p = this.particles[read];
			if (p.alpha > minA) {
				this.particles[write++] = p;
			} else {
				this.pool.release(p);
			}
		}
		this.particles.length = write;
	}

	draw() {
		this.renderer.clear(this.bg);
		this.renderer.drawParticles(this.particles, CONFIG.color, CONFIG.shadowBlur);
	}

	maybeAutopilot(now) {
		if (!this.autopilotOn) return;
		const inactive = now - this.lastInputMs;
		if (inactive >= CONFIG.inactivityMs) {
			if (!this._nextAuto || now >= this._nextAuto) {
				const rect = this.canvas.getBoundingClientRect();
				const x = rand(0, rect.width);
				const y = rand(0, rect.height);
				this.userBurst(x, y);
				this._nextAuto = now + CONFIG.autopilotIntervalMs;
			}
		} else {
			this._nextAuto = now + CONFIG.autopilotIntervalMs;
		}
	}

	tick(now) {
		const dt = Math.min(50, now - this.lastT);
		this.lastT = now;
		if (this.running) {
			this.update(dt, now);
			this.draw();
		}
	}

	loop = (t) => {
		this.tick(t);
		this.maybeAutopilot(t);
		requestAnimationFrame(this.loop);
	};
}

// Boot
function main() {
	const canvas = document.getElementById('stage');
	if (!canvas) return;
	// Ensure canvas matches CSS pixels initially
	const setSize = () => {
		canvas.style.width = '100vw';
		canvas.style.height = '100vh';
	};
	setSize();
	new App(canvas);
}

window.addEventListener('DOMContentLoaded', main, { once: true });

