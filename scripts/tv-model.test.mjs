import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { Object3D, Vector3 } from "three";
import { STATIONS } from "../src/stations.ts";

test("the shipped TV has a hidden Station and a portrait anchor facing Street View", () => {
	const bytes = readFileSync(
		new URL("../public/models/creamery.glb", import.meta.url),
	);
	const gltf = JSON.parse(
		bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString(),
	);
	const station = STATIONS.find((s) => s.id === "shorts");
	assert.equal(station.hidden, true);
	assert.ok(gltf.nodes.some((node) => node.name === station.hotspot));
	const anchor = gltf.nodes.find((node) => node.name === "tv_screen_anchor");
	assert.ok(anchor, "the live DOM screen anchor must survive Blender export");
	assert.equal(anchor.extras.screenWidth / anchor.extras.screenHeight, 9 / 16);
	const object = new Object3D();
	object.position.fromArray(anchor.translation);
	object.quaternion.fromArray(anchor.rotation);
	object.updateMatrixWorld();
	const normal = new Vector3(0, 0, 1).transformDirection(object.matrixWorld);
	const up = new Vector3(0, 1, 0).transformDirection(object.matrixWorld);
	assert.ok(object.position.x > 2.8, "screen must be outside the right wall");
	const streetDirection = new Vector3(0, 4.2, 14)
		.sub(object.position)
		.normalize();
	assert.ok(
		normal.dot(streetDirection) > 0.98,
		"the screen must be nearly face-on from initial Street View",
	);
	assert.ok(up.y > 0.999, "DOM text must remain upright after the Y-up export");
});
