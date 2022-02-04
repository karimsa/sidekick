import { routes } from '../../utils/http';
import { getConfig, updateConfig } from './config';
import { getExtensions, runExtensionMethod } from './extensions';
import { getServers } from './servers';

export default routes({
    getConfig,
    updateConfig,

    getExtensions,
    runExtensionMethod,

    getServers
});
