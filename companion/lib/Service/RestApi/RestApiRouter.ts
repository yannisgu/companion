import Express from 'express'
import swaggerUi from 'swagger-ui-express'
import { createAuthMiddleware, type ApiTokenStore } from './RestApiAuth.js'
import { restApiErrorHandler } from './middleware/errorHandler.js'
import { createConnectionsRouter } from './routes/ConnectionsRouter.js'
import { generateOpenApiDocument } from './openapi.js'
import type { InstanceController } from '../../Instance/Controller.js'
import LogController from '../../Log/Controller.js'

/**
 * Create the main REST API router.
 * Mounted at /api/ on the admin Express app.
 * Each resource type is versioned independently: /api/connections/v1/, /api/pages/v1/, etc.
 *
 * Only created when the REST API is enabled at startup (checked in RestApiService).
 */
export function createRestApiRouter(instanceController: InstanceController, tokenStore: ApiTokenStore): Express.Router {
	const logger = LogController.createLogger('Service/RestApi')
	const router = Express.Router()

	// OpenAPI spec and Swagger UI — served without auth
	const openApiDocument = generateOpenApiDocument()

	router.get('/openapi.json', (_req, res) => {
		res.json(openApiDocument)
	})

	router.use('/docs', swaggerUi.serve, swaggerUi.setup(openApiDocument))

	// Bearer token authentication (all routes below require a token)
	router.use(createAuthMiddleware(logger, tokenStore))

	// Mount resource routers — each versioned independently
	router.use('/connections/v1', createConnectionsRouter(logger, instanceController))

	// 404 handler for unmatched routes under /api
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
