import { useGLTF } from "@react-three/drei";
import { type ThreeEvent, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import {
	Mesh,
	MeshBasicMaterial,
	MeshStandardMaterial,
	type Object3D,
	TextureLoader,
} from "three";
import { stationByHotspot } from "../stations";
import { createCharacterMotion } from "./characterMotion";
import { createTvIdleAnimation } from "./tvIdleAnimation";

const MODEL_URL = "/models/creamery.glb";
const DRACO_PATH = "/draco/";

const hasEmission = (m: MeshStandardMaterial) =>
	m.emissiveIntensity > 0 && m.emissive.getHex() !== 0;

interface Props {
	onHotspot: (name: string) => void;
	motion: boolean;
	tvActive: boolean;
}

/** The GLB built by blender/build.py, with Hotspot and Prop behaviour attached. */
export function Creamery({ onHotspot, motion, tvActive }: Props) {
	const { scene } = useGLTF(MODEL_URL, DRACO_PATH);
	const maxAnisotropy = useThree((s) => s.gl.capabilities.getMaxAnisotropy());
	const [hovered, setHovered] = useState<string | null>(null);
	// Hover is decided once per pointer-move: the scene handler records which
	// Hotspot (if any) the ray hit, and a document-level listener, which runs
	// after it, commits the result. Pointer-out is unused because it fires per
	// child mesh as the cursor crosses a Hotspot's detail, causing flicker.
	const hit = useRef<string | null>(null);
	const fans = useRef<Object3D[]>([]);
	const tvIdle = useRef<ReturnType<typeof createTvIdleAnimation> | null>(null);
	// Emissive plates glow by raising emission; baked (unlit) plates glow by
	// scaling their colour above white, which the bloom pass then picks up.
	const hotspots = useRef(
		new Map<string, MeshStandardMaterial | MeshBasicMaterial>(),
	);

	const root = useMemo(() => {
		// The ground is rendered by the reflective floor instead.
		scene.getObjectByName("ground")?.removeFromParent();
		fans.current = [];
		hotspots.current.clear();
		scene.traverse((o) => {
			if (!(o instanceof Mesh)) return;
			// Clicks on the pavement fall through to the Canvas, so clicking
			// the ground still returns to Street View as the road does.
			if (o.name === "street") o.raycast = () => {};
			// Lighting is baked into the textures (ADR 0001), so baked meshes
			// render unlit. Emissive meshes keep their material for bloom.
			const std = o.material as MeshStandardMaterial;
			if (std.map && !hasEmission(std)) {
				// Keeps the atlases sharp on surfaces seen at a glancing angle,
				// like the counter top and the sidewalk.
				std.map.anisotropy = Math.min(8, maxAnisotropy);
				o.material = new MeshBasicMaterial({ map: std.map });
			}
			if (o.name.startsWith("prop_fan_")) fans.current.push(o);
			if (o.name.startsWith("hotspot_")) {
				// Each Hotspot gets its own material so hover glow doesn't leak.
				const m = (
					o.material as MeshStandardMaterial | MeshBasicMaterial
				).clone();
				if (m instanceof MeshStandardMaterial) {
					m.userData.baseEmissive = m.emissiveIntensity;
				}
				o.material = m;
				hotspots.current.set(o.name, m);
			}
		});
		return scene;
	}, [scene, maxAnisotropy]);
	const animateCharacters = useMemo(() => createCharacterMotion(root), [root]);

	useEffect(() => {
		if (!motion) return;
		let cancelled = false;
		// Load after Entry only; the model's still remains a complete fallback.
		new TextureLoader().load(
			"/images/tv-bouldering-loop.png",
			(atlas) => {
				if (cancelled) atlas.dispose();
				else tvIdle.current = createTvIdleAnimation(root, atlas);
			},
			undefined,
			() => {}, // Keep the still if the optional animation cannot load.
		);
		return () => {
			cancelled = true;
			tvIdle.current?.dispose();
			tvIdle.current = null;
		};
	}, [root, motion]);

	useEffect(() => {
		const commit = () => {
			const name = hit.current;
			hit.current = null;
			setHovered((prev) => (prev === name ? prev : name));
		};
		document.addEventListener("pointermove", commit);
		return () => document.removeEventListener("pointermove", commit);
	}, []);

	useEffect(() => {
		document.body.style.cursor = hovered ? "pointer" : "";
		return () => {
			document.body.style.cursor = "";
		};
	}, [hovered]);

	useFrame((state, delta) => {
		animateCharacters(delta, motion);
		if (!document.hidden) tvIdle.current?.update(delta, motion && !tvActive);
		// The glTF exporter converts Blender's Z-up mesh data to Y-up, so the
		// cylinder axis the blades were built around is local Y here.
		if (motion) for (const fan of fans.current) fan.rotateY(delta * 6);
		// Additive boost, so dim plates like the sign and cow screen glow visibly.
		const pulse = 0.8 + 0.4 * Math.sin(state.clock.elapsedTime * 4);
		for (const [name, m] of hotspots.current) {
			const boost = name === hovered ? (motion ? pulse : 0.8) : 0;
			if (m instanceof MeshStandardMaterial) {
				m.emissiveIntensity = (m.userData.baseEmissive as number) + boost;
			} else {
				m.color.setScalar(1 + boost);
			}
		}
	});

	// R3F calls this once per intersected mesh under the root, nearest first, so
	// resolve from the nearest intersection only: a letter in front of the plate
	// wins, and the building behind a Hotspot can't cancel it.
	const hotspotName = (e: ThreeEvent<PointerEvent | MouseEvent>) => {
		let o: Object3D | null = e.intersections[0]?.object ?? e.object;
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
				hit.current = hotspotName(e);
			}}
		/>
	);
}

useGLTF.preload(MODEL_URL, DRACO_PATH);
