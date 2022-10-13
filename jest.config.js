module.exports = {
	clearMocks: true,
	collectCoverage: true,
	coverageDirectory: 'coverage',
	coverageProvider: 'babel',
	testMatch: ['**/__tests__/**/*.spec.[jt]s?(x)'],
	transform: {
		'^.+\\.tsx?$': 'esbuild-jest',
	},
};
