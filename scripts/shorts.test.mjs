// Deterministic player lifecycle checks against the running app. YouTube's
// network and playback policies are exercised separately by shot.mjs.
// Run: node --test scripts/shorts.test.mjs (SHORTS_TEST_URL overrides the URL).
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { chromium, expect } from "@playwright/test";

let browser;
before(async () => {
	browser = await chromium.launch();
});
after(async () => {
	await browser?.close();
});

async function setup(
	t,
	{ reducedMotion = "no-preference", delayed = false } = {},
) {
	const page = await browser.newPage({
		viewport: { width: 1280, height: 1000 },
		reducedMotion,
	});
	const errors = [];
	page.on("pageerror", (error) => errors.push(error.message));
	t.after(async () => {
		await page.close();
		assert.deepEqual(errors, []);
	});
	await page.addInitScript(
		({ delayed }) => {
			const original = HTMLCanvasElement.prototype.getContext;
			HTMLCanvasElement.prototype.getContext = function (type, ...args) {
				if (type.startsWith("webgl")) return null;
				return original.call(this, type, ...args);
			};
			window.players = [];
			window.videoIds = ["first", "second", "third"];
			window.installYouTube = () => {
				window.YT = {
					Player: class {
						constructor(mount, options) {
							this.options = options;
							this.events = options.events;
							this.index = 0;
							this.seconds = 0;
							this.muted = false;
							this.state = -1;
							this.calls = [];
							this.iframe = document.createElement("iframe");
							mount.replaceWith(this.iframe);
							window.players.push(this);
							setTimeout(() => this.events.onReady({ target: this }), 30);
						}
						emit(state) {
							this.state = state;
							this.events.onStateChange({ target: this, data: state });
						}
						playVideo() {
							this.calls.push("play");
							this.emit(1);
						}
						pauseVideo() {
							this.calls.push("pause");
							this.emit(2);
						}
						mute() {
							this.muted = true;
						}
						unMute() {
							this.muted = false;
						}
						isMuted() {
							return this.muted;
						}
						getVolume() {
							return 80;
						}
						getPlayerState() {
							return this.state;
						}
						getCurrentTime() {
							return this.seconds;
						}
						getPlaylistIndex() {
							return this.index;
						}
						getPlaylist() {
							return window.videoIds;
						}
						getVideoData() {
							return this.state === -1
								? undefined
								: { video_id: window.videoIds[this.index] };
						}
						cuePlaylist(options) {
							this.calls.push("cue");
							this.index = options.index;
							this.seconds = options.startSeconds;
							setTimeout(() => this.emit(5), 10);
						}
						loadPlaylist(options) {
							this.calls.push("load");
							this.index = options.index;
							this.seconds = options.startSeconds;
							setTimeout(() => this.emit(1), 10);
						}
						setLoop(value) {
							this.loop = value;
						}
						setShuffle(value) {
							this.shuffle = value;
						}
						nextVideo() {
							if (this.index < window.videoIds.length - 1) {
								this.index++;
								this.seconds = 0;
								this.emit(1);
							}
						}
						previousVideo() {
							if (this.index > 0) {
								this.index--;
								this.seconds = 0;
								this.emit(1);
							}
						}
						destroy() {
							this.destroyed = true;
							this.state = -1;
							this.iframe.remove();
						}
					},
				};
			};
			if (!delayed) window.installYouTube();
		},
		{ delayed },
	);
	if (delayed)
		await page.route("https://www.youtube.com/iframe_api", (route) =>
			route.fulfill({ contentType: "text/javascript", body: "" }),
		);
	await page.goto(process.env.SHORTS_TEST_URL ?? "http://127.0.0.1:5174");
	return page;
}

async function open(page) {
	await page.getByRole("button", { name: "Watch Shorts", exact: true }).click();
	await expect(
		page.getByRole("button", { name: "Enable sound" }),
	).toBeEnabled();
	await page.locator(".tv-surface").scrollIntoViewIfNeeded();
}

test("discovery is lazy; sound ducks audio; closing destroys playback and restores volume", async (t) => {
	const page = await setup(t);
	assert.equal(await page.evaluate(() => window.players.length), 0);
	assert.equal(
		await page.locator('script[src*="youtube.com/iframe_api"]').count(),
		0,
	);
	await page.evaluate(() => {
		const audio = document.createElement("audio");
		audio.dataset.creameryAudio = "";
		audio.volume = 0.6;
		document.body.append(audio);
	});
	await open(page);
	assert.equal(await page.evaluate(() => window.players[0].muted), true);
	assert.equal(await page.evaluate(() => window.players[0].loop), false);
	await page.evaluate(() => window.players[0].playVideo());
	await page.getByRole("button", { name: "Enable sound" }).click();
	await expect
		.poll(() => page.evaluate(() => document.querySelector("audio").volume))
		.toBe(0.12);
	await page.getByRole("button", { name: "Close TV" }).click();
	await expect(page.locator(".tv-player iframe")).toHaveCount(0);
	assert.equal(await page.evaluate(() => window.players[0].destroyed), true);
	await expect
		.poll(() => page.evaluate(() => document.querySelector("audio").volume))
		.toBe(0.6);
});

test("reopening resumes by video ID and position, even after playlist reordering, muted", async (t) => {
	const page = await setup(t);
	await open(page);
	await page.evaluate(() => {
		const p = window.players[0];
		p.index = 1;
		p.seconds = 27.5;
		p.unMute();
		p.emit(2);
	});
	await page.getByRole("button", { name: "Close TV" }).click();
	await page.evaluate(() => {
		window.videoIds = ["new", "first", "second", "third"];
	});
	await open(page);
	assert.deepEqual(
		await page.evaluate(() => {
			const p = window.players.at(-1);
			return [p.index, p.seconds, p.muted];
		}),
		[2, 27.5, true],
	);
});

test("reduced motion cues without autoplay and still allows explicit Play", async (t) => {
	const page = await setup(t, { reducedMotion: "reduce" });
	await open(page);
	assert.equal(
		await page.evaluate(() => window.players[0].calls.includes("load")),
		false,
	);
	await expect(
		page.getByRole("button", { name: "Play", exact: true }),
	).toBeEnabled();
	await page.getByRole("button", { name: "Play", exact: true }).click();
	assert.equal(
		await page.evaluate(() => window.players[0].calls.includes("play")),
		true,
	);
});

test("blocked autoplay, unavailable Shorts and the playlist end remain recoverable", async (t) => {
	const page = await setup(t);
	await open(page);
	await page.evaluate(() => window.players[0].events.onAutoplayBlocked());
	await expect(page.getByRole("status")).toHaveText(
		"Press Play to start the Short.",
	);
	await page.evaluate(() => window.players[0].events.onError({ data: 150 }));
	await expect(page.getByRole("status")).toContainText("Try the next one");
	await page.getByRole("button", { name: "Next", exact: true }).click();
	await expect(page.locator(".tv-caption")).toHaveText("SHORT 2 / 3");
	await page.evaluate(() => {
		window.players[0].index = 2;
		window.players[0].emit(0);
	});
	await expect(page.getByRole("status")).toContainText("end of the playlist");
	await expect(
		page.getByRole("button", { name: "Next", exact: true }),
	).toBeDisabled();
	assert.equal(await page.evaluate(() => window.players[0].index), 2);
});

test("closing while the API loads cannot create a background player", async (t) => {
	const page = await setup(t, { delayed: true });
	await page.getByRole("button", { name: "Watch Shorts", exact: true }).click();
	await expect(
		page.locator('script[src*="youtube.com/iframe_api"]'),
	).toHaveCount(1);
	await page.getByRole("button", { name: "Close TV" }).click();
	await page.evaluate(() => {
		window.installYouTube();
		window.onYouTubeIframeAPIReady();
	});
	assert.equal(await page.evaluate(() => window.players.length), 0);
	await open(page);
	assert.equal(await page.evaluate(() => window.players.length), 1);
});
