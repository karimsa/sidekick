import { SidekickConfigOverrides } from './services/config';

declare module '@karimsa/sidekick/config' {
	export type SidekickConfig = SidekickConfigOverrides;
}
