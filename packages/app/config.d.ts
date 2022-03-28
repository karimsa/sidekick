import { SidekickConfigOverrides } from './services/config';

declare module 'config' {
    export type SidekickConfig = SidekickConfigOverrides;
}
