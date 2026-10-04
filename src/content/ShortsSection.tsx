import { type RefObject, useEffect, useRef, useState } from "react";
import {
	loadYouTube,
	SHORTS_CHANNEL_URL,
	SHORTS_PLAYLIST,
	type YouTubePlayer,
} from "./youtube";

interface Props {
	active: boolean;
	plain: boolean;
	narrow: boolean;
	screenReady: boolean;
	reducedMotion: boolean;
	surface: RefObject<HTMLDivElement | null>;
	onClose: () => void;
	onOpen: () => void;
}

/** Creamery audio opts into ducking; the YouTube iframe owns its own sound.
 * No soundtrack is currently installed. Preserve each track's chosen volume. */
function useCreameryAudioDucking(audible: boolean) {
	useEffect(() => {
		if (!audible) return;
		const tracks = Array.from(
			document.querySelectorAll<HTMLMediaElement>(
				"audio[data-creamery-audio], video[data-creamery-audio]",
			),
		);
		const volumes = tracks.map((track) => track.volume);
		tracks.forEach((track, i) => {
			track.volume = volumes[i] * 0.2;
		});
		return () => {
			tracks.forEach((track, i) => {
				track.volume = volumes[i];
			});
		};
	}, [audible]);
}

export function ShortsSection({
	active,
	plain,
	narrow,
	screenReady,
	reducedMotion,
	surface,
	onClose,
	onOpen,
}: Props) {
	const host = useRef<HTMLDivElement>(null);
	const close = useRef<HTMLButtonElement>(null);
	const openControl = useRef<HTMLButtonElement>(null);
	const wasActive = useRef(false);
	const player = useRef<YouTubePlayer | null>(null);
	const visible = useRef(false);
	// In-memory only: a fresh visit starts at the first playlist item.
	const resume = useRef({ index: 0, seconds: 0, videoId: "" });
	const [attempt, setAttempt] = useState(0);
	const [ready, setReady] = useState(false);
	const [canRetry, setCanRetry] = useState(false);
	const [audible, setAudible] = useState(false);
	const [muted, setMuted] = useState(true);
	const [playing, setPlaying] = useState(false);
	const [index, setIndex] = useState(0);
	const [count, setCount] = useState(0);
	const [message, setMessage] = useState(
		"Find the signal. Shorts by Jeffrey Davis.",
	);
	const canLoad = active && (plain || narrow || screenReady);
	useCreameryAudioDucking(active && audible);

	useEffect(() => {
		if (active) close.current?.focus({ preventScroll: true });
		else if (wasActive.current)
			openControl.current?.focus({ preventScroll: true });
		wasActive.current = active;
	}, [active]);

	useEffect(() => {
		if (!active || !surface.current) return;
		const observer = new IntersectionObserver(
			([entry]) => {
				visible.current = entry.intersectionRatio > 0.5;
				if (!visible.current) {
					player.current?.pauseVideo();
					setAudible(false);
				}
			},
			{ threshold: [0, 0.5, 1] },
		);
		observer.observe(surface.current);
		return () => {
			observer.disconnect();
			visible.current = false;
		};
	}, [active, surface]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: attempt intentionally recreates the player for Retry.
	useEffect(() => {
		if (!canLoad || !host.current) return;
		let disposed = false;
		let initialized = false;
		let instance: YouTubePlayer | undefined;
		let poll: number | undefined;
		setReady(false);
		setCanRetry(false);
		setMuted(true);
		setPlaying(false);
		setAudible(false);
		setMessage("Tuning in…");
		const mount = document.createElement("div");
		host.current.replaceChildren(mount);
		const timeout = window.setTimeout(() => {
			if (!disposed && !initialized) {
				setCanRetry(true);
				setMessage("YouTube is taking a while. Try again or watch on YouTube.");
			}
		}, 20000);
		const sync = () => {
			if (disposed || !instance || !initialized) return;
			const state = instance.getPlayerState();
			const isMuted = instance.isMuted();
			setMuted(isMuted);
			setPlaying(state === 1);
			setAudible(state === 1 && !isMuted && instance.getVolume() > 0);
			const currentIndex = Math.max(0, instance.getPlaylistIndex());
			setIndex(currentIndex);
			setCount(instance.getPlaylist()?.length ?? 0);
			const videoId = instance.getVideoData()?.video_id;
			if (videoId)
				resume.current = {
					index: currentIndex,
					seconds: instance.getCurrentTime(),
					videoId,
				};
		};
		const onVisibility = () => {
			if (!document.hidden || !instance) return;
			sync();
			instance.pauseVideo();
			setAudible(false);
			setMessage(
				"Playback paused while you were away. Press Play to continue.",
			);
		};
		document.addEventListener("visibilitychange", onVisibility);

		void loadYouTube()
			.then((api) => {
				if (disposed) return;
				instance = new api.Player(mount, {
					width: "100%",
					height: "100%",
					playerVars: {
						listType: "playlist",
						list: SHORTS_PLAYLIST,
						enablejsapi: 1,
						origin: window.location.origin,
						playsinline: 1,
						controls: 1,
						autoplay: 0,
						loop: 0,
						rel: 0,
					},
					events: {
						onReady: ({ target }) => {
							if (disposed) return;
							instance = target;
							player.current = target;
							target.mute();
							target.setLoop(false);
							target.setShuffle(false);
							target.cuePlaylist({
								listType: "playlist",
								list: SHORTS_PLAYLIST,
								index: 0,
								startSeconds: 0,
							});
							poll = window.setInterval(sync, 250);
						},
						onStateChange: ({ target, data }) => {
							if (disposed) return;
							if (data === 1) {
								setCanRetry(false);
								setMessage(
									target.isMuted()
										? "Sound is off. Enable it when you’re ready."
										: "Sound is on.",
								);
							}
							if (data === 5 && !initialized) {
								initialized = true;
								clearTimeout(timeout);
								const videos = target.getPlaylist() ?? [];
								const saved = resume.current;
								const found = videos.indexOf(saved.videoId);
								const options = {
									listType: "playlist" as const,
									list: SHORTS_PLAYLIST,
									index: found >= 0 ? found : 0,
									startSeconds: found >= 0 ? saved.seconds : 0,
								};
								setReady(true);
								setCount(videos.length);
								if (reducedMotion || document.hidden || !visible.current)
									target.cuePlaylist(options);
								else target.loadPlaylist(options);
								setMessage(
									reducedMotion || !visible.current
										? "Press Play when you’re ready."
										: "Sound is off. Enable it when you’re ready.",
								);
							}
							if (
								data === 0 &&
								target.getPlaylistIndex() === target.getPlaylist().length - 1
							)
								setMessage("You’ve reached the end of the playlist.");
							// The playlist advances itself. Advancing here would skip videos.
							sync();
						},
						onError: () => {
							if (disposed) return;
							setCanRetry(true);
							initialized = true;
							clearTimeout(timeout);
							setAudible(false);
							setMessage(
								"This Short can’t play here. Try the next one or watch on YouTube.",
							);
							setReady(Boolean(instance));
							setCount(instance?.getPlaylist()?.length ?? 0);
						},
						onAutoplayBlocked: () => {
							if (!disposed) setMessage("Press Play to start the Short.");
						},
					},
				});
				const iframe = host.current?.querySelector("iframe");
				if (iframe) iframe.title = "BetaByJ Shorts player";
			})
			.catch(() => {
				clearTimeout(timeout);
				if (!disposed) {
					setCanRetry(true);
					setMessage("YouTube couldn’t load. Try again or watch on YouTube.");
				}
			});

		return () => {
			sync();
			disposed = true;
			clearTimeout(timeout);
			clearInterval(poll);
			document.removeEventListener("visibilitychange", onVisibility);
			instance?.destroy();
			player.current = null;
			setAudible(false);
			mount.remove();
		};
	}, [canLoad, reducedMotion, attempt]);

	const play = () => {
		player.current?.playVideo();
		setMessage(muted ? "Sound is off until you enable it." : "Sound is on.");
	};
	return (
		<section
			id="shorts"
			className={`shorts-section ${active ? "shorts-section--active" : "section--inactive"} ${plain || narrow ? "shorts-section--panel" : ""} ${plain ? "shorts-section--plain" : ""}`}
			aria-label="BetaByJ Shorts"
			aria-hidden={!active && !plain}
			inert={!active && !plain}
		>
			{plain && !active && (
				<div className="shorts-intro">
					<h2>BetaByJ Shorts</h2>
					<p>Shorts by Jeffrey Davis.</p>
					<button
						ref={openControl}
						className="pixel"
						type="button"
						onClick={onOpen}
					>
						Watch Shorts
					</button>
					<p>
						<a href={SHORTS_CHANNEL_URL}>Watch on YouTube</a>
					</p>
				</div>
			)}
			<div ref={surface} className="tv-surface" hidden={!active}>
				<div
					ref={host}
					className="tv-player"
					style={{ visibility: ready ? "visible" : "hidden" }}
				/>
				{!ready && (
					<div className="tv-loading">
						<span className="pixel">BetaByJ</span>
						<p>{message}</p>
					</div>
				)}
			</div>
			{active && (
				<div className="tv-controls">
					<div className="tv-controls-heading">
						<h2 className="pixel">BetaByJ</h2>
						<button
							ref={close}
							type="button"
							className="tv-close"
							onClick={onClose}
							aria-label="Close TV"
						>
							×
						</button>
					</div>
					<p className="tv-caption">
						{count ? `SHORT ${index + 1} / ${count}` : "SHORTS · JEFFREY DAVIS"}
					</p>
					<div className="tv-transport">
						<button
							type="button"
							disabled={!ready || index <= 0}
							onClick={() => player.current?.previousVideo()}
						>
							Previous
						</button>
						<button
							type="button"
							disabled={!ready}
							onClick={() => (playing ? player.current?.pauseVideo() : play())}
						>
							{playing ? "Pause" : "Play"}
						</button>
						<button
							type="button"
							disabled={!ready || (count > 0 && index >= count - 1)}
							onClick={() => player.current?.nextVideo()}
						>
							Next
						</button>
					</div>
					<button
						className="tv-sound"
						type="button"
						disabled={!ready}
						aria-pressed={!muted}
						onClick={() => {
							if (muted) player.current?.unMute();
							else player.current?.mute();
							setMuted(!muted);
							setMessage(muted ? "Sound is on." : "Sound is off.");
						}}
					>
						{muted ? "Enable sound" : "Mute sound"}
					</button>
					<p className="tv-status" role="status">
						{message}
					</p>
					<div className="tv-links">
						{canRetry && (
							<button
								type="button"
								onClick={() => setAttempt((value) => value + 1)}
							>
								Try again
							</button>
						)}
						<a href={SHORTS_CHANNEL_URL} target="_blank" rel="noreferrer">
							Watch on YouTube ↗
						</a>
					</div>
				</div>
			)}
		</section>
	);
}
