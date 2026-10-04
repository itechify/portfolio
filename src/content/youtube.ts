export const SHORTS_PLAYLIST = "PL___-XRxTe2xO3fPWHowN_QiegYxQ_nJ6";
export const SHORTS_CHANNEL_URL = "https://www.youtube.com/@BetaByJ/shorts";

export interface YouTubePlayer {
	playVideo(): void;
	pauseVideo(): void;
	mute(): void;
	unMute(): void;
	isMuted(): boolean;
	getVolume(): number;
	getPlayerState(): number;
	getCurrentTime(): number;
	getPlaylistIndex(): number;
	getPlaylist(): string[];
	getVideoData(): { video_id?: string } | undefined;
	loadPlaylist(options: {
		list: string;
		listType: "playlist";
		index: number;
		startSeconds: number;
	}): void;
	cuePlaylist(options: {
		list: string;
		listType: "playlist";
		index: number;
		startSeconds: number;
	}): void;
	setLoop(loop: boolean): void;
	setShuffle(shuffle: boolean): void;
	nextVideo(): void;
	previousVideo(): void;
	destroy(): void;
}

interface PlayerOptions {
	width: string;
	height: string;
	playerVars: Record<string, string | number>;
	events: {
		onReady(event: { target: YouTubePlayer }): void;
		onStateChange(event: { target: YouTubePlayer; data: number }): void;
		onError(event: { data: number }): void;
		onAutoplayBlocked(): void;
	};
}

interface YouTubeAPI {
	Player: new (element: HTMLElement, options: PlayerOptions) => YouTubePlayer;
}

declare global {
	interface Window {
		YT?: YouTubeAPI;
		onYouTubeIframeAPIReady?: () => void;
	}
}

let loading: Promise<YouTubeAPI> | undefined;

/** Requested only after the TV is discovered. Failed loads can be retried. */
export function loadYouTube(): Promise<YouTubeAPI> {
	if (window.YT?.Player) return Promise.resolve(window.YT);
	if (loading) return loading;
	loading = new Promise<YouTubeAPI>((resolve, reject) => {
		const script = document.createElement("script");
		const previous = window.onYouTubeIframeAPIReady;
		const fail = () => {
			clearTimeout(timer);
			script.remove();
			window.onYouTubeIframeAPIReady = previous;
			reject(new Error("YouTube could not be reached."));
		};
		const timer = window.setTimeout(fail, 15000);
		window.onYouTubeIframeAPIReady = () => {
			clearTimeout(timer);
			window.onYouTubeIframeAPIReady = previous;
			previous?.();
			if (window.YT?.Player) resolve(window.YT);
			else fail();
		};
		script.src = "https://www.youtube.com/iframe_api";
		script.async = true;
		script.onerror = fail;
		document.head.append(script);
	}).catch((error: unknown) => {
		loading = undefined;
		throw error;
	});
	return loading;
}
