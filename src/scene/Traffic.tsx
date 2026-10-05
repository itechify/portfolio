import { useGLTF } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import {
	Color,
	DataTexture,
	Mesh,
	MeshBasicMaterial,
	type MeshStandardMaterial,
	Vector3,
} from "three";
import { createTrafficMotion } from "./trafficMotion";

const COLORS = ["#6e86c4", "#a85d83", "#558d85"].map((c) => new Color(c));
const LANE_CENTER = new Vector3(0, 0.4, 3.85);

/** Authored in Blender, shaded by two small portable baked atlases. */
export function Traffic({
	motion,
	street,
}: {
	motion: boolean;
	street: boolean;
}) {
	const { scene } = useGLTF("/models/traffic-car.glb", "/draco/");
	const car = useMemo(() => {
		const root = scene.clone(true);
		const materials: MeshBasicMaterial[] = [];
		let paint: MeshBasicMaterial | undefined;
		root.traverse((o) => {
			if (!(o instanceof Mesh)) return;
			// A passing Prop must never steal a Hotspot click or hover.
			o.raycast = () => {};
			const original = o.material as MeshStandardMaterial;
			if (original.map && original.name.startsWith("baked_")) {
				let material = materials.find((m) => m.name === original.name);
				if (!material) {
					material = new MeshBasicMaterial({ map: original.map });
					material.name = original.name;
					materials.push(material);
				}
				o.material = material;
				if (original.name === "baked_car_paint") paint = material;
			}
		});
		root.name = "traffic";
		root.visible = false;
		root.position.set(0, -0.12, 3.85);
		const wheels = [0, 1, 2, 3].map((i) =>
			root.getObjectByName(`rig_traffic_wheel_${i}`),
		);
		return { root, wheels, paint, materials };
	}, [scene]);
	const update = useMemo(() => createTrafficMotion(), []);
	const leavingStreet = useRef(0);
	const shadow = useMemo(() => {
		const pixels = new Uint8Array(32 * 32 * 4);
		for (let y = 0; y < 32; y++) {
			for (let x = 0; x < 32; x++) {
				const edge = Math.max(Math.abs(x - 15.5), Math.abs(y - 15.5)) / 15.5;
				pixels[(y * 32 + x) * 4 + 3] = 160 * (1 - edge) ** 0.5;
			}
		}
		const map = new DataTexture(pixels, 32, 32);
		map.needsUpdate = true;
		return map;
	}, []);
	useEffect(
		() => () => {
			for (const material of car.materials) material.dispose();
			shadow.dispose();
		},
		[car, shadow],
	);
	useFrame(({ camera, viewport }, delta) => {
		if (document.hidden) return;
		const extent =
			viewport.getCurrentViewport(camera, LANE_CENTER).width / 2 +
			Math.abs(camera.position.x) +
			3;
		const state = update(delta, motion, street, extent);
		leavingStreet.current = street
			? 0
			: leavingStreet.current + Math.min(delta, 0.1);
		// Let the camera leave a crossing naturally before hiding it offscreen.
		car.root.visible = state.active && (street || leavingStreet.current < 0.8);
		car.root.position.x = state.x;
		if (!state.active) return;
		if (car.paint) car.paint.color.copy(COLORS[state.variant]);
		for (const wheel of car.wheels) {
			if (wheel) wheel.rotation.z = -state.distance / 0.24;
		}
	});
	return (
		<primitive object={car.root} dispose={null}>
			<mesh position-y={0.012} rotation-x={-Math.PI / 2} raycast={() => {}}>
				<planeGeometry args={[2.95, 1.4]} />
				<meshBasicMaterial
					map={shadow}
					transparent
					depthWrite={false}
					toneMapped={false}
				/>
			</mesh>
		</primitive>
	);
}
