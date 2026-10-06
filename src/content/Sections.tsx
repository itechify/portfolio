import { type ReactNode, type RefObject, useEffect, useRef } from "react";
import type { SectionId, StationId } from "../stations";

interface SectionDef {
	id: SectionId;
	title: string;
	body: ReactNode;
}

const REPO = "https://github.com/itechify/portfolio";

/** Placeholder content. Replace the bodies; keep the ids, they match STATIONS. */
export const SECTIONS: readonly SectionDef[] = [
	{
		id: "about",
		title: "About",
		body: (
			<>
				<p>
					Hi, I'm Jeffrey (JJ) Davis, a software engineer at Moebius Solutions.
					I build web apps, games, and AI-powered projects. Check them out in
					the projects section!
				</p>
			</>
		),
	},
	{
		id: "projects",
		title: "Projects",
		body: (
			<ul className="cards">
				<li>
					<h3>JJ's Creamery</h3>
					<p>
						This site. An immersive 3D portfolio built from a scripted Blender
						model with baked lighting, rendered with React Three Fiber.
					</p>
					<p className="tags">
						Three.js · React Three Fiber · Blender · TypeScript
					</p>
					<a href={REPO}>Source on GitHub</a>
				</li>
			</ul>
		),
	},
	{
		id: "resume",
		title: "Resume",
		body: (
			<p>
				<strong>Placeholder.</strong> A resume PDF will be linked here for
				download.
			</p>
		),
	},
	{
		id: "contact",
		title: "Contact",
		body: (
			<ul>
				<li>
					<a href="https://github.com/itechify">GitHub</a>
				</li>
				<li>
					<a href="https://www.linkedin.com/in/jeffrey-davis-9b0656187/">
						LinkedIn
					</a>
				</li>
			</ul>
		),
	},
	{
		id: "credits",
		title: "Credits",
		body: (
			<ul>
				<li>
					Concept inspired by{" "}
					<a href="https://www.jessezhou.com/">Jesse Zhou's "Jesse's Ramen"</a>.
				</li>
				<li>
					Shop design inspired by the pixel art of{" "}
					<a href="https://www.youtube.com/@BJGPixel">
						Brandon James Greer (BJGPixel)
					</a>
					.
				</li>
				<li>Built with Three.js, React Three Fiber, drei, and Blender.</li>
			</ul>
		),
	},
];

interface Props {
	current: StationId;
	/** When true, render every Section visibly as a plain page (no WebGL). */
	plain?: boolean;
	aboutSurface?: RefObject<HTMLElement | null>;
	aboutReady?: boolean;
	focusHeading?: boolean;
	narrow?: boolean;
	onClose: () => void;
}

/**
 * All Section content is always in the document so crawlers and screen readers
 * get the whole site; only the active Station's Section is visible (ADR 0002).
 */
export function Sections({
	current,
	plain = false,
	onClose,
	aboutSurface,
	aboutReady = false,
	focusHeading = true,
	narrow = false,
}: Props) {
	const main = useRef<HTMLElement>(null);
	const focused = useRef<StationId | null>(null);
	useEffect(() => {
		if (focused.current !== current) focused.current = null;
		if (
			plain ||
			!focusHeading ||
			focused.current === current ||
			(current === "about" && !aboutReady)
		)
			return;
		main.current
			?.querySelector<HTMLElement>(`#${current} h2`)
			?.focus({ preventScroll: true });
		focused.current = current;
	}, [current, plain, aboutReady, focusHeading]);
	const projected = current === "about" && !plain && !narrow;
	return (
		<main
			ref={main}
			className={
				plain
					? "sections plain"
					: `sections${projected ? " sections--projected" : ""}`
			}
		>
			{SECTIONS.map((s) => {
				const active = plain || s.id === current;
				return (
					<section
						ref={s.id === "about" ? aboutSurface : undefined}
						key={s.id}
						id={s.id}
						className={`section${active ? "" : " section--inactive"}${s.id === "about" && projected ? " section--screen" : ""}`}
						aria-labelledby={`${s.id}-title`}
						aria-hidden={active ? undefined : true}
						inert={!active}
					>
						<h2 id={`${s.id}-title`} className="pixel" tabIndex={-1}>
							{s.title}
						</h2>
						{s.body}
						{!plain && (
							<button type="button" className="pixel close" onClick={onClose}>
								Back to the street
							</button>
						)}
					</section>
				);
			})}
		</main>
	);
}
