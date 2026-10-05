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

test("walking arms hang beside the torso rather than folding across the chest", () => {
	const root = rig();
	const visits = createCustomerVisits(root, () => 0);
	const point = new Vector3();
	for (let i = 0; i < 90 * 60; i++) {
		const state = visits.update(1 / 60, true, true, []);
		if (state.walking < 0.9) continue;
		const travel = root.getObjectByName(
			`rig_prop_customer_${state.variant + 1}_travel`,
		);
		for (const [side, sign] of [
			["left", -1],
			["right", 1],
		]) {
			const prefix = `rig_prop_customer_${state.variant + 1}_${side}`;
			root.getObjectByName(`${prefix}_lower`).getWorldPosition(point);
			travel.worldToLocal(point);
			assert.ok(
				sign * point.x >= 0.18 && sign * point.x < 0.3 && point.y < 0.96,
				`${side} elbow folds into the torso: ${point.toArray().map((v) => v.toFixed(3))}`,
			);
			root.getObjectByName(`${prefix}_hand`).getWorldPosition(point);
			travel.worldToLocal(point);
			assert.ok(
				point.y < 0.58,
				`${side} walking hand is raised to ${point.y.toFixed(3)}m`,
			);
		}
	}
});

test("customers face their walking direction even around cats", () => {
	const root = rig();
	const characters = createCharacterMotion(root);
	const visits = createCustomerVisits(root, () => 0);
	const forward = new Vector3();
	const previous = new Vector3();
	const displacement = new Vector3();
	let previousPhase = "quiet";
	for (let i = 0; i < 180 * 60; i++) {
		const cats = characters(1 / 60, true, true, visits.needsSidewalk);
		const state = visits.update(1 / 60, true, true, cats);
		const travel = root.getObjectByName(
			`rig_prop_customer_${state.variant + 1}_travel`,
		);
		displacement.subVectors(travel.position, previous).setY(0);
		if (
			state.phase === previousPhase &&
			["approach", "leave"].includes(state.phase) &&
			displacement.length() > 0.001
		) {
			forward
				.set(0, 0, 1)
				.applyQuaternion(travel.quaternion)
				.setY(0)
				.normalize();
			assert.ok(
				forward.dot(displacement.normalize()) > 0.94,
				`${state.phase}: customer is moving sideways at ${travel.position.toArray()}`,
			);
		}
		previous.copy(travel.position);
		previousPhase = state.phase;
	}
});

test("Entry and Street View gate arrivals; quiet gaps and two regulars repeat", () => {
	for (const random of [0, 0.5, 1]) {
		const schedule = createVisitSchedule(() => random);
		assert.equal(advance(schedule, 100, false).phase, "quiet");
		assert.equal(advance(schedule, 100, true, false).phase, "quiet");
		assert.equal(advance(schedule, 4.9).phase, "quiet");
		assert.equal(advance(schedule, 0.2).phase, "approach");
		const phases = new Set();
		let visitSeconds = 0;
		for (let i = 0; i < 80 * 60 && schedule.state.phase !== "quiet"; i++) {
			phases.add(schedule.state.phase);
			schedule.update(1 / 60, true, true, []);
			visitSeconds += 1 / 60;
		}
		assert.equal(schedule.state.phase, "quiet");
		assert.ok(
			visitSeconds > 65 && visitSeconds < 75,
			"an unhurried visit lasts about 70 seconds",
		);
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
	for (const phase of [
		"approach",
		"sit",
		"greet",
		"cup",
		"cookie",
		"enjoy",
		"return",
		"goodbye",
		"stand",
		"leave",
	]) {
		const schedule = createVisitSchedule(() => 0.5);
		for (let i = 0; i < 80 * 60 && schedule.state.phase !== phase; i++)
			schedule.update(1 / 60, true, true, []);
		assert.equal(schedule.state.phase, phase);
		assert.equal(advance(schedule, 90, true, false).phase, "quiet");
		assert.equal(advance(schedule, 20).phase, "quiet");
		assert.equal(advance(schedule, 3).phase, "approach");
	}
});

test("customers wait offscreen for cats to clear, including when a Section opens", () => {
	const schedule = createVisitSchedule(() => 0);
	const cat = { position: new Vector3(-2, 0, 2.3), resting: true };
	assert.equal(advance(schedule, 9, true, true, [cat]).phase, "quiet");
	assert.ok(schedule.needsSidewalk);
	cat.position.x = 0.05;
	assert.equal(advance(schedule, 10, true, false, [cat]).phase, "quiet");
	assert.equal(
		schedule.needsSidewalk,
		false,
		"do not reserve a path for an arrival while reading",
	);
	assert.equal(advance(schedule, 0.1, true, true, [cat]).phase, "approach");
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
	for (let i = 0; i < 180 * 60; i++) {
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
	for (let i = 0; i < 70 * 60; i++) {
		visits.update(1 / 60, true, true, []);
		if (visits.state.phase === "enjoy" && visits.state.time >= 4) break;
	}
	assert.equal(visits.state.phase, "enjoy");
	const cup = root.getObjectByName("rig_service_cup");
	const rim = new Vector3(0, 0.065, 0).applyQuaternion(cup.quaternion);
	assert.ok(
		rim.z > 0.025,
		"the rim moves back toward the seated customer's face",
	);
	assert.equal(root.getObjectByName("rig_service_milk").visible, true);
	for (let i = 0; i < 20 * 60 && visits.state.phase !== "return"; i++)
		visits.update(1 / 60, true, true, []);
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
		const cats = characters(1 / 60, true, street, visits.needsSidewalk);
		const state = visits.update(1 / 60, true, street, cats, "light");
		if (state.walking > 0 && ["approach", "leave"].includes(state.phase)) {
			assert.ok(
				!cats.some((cat) => cat.blocksSidewalk),
				"customers and cats take turns on the sidewalk",
			);
		}
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
		minDistance > 0.35,
		`cat/customer centers approached to ${minDistance}m`,
	);
});
