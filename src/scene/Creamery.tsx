import { useGLTF } from "@react-three/drei";
import { type ThreeEvent, useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import { Mesh, type MeshStandardMaterial, type Object3D } from "three";
import { stationByHotspot } from "../stations";

const MODEL_URL = "/models/creamery.glb";

interface Props {
	onHotspot: (name: string) => void;
	motion: boolean;
}

/** The GLB built by blender/build.py, with Hotspot and Prop behaviour attached. */
export function Creamery({ onHotspot, motion }: Props) {
	const { scene } = useGLTF(MODEL_URL);
	const [hovered, setHovered] = useState<string | null>(null);
	const fans = useRef<Object3D[]>([]);
	const hotspots = useRef(new Map<string, MeshStandardMaterial>());

	const root = useMemo(() => {
		// The ground is rendered by the reflective floor instead.
		scene.getObjectByName("ground")?.removeFromParent();
		fans.current = [];
		hotspots.current.clear();
		scene.traverse((o) => {
			if (!(o instanceof Mesh)) return;
			if (o.name.startsWith("prop_fan_")) fans.current.push(o);
			if (o.name.startsWith("hotspot_")) {
				// Each Hotspot gets its own material so hover glow doesn't leak.
				const m = (o.material as MeshStandardMaterial).clone();
				m.userData.baseEmissive = m.emissiveIntensity;
				o.material = m;
				hotspots.current.set(o.name, m);
			}
		});
		return scene;
	}, [scene]);

	useEffect(() => {
		document.body.style.cursor = hovered ? "pointer" : "";
		return () => {
			document.body.style.cursor = "";
		};
	}, [hovered]);

	useFrame((state, delta) => {
		if (motion) for (const fan of fans.current) fan.rotateZ(delta * 6);
		// Additive boost, so dim plates like the sign and cow screen glow visibly.
		const pulse = 0.8 + 0.4 * Math.sin(state.clock.elapsedTime * 4);
		for (const [name, m] of hotspots.current) {
			const base = m.userData.baseEmissive as number;
			m.emissiveIntensity =
				name === hovered ? base + (motion ? pulse : 0.8) : base;
		}
	});

	const hotspotName = (e: ThreeEvent<PointerEvent | MouseEvent>) => {
		let o: Object3D | null = e.object;
		while (o && !o.name.startsWith("hotspot_")) o = o.parent;
		return o && stationByHotspot(o.name) ? o.name : null;
	};

	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: a three.js object, not a DOM element; the Station Menu is the accessible route
		<primitive
			object={root}
			onClick={(e: ThreeEvent<MouseEvent>) => {
				const name = hotspotName(e);
				if (!name) return;
				e.stopPropagation();
				onHotspot(name);
			}}
			onPointerMove={(e: ThreeEvent<PointerEvent>) => {
				const name = hotspotName(e);
				if (name !== hovered) setHovered(name);
			}}
			onPointerOut={() => setHovered(null)}
		/>
	);
}

useGLTF.preload(MODEL_URL);
