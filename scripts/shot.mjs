// Screenshots the running dev server at Street View and at each Station.
// Usage: node scripts/shot.mjs [baseUrl]   (default http://localhost:5173)
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium, expect } from "@playwright/test";

const base = process.argv[2] ?? "http://localhost:5173";
const out = "blender/renders/web";
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({
	args: [
		"--use-gl=angle",
		"--use-angle=swiftshader",
		"--enable-unsafe-swiftshader",
	],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
// Hold the Full Quality Tier for repeatable before/after visual comparisons.
await page.addInitScript(() =>
	localStorage.setItem("creamery-quality", "full"),
);
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));

await page.goto(base);
await page
	.getByRole("button", { name: "Open the shop" })
	.click({ timeout: 60_000 });
await page.waitForTimeout(2500);
await page.screenshot({ path: `${out}/street.png` });

if (process.argv.includes("--customers")) {
	const { reviewCustomers } = await import("./customer-review.mjs");
	await reviewCustomers(page, out);
	assert.deepEqual(errors, []);
	await browser.close();
	process.exit(0);
}

if (process.argv.includes("--traffic")) {
	await page.waitForFunction(async () => {
		const resource = performance
			.getEntriesByType("resource")
			.find((r) => r.name.includes("/@react-three_fiber"));
		if (!resource) return false;
		const { _roots } = await import(resource.name);
		return !!_roots
			.get(document.querySelector("canvas"))
			?.store.getState()
			.scene.getObjectByName("traffic");
	});
	await page.evaluate(async () => {
		const resource = performance
			.getEntriesByType("resource")
			.find((r) => r.name.includes("/@react-three_fiber"));
		const { _roots } = await import(resource.name);
		const state = _roots.get(document.querySelector("canvas")).store.getState();
		state.setFrameloop("never");
		const traffic = state.internal.subscribers.find((sub) =>
			sub.ref.current.toString().includes("car.root.position.x"),
		);
		if (!traffic) throw new Error("Traffic frame controller not registered");
		window.trafficReview = {
			state,
			step(seconds, render = true) {
				for (let i = 0; i < seconds * 60; i++) {
					traffic.ref.current(state, 1 / 60);
				}
				if (render) {
					// Includes one road-reflection render, not thousands during the wait.
					for (const sub of state.internal.subscribers) {
						sub.ref.current(state, 0);
					}
				}
				const car = state.scene.getObjectByName("traffic");
				return { visible: car.visible, x: car.position.x };
			},
		};
	});
	const crossing = await page.evaluate(() => {
		for (let i = 0; i < 70 * 60; i++) {
			const car = window.trafficReview.step(1 / 60, false);
			if (car.visible && Math.abs(car.x) < 0.04)
				return window.trafficReview.step(0);
		}
		throw new Error("No car crossed Street View");
	});
	console.log("Traffic crossing:", crossing);
	await page.screenshot({ path: `${out}/traffic-street.png`, timeout: 30_000 });
	console.log("Captured traffic in Street View");
	// A close inspection of the same exported car, using the app's renderer.
	await page.evaluate(() => {
		const { state } = window.trafficReview;
		state.setFrameloop("never");
		const car = state.scene.getObjectByName("traffic");
		car.position.x = 0;
		car.visible = true;
		state.camera.position.set(3.2, 1.8, 6.9);
		state.camera.lookAt(0, 0.38, 3.85);
		state.camera.updateMatrixWorld();
		for (const sub of state.internal.subscribers)
			if (sub.priority > 0) sub.ref.current(state, 0);
	});
	// Save the direct WebGL render while its camera is fixed for inspection.
	const carImage = await page.evaluate(() => {
		const { state } = window.trafficReview;
		for (const sub of state.internal.subscribers)
			if (sub.priority > 0) sub.ref.current(state, 0);
		return state.gl.domElement.toDataURL("image/png").split(",")[1];
	});
	writeFileSync(`${out}/traffic-detail.png`, Buffer.from(carImage, "base64"));
	console.log("Captured traffic detail");
	await page.getByRole("button", { name: "About", exact: true }).click();
	const hidden = await page.evaluate(() => window.trafficReview.step(2));
	assert.equal(hidden.visible, false, "traffic stays out of a Section");
	await page.evaluate(() => window.trafficReview.step(70));
	await page.getByRole("button", { name: "Street View", exact: true }).click();
	const quiet = await page.evaluate(() => window.trafficReview.step(10));
	assert.equal(quiet.visible, false, "returning does not queue missed cars");
	await page.evaluate(() => window.trafficReview.state.setFrameloop("always"));
	await page.setViewportSize({ width: 390, height: 844 });
	await page.waitForTimeout(1500);
	await page.evaluate(() => {
		const { state } = window.trafficReview;
		state.setFrameloop("never");
		for (let i = 0; i < 70 * 60; i++) {
			const car = window.trafficReview.step(1 / 60, false);
			if (car.visible && Math.abs(car.x) < 0.04) {
				window.trafficReview.step(0);
				break;
			}
		}
	});
	await page.screenshot({ path: `${out}/traffic-phone.png` });
	await page.evaluate(() => window.trafficReview.state.setFrameloop("always"));
	await page.getByRole("button", { name: "Quality settings" }).click();
	await expect(
		page.getByRole("radio", { name: "Full", exact: true }),
	).toBeFocused();
	await page.keyboard.press("ArrowDown");
	await expect(
		page.getByRole("radio", { name: "Balanced", exact: true }),
	).toBeChecked();
	await page.keyboard.press("Escape");
	await expect(
		page.getByRole("button", { name: "Quality settings" }),
	).toBeFocused();
	await expect(
		page.getByRole("button", { name: "Quality settings" }),
	).toHaveAttribute("aria-expanded", "false");
	await page.getByRole("button", { name: "Quality settings" }).click();
	for (const tier of ["balanced", "light", "auto"]) {
		await page.locator(`.quality-options input[value="${tier}"]`).check();
		await page.waitForTimeout(500);
		await page.screenshot({ path: `${out}/quality-${tier}.png` });
	}
	await page.keyboard.press("Escape");
	await expect(page.locator(".quality-options")).not.toBeVisible();
	const reduced = await browser.newPage({ reducedMotion: "reduce" });
	let carRequested = false;
	reduced.on("request", (r) => {
		if (r.url().includes("traffic-car.glb")) carRequested = true;
	});
	await reduced.goto(base);
	await reduced.getByRole("button", { name: "Open the shop" }).click();
	await reduced.waitForTimeout(1500);
	assert.equal(carRequested, false, "reduced motion skips the car download");
	assert.deepEqual(errors, []);
	await browser.close();
	console.log(
		"Traffic: Street View, Station suppression, quiet return, Quality Tiers and reduced motion passed",
	);
	process.exit(0);
}

if (process.argv.includes("--cats")) {
	// Deterministic pose review through the same public controller as the app.
	// Keep this dev-only inspection here, out of the shipped visitor experience.
	await page.evaluate(async () => {
		const resource = performance
			.getEntriesByType("resource")
			.find(
				(r) =>
					r.name.includes("/@react-three_fiber") ||
					r.name.includes("/deps/@react-three_fiber"),
			);
		const { _roots } = await import(resource.name);
		const state = _roots.get(document.querySelector("canvas")).store.getState();
		state.setFrameloop("never");
		const { createCharacterMotion } = await import(
			"/src/scene/characterMotion.ts"
		);
		window.catReview = {
			state,
			update: createCharacterMotion(state.scene),
			time: 0,
		};
	});
	for (const seconds of [0, 8.6, 25.1, 45.5, 73.5, 77, 102.9, 106]) {
		const positions = await page.evaluate((seconds) => {
			const { state, update } = window.catReview;
			let cats = update(0, true, true);
			while (window.catReview.time < seconds) {
				cats = update(1 / 60, true, true);
				window.catReview.time += 1 / 60;
			}
			cats.forEach((cat, i) => {
				const shadow = state.scene.getObjectByName(
					`prop_cat_contact_shadow_${i + 1}`,
				);
				shadow.position.set(
					cat.position.x,
					cat.shadowHeight + 0.003,
					cat.position.z,
				);
				shadow.material.opacity = cat.shadowOpacity;
			});
			const p = cats[seconds >= 100 ? 1 : 0].position;
			state.camera.position.set(p.x - 0.8, p.y + 0.65, p.z + 1.3);
			state.camera.lookAt(p.x, p.y + 0.13, p.z);
			state.camera.updateMatrixWorld();
			for (const subscriber of state.internal.subscribers) {
				if (subscriber.priority > 0) subscriber.ref.current(state, 0);
			}
			return cats.map((cat) => cat.position.toArray());
		}, seconds);
		await page.screenshot({ path: `${out}/cats-${seconds}.png` });
		console.log("Cat pose", seconds, positions);
	}
	for (const [label, width, height] of [
		["street", 1280, 800],
		["phone", 390, 844],
	]) {
		await page.setViewportSize({ width, height });
		await page.waitForTimeout(500);
		await page.evaluate(() => {
			const { state } = window.catReview;
			state.camera.position.set(0, 4.2, 14);
			state.camera.lookAt(0, 3, 0);
			state.camera.updateMatrixWorld();
			for (const subscriber of state.internal.subscribers) {
				if (subscriber.priority > 0) subscriber.ref.current(state, 0);
			}
		});
		await page.screenshot({ path: `${out}/cats-${label}.png` });
	}
	assert.deepEqual(errors, []);
	await browser.close();
	process.exit(0);
}

if (process.argv.includes("--tv-idle")) {
	// Interior of the TV in the fixed 1280 × 800 Street View: exclude the
	// glowing bezel, fans and characters so only the climber changes pixels.
	const clip = { x: 894, y: 218, width: 65, height: 127 };
	await page.waitForTimeout(2000);
	const poses = new Map();
	for (let i = 0; i < 8; i++) {
		const png = await page.screenshot({ clip });
		poses.set(png.toString("base64"), png);
		await page.waitForTimeout(350);
	}
	assert.ok(poses.size > 1, "idle TV must visibly animate after Entry");
	[...poses.values()].forEach((png, i) => {
		writeFileSync(`${out}/tv-idle-${i}.png`, png);
	});
	console.log("Visible idle TV poses:", poses.size);
	const reduced = await browser.newPage({
		viewport: { width: 1280, height: 800 },
		reducedMotion: "reduce",
	});
	let requestedAtlas = false;
	reduced.on("request", (request) => {
		if (request.url().includes("tv-bouldering-loop")) requestedAtlas = true;
	});
	await reduced.goto(base);
	await reduced.getByRole("button", { name: "Open the shop" }).click();
	await reduced.waitForTimeout(3000);
	const still = await reduced.screenshot({ clip });
	await reduced.waitForTimeout(1500);
	assert.deepEqual(await reduced.screenshot({ clip }), still);
	assert.equal(requestedAtlas, false, "reduced motion does not load the atlas");
	console.log("Reduced motion: unchanged TV pixels; no animation download");
	await reduced.close();
}

for (const label of process.argv.includes("--tv-only")
	? []
	: ["About", "Projects", "Resume", "Contact", "Credits"]) {
	await page.getByRole("button", { name: label, exact: true }).click();
	await page.waitForTimeout(1800);
	await page.screenshot({ path: `${out}/${label.toLowerCase()}.png` });
}

await expect(page.locator(".station-menu")).not.toContainText("BetaByJ");
await expect(page.locator('script[src*="youtube.com/iframe_api"]')).toHaveCount(
	0,
);
await page.getByRole("button", { name: "About", exact: true }).click();
await page.waitForTimeout(1800);
await page
	.getByRole("button", { name: "Watch BetaByJ Shorts on the TV", exact: true })
	.focus();
await page.keyboard.press("Enter");
await page.waitForTimeout(8000);
await page.screenshot({ path: `${out}/shorts.png` });
console.log("TV:", await page.locator(".tv-status").textContent());
console.log("TV frame:", await page.locator(".tv-surface").boundingBox());
const playerFrame = page
	.frames()
	.find((frame) => frame.url().includes("youtube.com/embed"));
if (playerFrame)
	console.log(
		"Playback:",
		await playerFrame.evaluate(() => {
			const video = document.querySelector("video");
			return video
				? {
						seconds: video.currentTime,
						paused: video.paused,
						muted: video.muted,
						readyState: video.readyState,
					}
				: "YouTube has not supplied a video element";
		}),
	);
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(2000);
await page.screenshot({ path: `${out}/shorts-phone.png` });
await page.getByRole("button", { name: "Close TV", exact: true }).click();
await expect(page.locator("#about")).not.toHaveAttribute("aria-hidden", "true");
await expect(
	page.getByRole("button", {
		name: "Watch BetaByJ Shorts on the TV",
		exact: true,
	}),
).toBeFocused();
console.log(
	"TV frames after close:",
	await page.locator(".tv-player iframe").count(),
);

console.log("errors:", errors.length ? errors : "none");
await browser.close();
