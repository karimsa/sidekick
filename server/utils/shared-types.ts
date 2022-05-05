export enum HealthStatus {
	// Zombie indicates that we got a hit on the debug/http port, but
	// we don't own the process
	zombie = 'zombie',

	// Healthy means we own the process and it is responding over http
	healthy = 'healthy',

	// Failing means that even though the processes are running, they are not
	// responding to health checks
	failing = 'failing',

	// Paused means all the dev servers belonging to this service are currently
	// paused
	paused = 'paused',

	// Partial means we found it to be partially available, where maybe
	// some of processes for this service are running
	partial = 'partial',

	// Stale means the builder isn't running, but the source code has changed
	stale = 'stale',

	// None indicates that no process was found running
	none = 'none',
}

export function isActiveStatus(healthStatus?: HealthStatus) {
	return (
		healthStatus === HealthStatus.failing ||
		healthStatus === HealthStatus.healthy ||
		healthStatus === HealthStatus.paused ||
		healthStatus === HealthStatus.partial
	);
}
