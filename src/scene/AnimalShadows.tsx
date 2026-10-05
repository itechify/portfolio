import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { DataTexture, type Mesh, type MeshBasicMaterial } from "three";
import type { createCharacterMotion } from "./characterMotion";

type Cats = ReturnType<ReturnType<typeof createCharacterMotion>>;

/** Two tiny soft contact planes, with no real-time lights or shadow maps. */
export function AnimalShadows({ cats }: { cats: Cats }) {
	const meshes = useRef<(Mesh | null)[]>([]);
	const texture = useMemo(() => {
		const pixels = new Uint8Array(32 * 32 * 4);
		for (let y = 0; y < 32; y++) {
			for (let x = 0; x < 32; x++) {
				const r = Math.hypot((x - 15.5) / 15.5, (y - 15.5) / 15.5);
				pixels[(y * 32 + x) * 4 + 3] = 100 * Math.max(0, 1 - r) ** 2;
			}
		}
		const map = new DataTexture(pixels, 32, 32);
		map.needsUpdate = true;
		return map;
	}, []);
	useEffect(() => () => texture.dispose(), [texture]);
	useFrame(() => {
		cats.forEach((cat, i) => {
			const mesh = meshes.current[i];
			if (!mesh || !cat.position) return;
			mesh.position.set(
				cat.position.x,
				cat.shadowHeight + 0.003,
				cat.position.z,
			);
			(mesh.material as MeshBasicMaterial).opacity = cat.shadowOpacity;
		});
	});
	return cats.map((_, i) => (
		<mesh
			key={i === 0 ? "Skadi" : "Freya"}
			name={`prop_cat_contact_shadow_${i + 1}`}
			ref={(mesh) => {
				meshes.current[i] = mesh;
			}}
			rotation-x={-Math.PI / 2}
			raycast={() => {}}
		>
			<planeGeometry args={[0.36, 0.36]} />
			<meshBasicMaterial
				map={texture}
				transparent
				depthWrite={false}
				toneMapped={false}
			/>
		</mesh>
	));
}
