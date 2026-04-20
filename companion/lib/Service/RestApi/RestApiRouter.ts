import Express from 'express'
import swaggerUi from 'swagger-ui-express'
import { createAuthMiddleware, type ApiTokenStore } from './RestApiAuth.js'
import { restApiErrorHandler } from './middleware/errorHandler.js'
import { createConnectionsRouter } from './routes/ConnectionsRouter.js'
import { generateOpenApiDocument } from './openapi.js'
import type { InstanceController } from '../../Instance/Controller.js'
import type { DataUserConfig } from '../../Data/UserConfig.js'
import LogController from '../../Log/Controller.js'

/**
 * Create the main REST API v1 router.
 * Mounted at /api/v1/ on the admin Express app.
 */
export function createRestApiRouter(
	instanceController: InstanceController,
	userconfigController: DataUserConfig,
	tokenStore: ApiTokenStore
): Express.Router {
	const logger = LogController.createLogger('Service/RestApi')
	const router = Express.Router()

	// Check if REST API is enabled
	router.use((_req, res, next) => {
		if (userconfigController.getKey('rest_api_enabled')) {
			next()
		} else {
			res.status(403).json({
				error: {
					code: 'API_DISABLED',
					message: 'REST API is disabled',
				},
			})
		}
	})

	// OpenAPI spec and Swagger UI — served without auth
	const openApiDocument = generateOpenApiDocument()

	router.get('/openapi.json', (_req, res) => {
		res.json(openApiDocument)
	})

	router.use('/docs', swaggerUi.serve, swaggerUi.setup(openApiDocument))

	// Bearer token authentication (all routes below require a token)
	router.use(createAuthMiddleware(logger, tokenStore))

	// Mount sub-routers
	router.use('/connections', createConnectionsRouter(logger, instanceController))

	// 404 handler for unmatched routes under /api/v1
	router.use((_req, res) => {
		res.status(404).json({
			error: {
				code: 'NOT_FOUND',
				message: 'Endpoint not found',
			},
		})
	})

	// Global error handler
	router.use(restApiErrorHandler)

	return router
}
