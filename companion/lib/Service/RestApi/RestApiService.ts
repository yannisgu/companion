import type { UIExpress } from '../../UI/Express.js'
import type { InstanceController } from '../../Instance/Controller.js'
import type { DataUserConfig } from '../../Data/UserConfig.js'
import { createRestApiRouter } from './RestApiRouter.js'
import { RestApiTokenStoreMemory } from './RestApiTokenStore.js'
import LogController from '../../Log/Controller.js'

/**
 * Service class that sets up and mounts the REST API v1.
 * Creates the token store, router, and mounts on the Express app at /api/v1/.
 */
export class RestApiService {
	readonly #logger = LogController.createLogger('Service/RestApi')
	readonly tokenStore: RestApiTokenStoreMemory

	constructor(instanceController: InstanceController, userconfigController: DataUserConfig, express: UIExpress) {
		this.tokenStore = new RestApiTokenStoreMemory()

		const restApiV1Router = createRestApiRouter(instanceController, userconfigController, this.tokenStore)

		// Mount the REST API v1 router via the setter on UIExpress
		// This is registered at /api/v1 before the existing /api routes
		express.restApiV1Router = restApiV1Router

		this.#logger.info('REST API v1 mounted at /api/v1/')
	}
}
