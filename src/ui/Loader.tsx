import { useProgress } from "@react-three/drei";
import { useEffect, useRef } from "react";

interface Props {
	onEnter: () => void;
}

/** The loading screen and Entry button. Audio starts only after Entry. */
export function Loader({ onEnter }: Props) {
	const { progress, active } = useProgress();
	const ready = !active && progress >= 100;
	const entry = useRef<HTMLButtonElement>(null);

	// Move focus to the Entry button once loading finishes so keyboard users
	// can open the shop without hunting for it.
	useEffect(() => {
		if (ready) entry.current?.focus();
	}, [ready]);
	return (
		<div
			className="loader"
			role="dialog"
			aria-labelledby="loader-title"
			aria-live="polite"
		>
			<h1 id="loader-title" className="pixel">
				JJ's Creamery
			</h1>
			{ready ? (
				<button
					ref={entry}
					type="button"
					className="pixel entry"
					onClick={onEnter}
				>
					Open the shop
				</button>
			) : (
				<p className="pixel">Pouring your milk... {Math.floor(progress)}%</p>
			)}
		</div>
	);
}
