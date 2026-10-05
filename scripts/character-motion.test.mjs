// Checks the exported pivot contract and animation against the shipped GLB.
// Run: node --test scripts/character-motion.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { Object3D, Vector3 } from "three";
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
	const head = root.getObjectByName("rig_barista_head");
	assert.equal(head.parent.name, "rig_barista_body");
	assert.ok(Math.abs(head.getWorldPosition(new Vector3()).y - 1.71) < 1e-5);
	for (const id of [1, 2]) {
		for (const part of [
			"front_left",
			"front_right",
			"hind_left",
			"hind_right",
		]) {
			const prefix = `rig_prop_cat_${id}_${part}`;
			assert.equal(
				root.getObjectByName(`${prefix}_paw`).parent.name,
				`${prefix}_lower`,
			);
			assert.equal(root.getObjectByName(`${prefix}_lower`).parent.name, prefix);
		}
	}
});

test("the barista keeps small anchored gestures and restores its pose when motion is off", () => {
	const root = characterRig();
	const joints = expected
		.filter((name) => name.includes("barista"))
		.map((name) => root.getObjectByName(name));
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
		joints.length,
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

test("opening a Section during walking, hopping, or chasing settles without teleporting", () => {
	for (const at of [8.5, 26.4, 27, 46, 62, 70, 73, 77]) {
		const root = characterRig();
		const update = createCharacterMotion(root);
		const cats = [1, 2].map((id) =>
			root.getObjectByName(`rig_prop_cat_${id}_travel`),
		);
		advance(update, at);
		const previous = cats.map((cat) => cat.position.clone());
		advance(update, 12, false, () => {
			cats.forEach((cat, i) => {
				assert.ok(
					cat.position.distanceTo(previous[i]) < 0.07,
					`teleport after opening at ${at}s`,
				);
				previous[i].copy(cat.position);
			});
		});
		const transforms = () => {
			root.updateMatrixWorld(true);
			return cats.flatMap((cat) => {
				const result = [];
				cat.traverse((joint) => result.push(joint.matrixWorld.toArray()));
				return result;
			});
		};
		const settled = transforms();
		advance(update, 120, false);
		assert.deepEqual(
			transforms(),
			settled,
			`cats should stay settled while reading (${at}s)`,
		);
		assert.equal(root.getObjectByName("rig_prop_mouse").visible, false);
		for (const cat of cats)
			assert.ok(
				[0, 0.59, 0.99].some(
					(height) => Math.abs(cat.position.y - height) < 1e-5,
				),
			);
		advance(update, 30);
		assert.notDeepEqual(
			transforms(),
			settled,
			"activity resumes in Street View",
		);
	}
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

for (const id of [1, 2])
	for (const fps of [30, 60])
		test(`cat ${id} anchors its supporting paws at ${fps} fps`, () => {
			const root = characterRig();
			const update = createCharacterMotion(root);
			const names = ["front_left", "front_right", "hind_left", "hind_right"];
			const previous = names.map(() => new Vector3());
			const point = new Vector3();
			let checked = 0;
			let previousHeight = -1;
			let elapsed = 0;
			advance(
				update,
				180,
				true,
				() => {
					elapsed += 1 / fps;
					const travel = root.getObjectByName(`rig_prop_cat_${id}_travel`);
					const walking =
						root.getObjectByName(`rig_prop_cat_${id}_body`).rotation.x > 0.9;
					const onSurface = [0, 0.59, 0.99].some(
						(y) => Math.abs(travel.position.y - y) < 1e-6,
					);
					let contacts = 0;
					names.forEach((name, i) => {
						root
							.getObjectByName(`rig_prop_cat_${id}_${name}_paw`)
							.getWorldPosition(point);
						const ankle = travel.position.y + (i < 2 ? 0.018 : 0.019);
						if (
							walking &&
							onSurface &&
							Math.abs(previousHeight - travel.position.y) < 1e-6 &&
							Math.abs(point.y - ankle) < 0.0001
						) {
							contacts++;
							if (Math.abs(previous[i].y - ankle) < 0.0001) {
								assert.ok(
									point.distanceTo(previous[i]) < 0.002,
									`${name} slid ${point.distanceTo(previous[i])}m at ${elapsed}s: ${previous[i].toArray()} -> ${point.toArray()}`,
								);
								checked++;
							}
						}
						previous[i].copy(point);
					});
					if (walking && onSurface && previousHeight === travel.position.y)
						assert.ok(
							contacts >= 1,
							`cat ${id} lost all paw contacts at ${elapsed}s`,
						);
					previousHeight = travel.position.y;
				},
				fps,
			);
			assert.ok(checked > 100);
		});

function advance(update, seconds, street = true, observe = () => {}, fps = 60) {
	for (let frame = 0; frame < Math.ceil(seconds * fps); frame++) {
		update(1 / fps, true, street);
		observe();
	}
}

test("Skadi starts exploring within ten seconds while Freya stays aloof", () => {
	const root = characterRig();
	const skadi = root.getObjectByName("rig_prop_cat_1_travel");
	const freya = root.getObjectByName("rig_prop_cat_2_travel");
	assert.ok(skadi && freya, "cats need whole-body travel pivots");
	const start = skadi.position.clone();
	const freyaStart = freya.position.clone();
	const update = createCharacterMotion(root);
	advance(update, 5);
	assert.ok(skadi.position.distanceTo(start) < 0.0001);
	advance(update, 5);
	assert.ok(skadi.position.distanceTo(start) > 0.1);
	assert.ok(freya.position.distanceTo(freyaStart) < 0.0001);
});

test("the rare chase gives the mouse a head start and an escape", () => {
	const root = characterRig();
	const update = createCharacterMotion(root);
	const mouse = root.getObjectByName("rig_prop_mouse");
	const skadi = root.getObjectByName("rig_prop_cat_1_travel");
	assert.equal(mouse.visible, false);
	let first = null;
	let appearances = 0;
	let previous = false;
	let time = 0;
	advance(update, 240, true, () => {
		time += 1 / 60;
		if (mouse.visible && !previous) {
			appearances++;
			first ??= time;
		}
		previous = mouse.visible;
		if (mouse.visible && mouse.position.z > 2.2 && skadi.position.y < 0.01) {
			assert.ok(
				mouse.position.distanceTo(skadi.position) > 0.15,
				`mouse must escape, not pass through Skadi at ${time}s: ${mouse.position.toArray()} / ${skadi.position.toArray()}`,
			);
		}
	});
	assert.ok(first >= 45 && first <= 90, `first chase at ${first}s`);
	assert.equal(appearances, 1, "several minutes between chases");
	assert.equal(mouse.visible, false);
});

test("reduced motion restores every cat joint and hides the mouse during any activity", () => {
	for (const at of [9, 27, 46, 73]) {
		const root = characterRig();
		const joints = [];
		root.traverse((object) => {
			if (object.name.startsWith("rig_prop_cat_")) joints.push(object);
		});
		const transforms = () =>
			joints.map((o) => [
				...o.position.toArray(),
				...o.quaternion.toArray(),
				...o.scale.toArray(),
			]);
		const rest = transforms();
		const update = createCharacterMotion(root);
		update(100, false);
		assert.deepEqual(transforms(), rest, "no motion before Entry");
		advance(update, at);
		assert.notDeepEqual(transforms(), rest);
		update(1 / 60, false);
		assert.deepEqual(transforms(), rest);
		assert.equal(root.getObjectByName("rig_prop_mouse").visible, false);
		update(100, false);
		assert.deepEqual(transforms(), rest);
	}
});

test("time spent reading does not advance the chase schedule", () => {
	const root = characterRig();
	const update = createCharacterMotion(root);
	const mouse = root.getObjectByName("rig_prop_mouse");
	advance(update, 3);
	advance(update, 300, false);
	advance(update, 40, true, () => assert.equal(mouse.visible, false));
	let seen = false;
	advance(update, 47, true, () => {
		seen ||= mouse.visible;
	});
	assert.ok(seen, "chase should still occur after enough Street View time");
});

for (const [id, name] of [
	[1, "Skadi"],
	[2, "Freya"],
]) {
	test(`${name}'s moving tail clears the body and trails behind it`, () => {
		const root = characterRig();
		const update = createCharacterMotion(root);
		const travel = root.getObjectByName(`rig_prop_cat_${id}_travel`);
		const tail = root.getObjectByName(`rig_prop_cat_${id}_tail`);
		const body = root.getObjectByName(`rig_prop_cat_${id}_body`);
		// Authored tail centerline landmarks from build.py, relative to its
		// exported Y-up pivot. Both coats use the same arc, mirrored for Freya.
		const side = id === 1 ? 1 : -1;
		const arc = [
			[0.075, -0.008, 0.017],
			[0.092, -0.021, 0.115],
			[0.05, -0.025, 0.173],
			[-0.02, -0.025, 0.187],
		];
		let checked = 0;
		advance(update, 110, true, () => {
			if (body.rotation.x < 0.05) return;
			root.updateMatrixWorld(true);
			for (const [x, y, z] of arc) {
				const point = tail.localToWorld(new Vector3(side * x, y, z));
				const inBody = body.worldToLocal(point.clone());
				// The haunch ellipsoid in body-local coordinates, including fur.
				const haunch =
					(inBody.x / (id === 1 ? 0.103 : 0.09)) ** 2 +
					((inBody.y + 0.021) / 0.069) ** 2 +
					((inBody.z + 0.013) / 0.082) ** 2;
				assert.ok(haunch > 1, `${name}'s tail passes inside its haunch`);
				// Check the outward sweep while rising/settling too. The seated
				// curl need only be behind the cat once it reaches its walking pose.
				if (body.rotation.x < 0.8) continue;
				const local = travel.worldToLocal(point);
				assert.ok(
					local.z < -0.075 || local.y > 0.25,
					`${name}'s moving tail must be behind or above its body: ${local.toArray()}`,
				);
				assert.ok(
					local.y >= (id === 1 ? 0.027 : 0.013),
					`${name}'s tail must clear the walking surface: ${local.y}`,
				);
			}
			checked++;
		});
		assert.ok(checked > 60, "exercise walking and hopping poses");
	});
}
