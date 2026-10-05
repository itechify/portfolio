import { useId, useRef, useState } from "react";
import type { QualityChoice, QualityTier } from "../scene/quality";

const choices: QualityChoice[] = ["auto", "full", "balanced", "light"];

export function QualitySelector({
	choice,
	tier,
	onChange,
}: {
	choice: QualityChoice;
	tier: QualityTier;
	onChange: (choice: QualityChoice) => void;
}) {
	const id = useId();
	const panel = useRef<HTMLDivElement>(null);
	const [open, setOpen] = useState(false);
	return (
		<div className="quality-selector">
			<button
				type="button"
				className="quality-cog"
				aria-label="Quality settings"
				title="Quality settings"
				aria-expanded={open}
				aria-controls={id}
				popoverTarget={id}
			>
				<svg
					viewBox="0 0 24 24"
					width="22"
					height="22"
					fill="none"
					stroke="currentColor"
					strokeWidth="1.6"
					strokeLinejoin="round"
					aria-hidden="true"
				>
					<path d="M9.5 2h5l.5 3 1.4.8 2.8-1 2.5 4.4-2.3 2v1.6l2.3 2-2.5 4.4-2.8-1-1.4.8-.5 3h-5l-.5-3-1.4-.8-2.8 1-2.5-4.4 2.3-2v-1.6l-2.3-2 2.5-4.4 2.8 1L9 5z" />
					<circle cx="12" cy="12" r="3.2" />
				</svg>
			</button>
			<div
				id={id}
				ref={panel}
				className="quality-options"
				popover="auto"
				onToggle={(event) => {
					const showing = event.newState === "open";
					setOpen(showing);
					if (showing)
						panel.current
							?.querySelector<HTMLInputElement>("input:checked")
							?.focus();
				}}
			>
				<fieldset>
					<legend>Quality Tier</legend>
					{choices.map((value) => (
						<label key={value}>
							<input
								type="radio"
								name={id}
								value={value}
								checked={choice === value}
								onChange={() => onChange(value)}
							/>
							{value[0].toUpperCase() + value.slice(1)}
							{value === "auto" && (
								<span className="quality-current">{tier}</span>
							)}
						</label>
					))}
				</fieldset>
			</div>
		</div>
	);
}
