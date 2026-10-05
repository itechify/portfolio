import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createQualityMonitor } from "../src/scene/quality.ts";
import { createTrafficMotion } from "../src/scene/trafficMotion.ts";

function advance(update, seconds, motion = true, street = true) {
	let state;
	for (let i = 0; i < seconds * 60; i++) state = update(1 / 60, motion, street);
	return { ...state };
}

test("traffic waits for Entry, Street View, and a full quiet gap", () => {
	const update = createTrafficMotion(() => 0);
	assert.equal(advance(update, 90, false).active, false);
	assert.equal(advance(update, 90, true, false).active, false);
	assert.equal(advance(update, 19).active, false);
	assert.equal(advance(update, 2).active, true);
});

test("a car clears while reading a Section, without queuing arrivals", () => {
	const update = createTrafficMotion(() => 0.5);
	const first = advance(update, 31);
	assert.equal(first.active, true);
	assert.ok(advance(update, 1, true, false).x > first.x);
	assert.equal(advance(update, 60, true, false).active, false);
	assert.equal(advance(update, 29).active, false);
	assert.equal(advance(update, 2).active, true);
});

test("reduced motion cancels the crossing and restores a quiet gap", () => {
	const update = createTrafficMotion(() => 0);
	assert.equal(advance(update, 21).active, true);
	assert.equal(update(0, false, true).active, false);
	assert.equal(advance(update, 19).active, false);
	assert.equal(advance(update, 2).active, true);
});

test("cars travel smoothly; a stalled frame cannot jump the road", () => {
	const update = createTrafficMotion(() => 0);
	const before = advance(update, 21);
	const after = { ...update(90, true, true) };
	assert.ok(after.x > before.x && after.x - before.x <= 0.4);
	assert.ok(after.distance > before.distance);
	assert.equal(advance(update, 20).active, false);
});

test("all quiet intervals stay within 20–40 seconds", () => {
	for (const value of [0, 0.5, 1]) {
		const update = createTrafficMotion(() => value);
		assert.equal(advance(update, 19).active, false);
		const gap = 20 + value * 20;
		assert.equal(advance(update, gap - 19 + 0.1).active, true);
	}
});

test("shipped car has independently turning wheels and compact portable atlases", () => {
	const bytes = readFileSync(
		new URL("../public/models/traffic-car.glb", import.meta.url),
	);
	const gltf = JSON.parse(
		bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString(),
	);
	assert.ok(bytes.length < 200_000, "keep the optional car download small");
	assert.ok(gltf.nodes.some((n) => n.name === "rig_traffic_car"));
	for (let i = 0; i < 4; i++) {
		const wheel = gltf.nodes.find((n) => n.name === `rig_traffic_wheel_${i}`);
		assert.ok(wheel?.children?.length);
		assert.ok(Math.abs(wheel.translation[1] - 0.24) < 1e-5, "Y-up axle height");
		assert.ok(
			!wheel.rotation || Math.abs(wheel.rotation[3] - 1) < 1e-5,
			"local Z axle",
		);
	}
	assert.ok(gltf.materials.some((m) => m.name === "baked_car_paint"));
	assert.ok(gltf.materials.some((m) => m.name === "baked_car_detail"));
	assert.ok(!gltf.extensionsUsed?.includes("KHR_lights_punctual"));
});

test("Quality Tiers step down after sustained low frame rate, not one slow frame", () => {
	const healthy = createQualityMonitor();
	for (let i = 0; i < 1200; i++) assert.equal(healthy(1 / 60, "full"), "full");
	assert.equal(healthy(0.4, "full"), "full");
	const slow = createQualityMonitor();
	let tier = "full";
	for (let i = 0; i < 240; i++) tier = slow(1 / 30, tier);
	assert.equal(tier, "balanced");
	for (let i = 0; i < 240; i++) tier = slow(1 / 30, tier);
	assert.equal(tier, "light");
});
