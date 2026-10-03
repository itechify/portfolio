import { CameraControls, MeshReflectorMaterial } from "@react-three/drei";
import { Canvas, useThree } from "@react-three/fiber";
import { Bloom, EffectComposer } from "@react-three/postprocessing";
import { Suspense, useEffect, useRef } from "react";
import { Box3, MathUtils, Vector3 } from "three";
import { type Station, type StationId, stationByHotspot } from "../stations";
import { Creamery } from "./Creamery";

interface Props {
	station: Station;
	onStation: (id: StationId) => void;
	motion: boolean;
}

/** Street View framing, in three.js coordinates (the GLB is exported Y-up). */
const STREET_POSITION = new Vector3(0, 4.2, 14);
const STREET_TARGET = new Vector3(0, 3.0, 0);

function Rig({ station, motion }: { station: Station; motion: boolean }) {
	const controls = useRef<CameraControls>(null);
	const scene = useThree((s) => s.scene);

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
	}, [station, scene, motion]);

	return (
		<CameraControls
			ref={controls}
			makeDefault
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

function Street() {
	return (
		<mesh rotation-x={-Math.PI / 2} position-y={0.001} receiveShadow>
			<planeGeometry args={[40, 40]} />
			<MeshReflectorMaterial
				blur={[300, 100]}
				resolution={512}
				mixBlur={1}
				mixStrength={30}
				roughness={1}
				depthScale={1}
				minDepthThreshold={0.4}
				maxDepthThreshold={1.4}
				color="#0b0618"
				metalness={0.5}
				mirror={0}
			/>
		</mesh>
	);
}

export function Scene({ station, onStation, motion }: Props) {
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
			onPointerMissed={() => station.id !== "street" && onStation("street")}
		>
			<color attach="background" args={["#05061a"]} />
			<fog attach="fog" args={["#05061a", 25, 45]} />
			<ambientLight intensity={0.25} color="#4050e0" />
			<directionalLight
				position={[4, 12, 10]}
				intensity={0.6}
				color="#8fb7ff"
			/>
			<pointLight
				position={[-1.2, 2, 1]}
				intensity={6}
				color="#f06ea8"
				distance={6}
			/>
			<pointLight
				position={[-0.9, 3, 2.5]}
				intensity={8}
				color="#48f0e0"
				distance={8}
			/>
			<Suspense fallback={null}>
				<Creamery
					motion={motion}
					onHotspot={(name) => {
						const s = stationByHotspot(name);
						if (s) onStation(s.id);
					}}
				/>
				<Street />
			</Suspense>
			<Rig station={station} motion={motion} />
			<EffectComposer multisampling={0}>
				<Bloom
					luminanceThreshold={0.9}
					mipmapBlur
					intensity={0.9}
					radius={0.6}
				/>
			</EffectComposer>
		</Canvas>
	);
}
