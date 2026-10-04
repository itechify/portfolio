import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { Object3D, Vector3 } from "three";
import { STATIONS } from "../src/stations.ts";

test("the shipped TV has a hidden Station and a portrait anchor facing around the right corner", () => {
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
	assert.ok(
		normal.x > 0.7 && normal.z > 0.5,
		"screen must face right and toward the street",
	);
	assert.ok(up.y > 0.999, "DOM text must remain upright after the Y-up export");
});
