import {
	Mesh,
	MeshStandardMaterial,
	NearestFilter,
	type Object3D,
	SRGBColorSpace,
	type Texture,
} from "three";

// Climb, settle, then return through the same poses for a seamless idle loop.
const FRAMES = [0, 0, 1, 2, 3, 3, 2, 1];
const FRAME_SECONDS = 0.45;
// The generated sheet has generous empty margins. Register each pose against
// the boulder's top corner so the rock stays still while the person climbs.
const ATLAS_ORIGINS = [
	[0, 0],
	[459, 0],
	[0, 783],
	[459, 783],
];

/** Owns only the idle screen's cloned material and the supplied frame atlas. */
export function createTvIdleAnimation(root: Object3D, atlas: Texture) {
	const screens: {
		mesh: Mesh;
		original: MeshStandardMaterial;
		animated: MeshStandardMaterial;
	}[] = [];
	atlas.flipY = false; // Same UV convention as the exported glTF poster.
	atlas.colorSpace = SRGBColorSpace;
	atlas.magFilter = NearestFilter;
	atlas.minFilter = NearestFilter;
	atlas.generateMipmaps = false;
	atlas.repeat.set(470 / 941, 836 / 1672);
	atlas.needsUpdate = true;
	root.traverse((object) => {
		if (
			!(object instanceof Mesh) ||
			!(object.material instanceof MeshStandardMaterial) ||
			object.material.name !== "tv_bouldering_poster"
		)
			return;
		const original = object.material;
		const animated = original.clone();
		animated.emissiveMap = atlas;
		screens.push({ mesh: object, original, animated });
	});
	let elapsed = 0;
	let disposed = false;
	return {
		update(delta: number, active: boolean) {
			if (disposed) return;
			// Don't jump ahead after a background tab or a suspended frame.
			elapsed = active ? elapsed + Math.min(Math.max(delta, 0), 0.05) : 0;
			const frame = FRAMES[Math.floor(elapsed / FRAME_SECONDS) % FRAMES.length];
			const [x, y] = ATLAS_ORIGINS[frame];
			atlas.offset.set(x / 941, y / 1672);
			for (const { mesh, original, animated } of screens) {
				mesh.material = active ? animated : original;
			}
		},
		dispose() {
			if (disposed) return;
			disposed = true;
			for (const { mesh, original, animated } of screens) {
				mesh.material = original;
				animated.dispose();
			}
			atlas.dispose();
		},
	};
}
