import { SidekickConfigOverrides } from './server/services/config';

declare module '@karimsa/sidekick/config' {
	export type SidekickConfig = SidekickConfigOverrides;
}
