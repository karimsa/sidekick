export const Config = {
	ServerPort:
		process.env.NODE_ENV === 'production' && global.window
			? window.location.port
			: 9010,
} as const;
