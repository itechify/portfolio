import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { Object3D, Vector3 } from "three";
import { createCharacterMotion } from "../src/scene/characterMotion.ts";
import {
	createCustomerVisits,
	createVisitSchedule,
} from "../src/scene/customerVisits.ts";

function rig() {
	const bytes = readFileSync(
		new URL("../public/models/creamery.glb", import.meta.url),
	);
	const gltf = JSON.parse(
		bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString(),
	);
	const objects = gltf.nodes.map((node) => {
		const o = new Object3D();
		o.name = node.name;
		if (node.translation) o.position.fromArray(node.translation);
		if (node.rotation) o.quaternion.fromArray(node.rotation);
		if (node.scale) o.scale.fromArray(node.scale);
		return o;
	});
	gltf.nodes.forEach((node, i) => {
		for (const child of node.children ?? []) objects[i].add(objects[child]);
	});
	const root = new Object3D();
	for (const index of gltf.scenes[gltf.scene].nodes) root.add(objects[index]);
	return root;
}

function advance(schedule, seconds, enabled = true, street = true, cats = []) {
	for (let i = 0; i < seconds * 60; i++)
		schedule.update(1 / 60, enabled, street, cats);
	return { ...schedule.state };
}

test("Entry and Street View gate arrivals; quiet gaps and two regulars repeat", () => {
	for (const random of [0, 0.5, 1]) {
		const schedule = createVisitSchedule(() => random);
		assert.equal(advance(schedule, 100, false).phase, "quiet");
		assert.equal(advance(schedule, 100, true, false).phase, "quiet");
		assert.equal(advance(schedule, 4.9).phase, "quiet");
		assert.equal(advance(schedule, 0.2).phase, "approach");
		const phases = new Set();
		for (let i = 0; i < 40 * 60 && schedule.state.phase !== "quiet"; i++) {
			phases.add(schedule.state.phase);
			schedule.update(1 / 60, true, true, []);
		}
		assert.equal(schedule.state.phase, "quiet");
		assert.equal(
			phases.size,
			10,
			"complete service, consumption and departure",
		);
		assert.equal(advance(schedule, 15 + random * 15 - 0.1).phase, "quiet");
		assert.equal(advance(schedule, 0.2).variant, 1);
	}
});

test("every active phase completes when a Section opens; no queued arrivals", () => {
	for (const at of [6, 12, 14, 16, 18, 21, 24, 27, 31]) {
		const schedule = createVisitSchedule(() => 0.5);
		advance(schedule, at);
		assert.equal(advance(schedule, 60, true, false).phase, "quiet");
		assert.equal(advance(schedule, 20).phase, "quiet");
		assert.equal(advance(schedule, 3).phase, "approach");
	}
});

test("customers yield into the curb lane, and pass a resting cat without deadlock", () => {
	const schedule = createVisitSchedule(() => 0);
	advance(schedule, 9);
	const x = schedule.state.x;
	const cat = { position: new Vector3(x + 0.6, 0, 2.3), resting: false };
	advance(schedule, 1, true, true, [cat]);
	assert.equal(schedule.state.x, x, "wait while the cat crosses");
	assert.ok(schedule.state.yield > 0.98, "step aside before the cat arrives");
	cat.resting = true;
	advance(schedule, 2, true, false, [cat]);
	assert.ok(
		schedule.state.x > x,
		"a cat that settles in a Section is passable",
	);
	assert.equal(advance(schedule, 90, true, false, [cat]).phase, "quiet");
});

test("suspended frames cannot jump a visit; disabling motion resets arrival timing", () => {
	const schedule = createVisitSchedule();
	advance(schedule, 8);
	const x = schedule.state.x;
	schedule.update(90, true, true, []);
	assert.ok(schedule.state.x - x <= 0.053);
	assert.equal(advance(schedule, 10, false).phase, "quiet");
	assert.equal(advance(schedule, 4).phase, "quiet");
});

test("exported rig performs continuous handoffs, with one visible customer and one cup", () => {
	const root = rig();
	const visits = createCustomerVisits(root, () => 0);
	const cup = root.getObjectByName("rig_service_cup");
	const cookie = root.getObjectByName("rig_service_cookie");
	const previousCup = new Vector3();
	let previousCupRotation;
	const previousCookie = new Vector3();
	let maxCupStep = 0;
	let maxCookieStep = 0;
	let previousPhase = "quiet";
	let previousRotation;
	let previousVariant = 0;
	for (let i = 0; i < 90 * 60; i++) {
		const state = visits.update(1 / 60, true, true, [], "full");
		root.updateMatrixWorld(true);
		const visible = [1, 2].filter(
			(id) => root.getObjectByName(`rig_prop_customer_${id}_travel`).visible,
		);
		assert.equal(visible.length, state.phase === "quiet" ? 0 : 1);
		const rotation = root.getObjectByName(
			`rig_prop_customer_${state.variant + 1}_travel`,
		).quaternion;
		if (
			previousRotation &&
			state.variant === previousVariant &&
			state.phase !== "quiet" &&
			previousPhase !== "quiet"
		) {
			assert.ok(
				rotation.angleTo(previousRotation) < 0.25,
				"turn continuously when sitting and leaving",
			);
		}
		previousRotation = rotation.clone();
		previousVariant = state.variant;
		if (i > 0) {
			assert.ok(
				cup.quaternion.angleTo(previousCupRotation) < 0.15,
				"handing over the cup must not spin it",
			);
			maxCupStep = Math.max(maxCupStep, cup.position.distanceTo(previousCup));
			if (
				cookie.visible &&
				["cup", "cookie", "enjoy"].includes(state.phase) &&
				previousPhase !== "quiet"
			) {
				maxCookieStep = Math.max(
					maxCookieStep,
					cookie.position.distanceTo(previousCookie),
				);
			}
		}
		previousCup.copy(cup.position);
		previousCupRotation = cup.quaternion.clone();
		previousCookie.copy(cookie.position);
		previousPhase = state.phase;
		assert.ok(cup.position.toArray().every(Number.isFinite));
	}
	assert.ok(maxCupStep < 0.025, `cup jumped ${maxCupStep}m`);
	assert.ok(maxCookieStep < 0.025, `cookie jumped ${maxCookieStep}m`);
});

test("reduced motion is one seated regular with food and an invariant pose on every tier", () => {
	for (const tier of ["full", "balanced", "light"]) {
		const root = rig();
		const visits = createCustomerVisits(root);
		for (let i = 0; i < 20 * 60; i++)
			visits.update(1 / 60, true, true, [], tier);
		visits.update(0, false, true, [], tier);
		const customer = root.getObjectByName("rig_prop_customer_1_travel");
		assert.ok(customer.visible);
		assert.equal(
			root.getObjectByName("rig_prop_customer_2_travel").visible,
			false,
		);
		assert.deepEqual(customer.position.toArray(), [-0.95, 0, 1.9]);
		const snapshot = () => {
			const result = [];
			root.traverse((o) =>
				result.push([...o.position, ...o.quaternion, ...o.scale, o.visible]),
			);
			return result;
		};
		const before = snapshot();
		for (let i = 0; i < 300; i++) visits.update(1 / 60, false, false, [], tier);
		assert.deepEqual(snapshot(), before);
		assert.equal(visits.shadow.shadowOpacity > 0, tier !== "light");
	}
});

test("the sip tips the open rim toward the mouth and leaves an empty cup for return", () => {
	const root = rig();
	const visits = createCustomerVisits(root);
	for (let i = 0; i < 30 * 60; i++) {
		visits.update(1 / 60, true, true, []);
		if (visits.state.phase === "enjoy" && visits.state.time >= 1) break;
	}
	const cup = root.getObjectByName("rig_service_cup");
	const rim = new Vector3(0, 0.065, 0).applyQuaternion(cup.quaternion);
	assert.ok(
		rim.z > 0.025,
		"the rim moves back toward the seated customer's face",
	);
	assert.equal(root.getObjectByName("rig_service_milk").visible, true);
	for (let i = 0; i < 4.5 * 60; i++) visits.update(1 / 60, true, true, []);
	assert.equal(visits.state.phase, "return");
	assert.equal(root.getObjectByName("rig_service_milk").visible, false);
});

test("actual cat routes and customer visits coexist for ten minutes, including Section changes", () => {
	const root = rig();
	const characters = createCharacterMotion(root);
	const visits = createCustomerVisits(root, () => 0);
	const seen = new Set();
	let longestVisit = 0;
	let active = 0;
	let minDistance = Infinity;
	for (let i = 0; i < 600 * 60; i++) {
		const street = i % (100 * 60) < 65 * 60;
		const cats = characters(1 / 60, true, street);
		const state = visits.update(1 / 60, true, street, cats, "light");
		if (state.phase === "quiet") active = 0;
		else {
			active += 1 / 60;
			longestVisit = Math.max(longestVisit, active);
			seen.add(state.variant);
			const robot = visits.shadow.position;
			for (const cat of cats) {
				if (cat.position.y < 0.35) {
					minDistance = Math.min(
						minDistance,
						Math.hypot(robot.x - cat.position.x, robot.z - cat.position.z),
					);
				}
			}
		}
	}
	assert.equal(seen.size, 2);
	assert.ok(longestVisit < 90, `visit stalled for ${longestVisit}s`);
	assert.ok(
		minDistance > 0.23,
		`cat/customer centers approached to ${minDistance}m`,
	);
});
