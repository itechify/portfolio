/** Physical anchors pair camera framing with the live DOM's logical size. */
export const SCREENS = {
	about: {
		anchorName: "about_screen_anchor",
		pixelWidth: 560,
		pixelHeight: 480,
	},
	shorts: { anchorName: "tv_screen_anchor", pixelWidth: 360, pixelHeight: 640 },
} as const;
