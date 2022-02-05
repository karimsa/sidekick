import { SidekickConfigOverrides } from './services/config';

declare module 'sidekick/config' {
    export type SidekickConfig = SidekickConfigOverrides;
}
