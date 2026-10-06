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
		const mesh = gltf.meshes?.[node.mesh];
		if (mesh?.extras?.targetNames) {
			object.morphTargetDictionary = Object.fromEntries(
				mesh.extras.targetNames.map((name, i) => [name, i]),
			);
			object.morphTargetInfluences = [...mesh.weights];
		}
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

test("the cats export continuous torso and tail coats with reversible deformation", () => {
	const root = characterRig();
	const update = createCharacterMotion(root);
	const coats = [1, 2].flatMap((id) => {
		assert.equal(
			root.getObjectByName(`rig_prop_cat_${id}_haunch_detail`),
			undefined,
		);
		assert.equal(
			root.getObjectByName(`rig_prop_cat_${id}_tail_end_detail`),
			undefined,
		);
		return ["body", "tail"].map((part) => {
			const coat = root.getObjectByName(`rig_prop_cat_${id}_${part}_detail`);
			assert.deepEqual(Object.keys(coat.morphTargetDictionary), [
				part === "body" ? "standing" : "sway",
			]);
			assert.deepEqual(coat.morphTargetInfluences, [0]);
			return coat;
		});
	});
	advance(update, 9.2);
	assert.ok(
		coats[0].morphTargetInfluences[0] > 0.99,
		"standing deforms the coat, not just the joints",
	);
	update(0, false);
	for (const coat of coats) assert.deepEqual(coat.morphTargetInfluences, [0]);
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

for (const id of [1, 2]) {
	test(`cat ${id} walks with its shoulders under the neck and a level back`, () => {
		const root = characterRig();
		const update = createCharacterMotion(root);
		const joint = (part) => root.getObjectByName(`rig_prop_cat_${id}_${part}`);
		const travel = joint("travel");
		const previous = travel.position.clone();
		let checked = 0;
		advance(update, 54, true, () => {
			const distance = travel.position.distanceTo(previous);
			previous.copy(travel.position);
			if (
				distance < 1e-5 ||
				Math.abs(travel.position.y - 0.99) > 1e-6 ||
				joint("body").rotation.x < 0.94
			)
				return;
			root.updateMatrixWorld(true);
			const neck = travel.worldToLocal(
				joint("head").getWorldPosition(new Vector3()),
			);
			const shoulder = travel.worldToLocal(
				joint("front_left").getWorldPosition(new Vector3()),
			);
			const rear = travel.worldToLocal(
				joint("haunch").getWorldPosition(new Vector3()),
			);
			assert.ok(
				shoulder.z < neck.z,
				`front legs are ahead of the neck: ${shoulder.z} / ${neck.z}`,
			);
			assert.ok(
				rear.y > neck.y - 0.025,
				`hindquarters sag below the neck: ${rear.y} / ${neck.y}`,
			);
			checked++;
		});
		assert.ok(checked > 30);
	});
	test(`cat ${id} staggers paw lifts during its slow walk`, () => {
		const root = characterRig();
		const update = createCharacterMotion(root);
		const travel = root.getObjectByName(`rig_prop_cat_${id}_travel`);
		const paws = ["front_left", "front_right", "hind_left", "hind_right"].map(
			(part) => root.getObjectByName(`rig_prop_cat_${id}_${part}_paw`),
		);
		const lifted = paws.map(() => false);
		let time = 0;
		let lifts = 0;
		advance(update, id === 1 ? 10 : 49, true, () => {
			time += 1 / 60;
			let started = 0;
			paws.forEach((paw, i) => {
				const airborne =
					paw.getWorldPosition(new Vector3()).y - travel.position.y >
					(i < 2 ? 0.018 : 0.019) + 0.004;
				if (airborne && !lifted[i]) started++;
				lifted[i] = airborne;
			});
			if (time < (id === 1 ? 7 : 46)) return;
			assert.ok(started <= 1, `${started} paws lifted together at ${time}s`);
			lifts += started;
		});
		assert.ok(lifts >= 4, "exercise every paw during walking");
	});
}

for (const id of [1, 2])
	for (const fps of [30, 60])
		test(`cat ${id} lifts its haunch clear of the surface while walking at ${fps} fps`, () => {
			const root = characterRig();
			const update = createCharacterMotion(root);
			const travel = root.getObjectByName(`rig_prop_cat_${id}_travel`);
			const body = root.getObjectByName(`rig_prop_cat_${id}_body`);
			const haunch = root.getObjectByName(`rig_prop_cat_${id}_haunch`);
			const underside = new Vector3();
			let checked = 0;
			advance(
				update,
				54,
				true,
				() => {
					if (
						body.rotation.x < 0.9 ||
						Math.abs(travel.position.y - 0.99) > 1e-6
					)
						return;
					root.updateMatrixWorld(true);
					// Bottom of the authored haunch ellipsoid, in its pivot's Y-up axes.
					haunch.localToWorld(underside.set(0, -0.069, 0));
					const clearance = underside.y - travel.position.y;
					assert.ok(
						clearance > 0.025,
						`cat ${id} is still crouched against the surface: ${clearance}`,
					);
					checked++;
				},
				fps,
			);
			assert.ok(checked > fps / 2, "exercise a complete walking stride");
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
							contacts >= 2,
							`cat ${id} has only ${contacts} supporting paws at ${elapsed}s`,
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

for (const fps of [30, 60])
	test(`cats keep support while rising, turning and settling at ${fps} fps`, () => {
		const root = characterRig();
		const update = createCharacterMotion(root);
		const previous = [[], []];
		const lastHeight = [NaN, NaN];
		let checked = 0;
		let elapsed = 0;
		advance(
			update,
			120,
			true,
			() => {
				elapsed += 1 / fps;
				for (const id of [1, 2]) {
					const travel = root.getObjectByName(`rig_prop_cat_${id}_travel`);
					const onSurface = [0, 0.59, 0.99].some(
						(y) => Math.abs(travel.position.y - y) < 1e-6,
					);
					let contacts = 0;
					["front_left", "front_right", "hind_left", "hind_right"].forEach(
						(name, i) => {
							const point = root
								.getObjectByName(`rig_prop_cat_${id}_${name}_paw`)
								.getWorldPosition(new Vector3());
							const ankle = travel.position.y + (i < 2 ? 0.018 : 0.019);
							if (onSurface && Math.abs(point.y - ankle) < 0.001) {
								contacts++;
								const prior = previous[id - 1][i];
								if (
									prior &&
									Math.abs(prior.y - ankle) < 0.0001 &&
									Math.abs(point.y - ankle) < 0.0001
								)
									assert.ok(
										point.distanceTo(prior) < 0.002,
										`cat ${id} ${name} skates during weight transfer`,
									);
							}
							previous[id - 1][i] = point;
						},
					);
					if (onSurface && lastHeight[id - 1] === travel.position.y) {
						assert.ok(
							contacts >= 2,
							`cat ${id} has only ${contacts} supports during weight transfer at ${elapsed}s`,
						);
						checked++;
					}
					lastHeight[id - 1] = travel.position.y;
				}
			},
			fps,
		);
		assert.ok(checked > 100 * fps);
	});

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
				...(o.morphTargetInfluences ?? []),
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
		const haunchJoint = root.getObjectByName(`rig_prop_cat_${id}_haunch`);
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
				const inHaunch = haunchJoint.worldToLocal(point.clone());
				// Measure against the moving haunch, including its narrowed walking pose.
				const haunch =
					(inHaunch.x / (id === 1 ? 0.103 : 0.09)) ** 2 +
					(inHaunch.y / 0.069) ** 2 +
					(inHaunch.z / 0.082) ** 2;
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
