import { useFrame } from "@react-three/fiber";
import { type RefObject, useMemo } from "react";
import { Matrix4, Vector3 } from "three";

export interface TvProjectionRefs {
	surface: RefObject<HTMLDivElement | null>;
	hotspot: RefObject<HTMLButtonElement | null>;
}

/** Map the anchor's XY screen plane to CSS pixels, including perspective.
 * One live DOM surface stays mounted across camera movement and phone layout. */
export function TvProjection({
	surface,
	hotspot,
	active,
	narrow,
	onReady,
}: TvProjectionRefs & {
	active: boolean;
	narrow: boolean;
	onReady: (ready: boolean) => void;
}) {
	const scratch = useMemo(
		() => ({
			matrix: new Matrix4(),
			local: new Matrix4(),
			position: new Vector3(),
			normal: new Vector3(),
			direction: new Vector3(),
			corner: new Vector3(),
			ready: false,
		}),
		[],
	);
	useFrame(({ scene, camera, size }) => {
		const anchor = scene.getObjectByName("tv_screen_anchor");
		if (!anchor) return;
		const { matrix, local, position, normal, direction, corner } = scratch;
		anchor.updateWorldMatrix(true, false);
		const width = Number(anchor.userData.screenWidth);
		const height = Number(anchor.userData.screenHeight);
		local.set(
			width / 360,
			0,
			0,
			-width / 2,
			0,
			-height / 640,
			0,
			height / 2,
			0,
			0,
			1,
			0,
			0,
			0,
			0,
			1,
		);
		matrix
			.copy(camera.projectionMatrix)
			.multiply(camera.matrixWorldInverse)
			.multiply(anchor.matrixWorld)
			.multiply(local);
		const e = matrix.elements;
		const sx = size.width / 2;
		const sy = size.height / 2;
		const transform = `matrix3d(${[
			sx * (e[0] + e[3]),
			sy * (e[3] - e[1]),
			0,
			e[3],
			sx * (e[4] + e[7]),
			sy * (e[7] - e[5]),
			0,
			e[7],
			0,
			0,
			1,
			0,
			sx * (e[12] + e[15]),
			sy * (e[15] - e[13]),
			0,
			e[15],
		].join(",")})`;
		anchor.getWorldPosition(position);
		normal.set(0, 0, 1).transformDirection(anchor.matrixWorld);
		direction.copy(camera.position).sub(position);
		const facing = normal.dot(direction) > 0;
		let minX = Infinity,
			minY = Infinity,
			maxX = -Infinity,
			maxY = -Infinity;
		let inFront = true;
		for (const [x, y] of [
			[0, 0],
			[360, 0],
			[360, 640],
			[0, 640],
		]) {
			corner.set(x, y, 0).applyMatrix4(matrix);
			inFront &&= corner.z > -1 && corner.z < 1;
			const px = (corner.x + 1) * sx;
			const py = (1 - corner.y) * sy;
			minX = Math.min(minX, px);
			maxX = Math.max(maxX, px);
			minY = Math.min(minY, py);
			maxY = Math.max(maxY, py);
		}
		const visible =
			facing &&
			inFront &&
			maxX > 0 &&
			maxY > 0 &&
			minX < size.width &&
			minY < size.height;
		if (hotspot.current) {
			hotspot.current.style.transform = visible ? transform : "none";
			// Keep a keyboard route even when the visitor orbits behind the TV.
			hotspot.current.dataset.offscreen = String(!visible);
		}
		if (surface.current) {
			surface.current.style.transform = narrow ? "none" : transform;
			surface.current.style.visibility =
				active && (narrow || visible) ? "visible" : "hidden";
		}
		const ready =
			narrow ||
			(visible &&
				maxX - minX >= 200 &&
				maxY - minY >= 200 &&
				minX >= 0 &&
				minY >= 0 &&
				maxX <= size.width &&
				maxY <= size.height);
		if (scratch.ready !== ready) {
			scratch.ready = ready;
			onReady(ready);
		}
	});
	return null;
}
