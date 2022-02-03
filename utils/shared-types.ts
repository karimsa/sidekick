interface BaseServiceConfig {
    core?: boolean;
    name: string;
    directoryName?: string;
    processes?: Record<string, string>;
    env?: Record<string, string>;
}

export interface AppServiceConfig extends BaseServiceConfig {
    type: 'backend' | 'frontend';
    healthPath?: string;
    port: number;
    debugPort?: number;
    dependencies?: string[];
}

export interface PackageServiceConfig extends BaseServiceConfig {
    type: 'package';
}

export type ServiceConfig = AppServiceConfig | PackageServiceConfig;

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
    none = 'none'
}

export interface EventsourcedEvent {
    id: number;
    name: string;
    data: object;
    actor_id?: string;
    actor: string;
    created_at: string;
}

export interface EventsourcedTimelineEntry {
    event: EventsourcedEvent;
    remote?: EventsourcedTimelineEntry;
    logs: string;
    logsOverride: string;
    stateBefore: null | object;
    stateAfter: object;
    stateAfterOverride: object;
}
