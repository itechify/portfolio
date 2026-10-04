import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { Mesh, MeshStandardMaterial, Object3D, Texture } from "three";
import { createTvIdleAnimation } from "../src/scene/tvIdleAnimation.ts";

function fixture() {
	const material = new MeshStandardMaterial({ emissiveMap: new Texture() });
	material.name = "tv_bouldering_poster";
	const mesh = new Mesh(undefined, material);
	const root = new Object3D();
	root.add(mesh);
	const atlas = new Texture();
	return {
		mesh,
		material,
		atlas,
		animation: createTvIdleAnimation(root, atlas),
	};
}

test("shipped GLB exposes the idle poster material", () => {
	const bytes = readFileSync(
		new URL("../public/models/creamery.glb", import.meta.url),
	);
	const gltf = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)));
	assert.ok(
		gltf.materials.some(
			(m) => m.name === "tv_bouldering_poster" && m.emissiveTexture,
		),
	);
});

test("idle loop visits all four poses and restores the still for playback or reduced motion", () => {
	const { mesh, material, atlas, animation } = fixture();
	const originalMap = material.emissiveMap;
	const poses = new Set();
	for (let i = 0; i < 220; i++) {
		animation.update(1 / 60, true);
		poses.add(atlas.offset.toArray().join(","));
	}
	assert.equal(poses.size, 4);
	assert.notEqual(mesh.material, material);
	assert.equal(mesh.material.emissiveMap, atlas);
	assert.equal(material.emissiveMap, originalMap);
	assert.deepEqual(originalMap.repeat.toArray(), [1, 1]);
	animation.update(20, false);
	assert.equal(mesh.material, material);
	animation.update(0, true);
	assert.deepEqual(atlas.offset.toArray(), [0, 0]);
	animation.dispose();
	assert.equal(mesh.material, material);
});

test("suspended frames cannot skip poses and disposal releases owned resources once", () => {
	const { mesh, material, atlas, animation } = fixture();
	animation.update(300, true);
	assert.deepEqual(atlas.offset.toArray(), [0, 0]);
	let disposedAtlas = 0;
	let disposedMaterial = 0;
	let disposedOriginal = 0;
	atlas.addEventListener("dispose", () => disposedAtlas++);
	mesh.material.addEventListener("dispose", () => disposedMaterial++);
	material.addEventListener("dispose", () => disposedOriginal++);
	animation.dispose();
	animation.dispose();
	animation.update(1, true);
	assert.equal(mesh.material, material);
	assert.deepEqual(
		[disposedAtlas, disposedMaterial, disposedOriginal],
		[1, 1, 0],
	);
});
