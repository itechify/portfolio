import { CameraControls, MeshReflectorMaterial } from "@react-three/drei";
import { Canvas, useThree } from "@react-three/fiber";
import { Bloom, EffectComposer, SMAA } from "@react-three/postprocessing";
import {
	type ComponentRef,
	Suspense,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
} from "react";
import { BackSide, Box3, Color, MathUtils, Vector3 } from "three";
import { type Station, type StationId, stationByHotspot } from "../stations";
import { Creamery } from "./Creamery";
import { TvProjection } from "./TvProjection";

interface Props {
	station: Station;
	onStation: (id: StationId) => void;
	motion: boolean;
	tv: Parameters<typeof TvProjection>[0];
}

/** Street View framing, in three.js coordinates (the GLB is exported Y-up). */
const STREET_POSITION = new Vector3(0, 4.2, 14);
const STREET_TARGET = new Vector3(0, 3.0, 0);

/** Night sky: near-black overhead, a violet city glow at the horizon. The
 * fog matches the horizon so the street fades into it with no hard edge. */
const SKY_TOP = "#03040f";
const HORIZON = "#160d33";

function Rig({ station, motion }: { station: Station; motion: boolean }) {
	const controls = useRef<CameraControls>(null);
	const scene = useThree((s) => s.scene);
	const size = useThree((s) => s.size);

	useEffect(() => {
		const c = controls.current;
		if (!c) return;
		if (station.id === "street") {
			c.setLookAt(
				...STREET_POSITION.toArray(),
				...STREET_TARGET.toArray(),
				motion,
			);
			return;
		}
		if (station.id === "shorts") {
			const anchor = scene.getObjectByName("tv_screen_anchor");
			if (!anchor) return;
			anchor.updateWorldMatrix(true, false);
			const center = anchor.getWorldPosition(new Vector3());
			const normal = new Vector3(0, 0, 1).transformDirection(
				anchor.matrixWorld,
			);
			// Reserve breathing room for the housing and Station Menu. The
			// narrow layout uses a panel, so it can keep a wider camera frame.
			const narrow = size.width <= 900 || size.height <= 680;
			const distance = narrow
				? station.distance
				: 1.6 / (2 * Math.tan(MathUtils.degToRad(20)) * 0.7);
			const eye = center.clone().addScaledVector(normal, distance);
			c.setLookAt(...eye.toArray(), ...center.toArray(), motion);
			return;
		}
		const target = scene.getObjectByName(station.hotspot);
		if (!target) return;
		const center = new Box3().setFromObject(target).getCenter(new Vector3());
		c.setLookAt(
			center.x,
			center.y,
			center.z + station.distance,
			center.x,
			center.y,
			center.z,
			motion,
		);
	}, [station, scene, motion, size.width, size.height]);

	return (
		<CameraControls
			ref={controls}
			makeDefault
			enabled={station.id !== "shorts"}
			minAzimuthAngle={MathUtils.degToRad(-60)}
			maxAzimuthAngle={MathUtils.degToRad(60)}
			minPolarAngle={MathUtils.degToRad(50)}
			maxPolarAngle={MathUtils.degToRad(92)}
			minDistance={3}
			maxDistance={24}
			smoothTime={0.6}
		/>
	);
}

function Sky() {
	const uniforms = useMemo(
		() => ({
			top: { value: new Color(SKY_TOP) },
			horizon: { value: new Color(HORIZON) },
		}),
		[],
	);
	return (
		<mesh renderOrder={-1}>
			{/* Small enough to stay inside the far plane from any orbit. */}
			<sphereGeometry args={[70, 32, 16]} />
			<shaderMaterial
				side={BackSide}
				depthWrite={false}
				fog={false}
				uniforms={uniforms}
				vertexShader={`
					varying float vHeight;
					void main() {
						vHeight = normalize(position).y;
						gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
					}
				`}
				fragmentShader={`
					uniform vec3 top;
					uniform vec3 horizon;
					varying float vHeight;
					void main() {
						gl_FragColor = vec4(mix(horizon, top, smoothstep(0.0, 0.45, vHeight)), 1.0);
					}
				`}
			/>
		</mesh>
	);
}

/** The road, a curb's height below the baked sidewalk (CURB in build.py). */
const ROAD_HEIGHT = -0.12;

function Street() {
	const material = useRef<ComponentRef<typeof MeshReflectorMaterial>>(null);

	// drei folds the reflection into the diffuse colour, which only scene
	// lights would reveal, and the scene has none (ADR 0001). Emit that
	// colour instead: dark asphalt carrying the shop's reflection.
	useLayoutEffect(() => {
		const m = material.current;
		if (!m) return;
		const reflect = m.onBeforeCompile.bind(m);
		m.onBeforeCompile = (shader: { fragmentShader: string }) => {
			reflect(shader);
			shader.fragmentShader = shader.fragmentShader.replace(
				"#include <lights_fragment_begin>",
				"totalEmissiveRadiance += diffuseColor.rgb;\n#include <lights_fragment_begin>",
			);
		};
		m.needsUpdate = true;
	}, []);

	return (
		<mesh rotation-x={-Math.PI / 2} position-y={ROAD_HEIGHT} receiveShadow>
			{/* Reaches past the fog's far plane, so it never shows an edge. */}
			<planeGeometry args={[160, 160]} />
			<MeshReflectorMaterial
				ref={material}
				blur={[300, 100]}
				resolution={512}
				mixBlur={1}
				mixStrength={30}
				roughness={1}
				depthScale={1}
				minDepthThreshold={0.4}
				maxDepthThreshold={1.4}
				color="#1a1a30"
				metalness={0.5}
				mirror={0}
			/>
		</mesh>
	);
}

export function Scene({ station, onStation, motion, tv }: Props) {
	return (
		<Canvas
			dpr={[1, 2]}
			camera={{
				position: STREET_POSITION.toArray(),
				fov: 40,
				near: 0.1,
				far: 100,
			}}
			gl={{ antialias: false, powerPreference: "high-performance" }}
			onPointerMissed={() =>
				station.id !== "street" &&
				station.id !== "shorts" &&
				onStation("street")
			}
		>
			<color attach="background" args={[SKY_TOP]} />
			<fog attach="fog" args={[HORIZON, 22, 70]} />
			<Sky />
			{/* No scene lights: lighting is baked into the model (ADR 0001). */}
			<Suspense fallback={null}>
				<Creamery
					motion={motion}
					tvActive={station.id === "shorts"}
					onHotspot={(name) => {
						const s = stationByHotspot(name);
						if (s) onStation(s.id);
					}}
				/>
				<Street />
			</Suspense>
			<Rig station={station} motion={motion} />
			<TvProjection {...tv} />
			<EffectComposer multisampling={0}>
				{/* Baked textures top out at 1.0, so only emissives above it bloom. */}
				<Bloom
					luminanceThreshold={1.0}
					luminanceSmoothing={0.1}
					mipmapBlur
					intensity={0.9}
					radius={0.6}
				/>
				{/* The canvas has no MSAA, so this is the only anti-aliasing. */}
				<SMAA />
			</EffectComposer>
		</Canvas>
	);
}
