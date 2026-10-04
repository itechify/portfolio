// Checks the exported pivot contract and animation against the shipped GLB.
// Run: node --test scripts/character-motion.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { Object3D } from "three";
import { createCharacterMotion } from "../src/scene/characterMotion.ts";

function characterRig() {
	const bytes = readFileSync(
		new URL("../public/models/creamery.glb", import.meta.url),
	);
	const gltf = JSON.parse(
		bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString(),
	);
	const nodes = gltf.nodes.map((node) => {
		const object = new Object3D();
		object.name = node.name;
		if (node.translation) object.position.fromArray(node.translation);
		if (node.rotation) object.quaternion.fromArray(node.rotation);
		if (node.scale) object.scale.fromArray(node.scale);
		return object;
	});
	gltf.nodes.forEach((node, i) => {
		for (const child of node.children ?? []) nodes[i].add(nodes[child]);
	});
	const root = new Object3D();
	for (const i of gltf.scenes[gltf.scene].nodes) root.add(nodes[i]);
	return root;
}

const expected = [
	"barista_head",
	"barista_eyes",
	"barista_cup",
	"barista_tray",
	...[1, 2].flatMap((id) =>
		["body", "head", "eyes", "tail"].map((part) => `prop_cat_${id}_${part}`),
	),
].map((name) => `rig_${name}`);

test("shipped model preserves articulated pivots, hierarchy and Y-up axes", () => {
	const root = characterRig();
	for (const name of expected) {
		const joint = root.getObjectByName(name);
		assert.ok(joint, `Missing exported pivot: ${name}`);
		assert.ok(joint.children.length, `Empty pivot: ${name}`);
		assert.ok(
			joint.quaternion.angleTo(new Object3D().quaternion) < 1e-5,
			`${name}: unexpected local axes`,
		);
	}
	for (const prefix of ["barista", "prop_cat_1", "prop_cat_2"]) {
		assert.equal(
			root.getObjectByName(`rig_${prefix}_eyes`).parent.name,
			`rig_${prefix}_head`,
		);
	}
	assert.ok(
		Math.abs(root.getObjectByName("rig_barista_head").position.y - 1.71) < 1e-5,
	);
});

test("characters move independently, stay anchored, and restore their pose when motion is off", () => {
	const root = characterRig();
	const joints = expected.map((name) => root.getObjectByName(name));
	const rest = joints.map((joint) => ({
		position: joint.position.clone(),
		rotation: joint.quaternion.clone(),
		scale: joint.scale.clone(),
	}));
	const update = createCharacterMotion(root);
	const changed = new Set();
	update(10, false);
	for (let frame = 0; frame < 1200; frame++) {
		update(1 / 60, true);
		joints.forEach((joint, i) => {
			assert.deepEqual(
				joint.position.toArray(),
				rest[i].position.toArray(),
				"pivot drift",
			);
			assert.ok(
				joint.quaternion.angleTo(rest[i].rotation) < 0.3,
				"gesture exceeded its small baked-lighting range",
			);
			if (
				joint.quaternion.angleTo(rest[i].rotation) > 0.001 ||
				joint.scale.distanceTo(rest[i].scale) > 0.001
			)
				changed.add(joint.name);
		});
	}
	assert.equal(
		changed.size,
		expected.length,
		"every intended pivot should animate",
	);
	assert.notEqual(
		root.getObjectByName("rig_prop_cat_1_body").scale.y,
		root.getObjectByName("rig_prop_cat_2_body").scale.y,
	);
	update(1 / 60, false);
	update(100, false);
	joints.forEach((joint, i) => {
		assert.ok(joint.quaternion.angleTo(rest[i].rotation) < 1e-7);
		assert.deepEqual(joint.scale.toArray(), rest[i].scale.toArray());
	});
});

test("a long suspended frame resumes gently", () => {
	const rootA = characterRig();
	const rootB = characterRig();
	createCharacterMotion(rootA)(300, true);
	createCharacterMotion(rootB)(0.05, true);
	for (const name of expected) {
		assert.deepEqual(
			rootA.getObjectByName(name).rotation.toArray(),
			rootB.getObjectByName(name).rotation.toArray(),
		);
		assert.deepEqual(
			rootA.getObjectByName(name).scale.toArray(),
			rootB.getObjectByName(name).scale.toArray(),
		);
	}
});
