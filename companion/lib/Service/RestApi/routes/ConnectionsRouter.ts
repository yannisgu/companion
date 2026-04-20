import Express from 'express'
import z from 'zod'
import { requireScope } from '../RestApiAuth.js'
import { RestApiError } from '../errors.js'
import {
	successResponse,
	collectionResponse,
	createSuccessSchema,
	createCollectionSchema,
	ErrorResponseSchema,
} from '../schemas/common.js'
import {
	ConnectionResponseSchema,
	ConnectionCreateBodySchema,
	ConnectionPatchBodySchema,
	buildConnectionResponse,
} from '../schemas/connections.js'
import { registry } from '../registry.js'
import type { InstanceController } from '../../../Instance/Controller.js'
import { InstanceVersionUpdatePolicy, ModuleInstanceType } from '@companion-app/shared/Model/Instance.js'
import type { Logger } from '../../../Log/Controller.js'

/**
 * Create the connections router for /api/connections/v1
 */
export function createConnectionsRouter(logger: Logger, instanceController: InstanceController): Express.Router {
	const router = Express.Router()

	/**
	 * GET /connections — List all connections with config + status
	 */
	router.get('/', requireScope('read'), (_req, res) => {
		const clientConnections = instanceController.getConnectionClientJson(true)

		const connections = Object.entries(clientConnections).map(([id, config]) => {
			const status = instanceController.getInstanceStatus(id)
			return buildConnectionResponse(id, config, status)
		})

		res.json(collectionResponse(connections, { total: connections.length, limit: connections.length, offset: 0 }))
	})

	/**
	 * POST /connections — Create a new connection
	 */
	router.post('/', requireScope('write'), (req, res, next) => {
		const parsed = ConnectionCreateBodySchema.safeParse(req.body)
		if (!parsed.success) {
			next(RestApiError.badRequest('Invalid request body', parsed.error.format()))
			return
		}

		const { module, label, versionId, enabled } = parsed.data

		// Validate the module exists before attempting to create
		if (!instanceController.modules.hasModule(ModuleInstanceType.Connection, module.type)) {
			next(RestApiError.badRequest(`Unknown module type: "${module.type}"`))
			return
		}

		// Validate the specific version exists if provided
		if (versionId) {
			const versionInfo = instanceController.modules.getModuleManifest(
				ModuleInstanceType.Connection,
				module.type,
				versionId
			)
			if (!versionInfo) {
				next(RestApiError.badRequest(`Unknown version "${versionId}" for module "${module.type}"`))
				return
			}
		}

		try {
			const [id] = instanceController.addConnectionWithLabel(module, label, {
				versionId: versionId ?? null,
				updatePolicy: InstanceVersionUpdatePolicy.Stable,
				disabled: enabled === false,
			})

			// Re-fetch from client JSON so response goes through the same path as GET
			const clientConnections = instanceController.getConnectionClientJson(false)
			const config = clientConnections[id]
			const status = instanceController.getInstanceStatus(id)
			const response = buildConnectionResponse(id, config, status)

			logger.info(`REST API: Created connection "${label}" (${id})`)
			res.status(201).location(`/api/connections/v1/${id}`).json(successResponse(response))
		} catch (e: any) {
			next(RestApiError.badRequest(e.message || 'Failed to create connection'))
		}
	})

	/**
	 * GET /connections/:connectionId — Get one connection (config + status)
	 */
	router.get('/:connectionId', requireScope('read'), (req, res, next) => {
		const { connectionId } = req.params
		const clientConnections = instanceController.getConnectionClientJson(true)
		const config = clientConnections[connectionId]

		if (!config) {
			next(RestApiError.notFound('Connection not found'))
			return
		}

		const status = instanceController.getInstanceStatus(connectionId)
		res.json(successResponse(buildConnectionResponse(connectionId, config, status)))
	})

	/**
	 * PATCH /connections/:connectionId — Partial update (merge fields)
	 */
	router.patch('/:connectionId', requireScope('write'), (req, res, next) => {
		const { connectionId } = req.params

		const clientConnections = instanceController.getConnectionClientJson(true)
		if (!clientConnections[connectionId]) {
			next(RestApiError.notFound('Connection not found'))
			return
		}

		const parsed = ConnectionPatchBodySchema.safeParse(req.body)
		if (!parsed.success) {
			next(RestApiError.badRequest('Invalid request body', parsed.error.format()))
			return
		}

		const { label, enabled, config, secrets, updatePolicy } = parsed.data

		// Merge config with existing (partial update semantics)
		let mergedConfig: unknown | null = null
		if (config) {
			const existing = instanceController.getInstanceConfigOfType(connectionId, ModuleInstanceType.Connection)
			mergedConfig = { ...((existing?.config as Record<string, unknown>) ?? {}), ...config }
		}

		const result = instanceController.setConnectionLabelAndConfig(
			connectionId,
			{
				label: label ?? null,
				enabled: enabled ?? null,
				config: mergedConfig,
				secrets: secrets ?? null,
				updatePolicy: updatePolicy ?? null,
				upgradeIndex: null,
			},
			{ patchSecrets: true }
		)

		if (!result.ok) {
			next(RestApiError.badRequest(result.message))
			return
		}

		// Re-fetch updated data
		const updatedConnections = instanceController.getConnectionClientJson(false)
		const updatedConfig = updatedConnections[connectionId]
		const status = instanceController.getInstanceStatus(connectionId)
		const response = buildConnectionResponse(connectionId, updatedConfig, status)

		logger.info(`REST API: Updated connection "${response.label}" (${connectionId})`)
		res.json(successResponse(response))
	})

	/**
	 * DELETE /connections/:connectionId — Delete a connection
	 */
	router.delete('/:connectionId', requireScope('write'), async (req, res, next) => {
		const { connectionId } = req.params

		const clientConnections = instanceController.getConnectionClientJson(true)
		if (!clientConnections[connectionId]) {
			next(RestApiError.notFound('Connection not found'))
			return
		}

		await instanceController.removeConnection(connectionId)

		logger.info(`REST API: Deleted connection ${connectionId}`)
		res.status(204).send()
	})

	/**
	 * POST /connections/:connectionId/restart — Restart connection process
	 */
	router.post('/:connectionId/restart', requireScope('execute'), (req, res, next) => {
		const { connectionId } = req.params

		const clientConnections = instanceController.getConnectionClientJson(true)
		if (!clientConnections[connectionId]) {
			next(RestApiError.notFound('Connection not found'))
			return
		}

		const result = instanceController.restartConnection(connectionId)
		if (!result) {
			next(RestApiError.conflict('Connection is inactive and cannot be restarted'))
			return
		}

		logger.info(`REST API: Restarted connection ${connectionId}`)
		res.json(successResponse({ id: connectionId, message: 'Restart triggered' }))
	})

	return router
}

const connectionIdParam = z.object({ connectionId: z.string() })

const errorResponses = {
	400: { description: 'Bad request', content: { 'application/json': { schema: ErrorResponseSchema } } },
	401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorResponseSchema } } },
	403: { description: 'Forbidden', content: { 'application/json': { schema: ErrorResponseSchema } } },
	404: { description: 'Not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
}

/**
 * Register all /connections paths in the OpenAPI registry.
 * Called once at startup before the spec is generated.
 */
export function registerConnectionPaths(): void {
	registry.registerPath({
		method: 'get',
		path: '/connections/v1',
		tags: ['Connections'],
		summary: 'List all connections',
		description: 'Returns all connections with their configuration and current status.',
		security: [{ bearerAuth: [] }],
		responses: {
			200: {
				description: 'List of connections',
				content: { 'application/json': { schema: createCollectionSchema(ConnectionResponseSchema) } },
			},
			...errorResponses,
		},
	})

	registry.registerPath({
		method: 'post',
		path: '/connections/v1',
		tags: ['Connections'],
		summary: 'Create a connection',
		description: 'Create a new connection instance for a given module type.',
		security: [{ bearerAuth: [] }],
		request: {
			body: { content: { 'application/json': { schema: ConnectionCreateBodySchema } }, required: true },
		},
		responses: {
			201: {
				description: 'Connection created',
				content: { 'application/json': { schema: createSuccessSchema(ConnectionResponseSchema) } },
			},
			...errorResponses,
		},
	})

	registry.registerPath({
		method: 'get',
		path: '/connections/v1/{connectionId}',
		tags: ['Connections'],
		summary: 'Get a connection',
		description: 'Returns a single connection by ID with its configuration and current status.',
		security: [{ bearerAuth: [] }],
		request: { params: connectionIdParam },
		responses: {
			200: {
				description: 'Connection details',
				content: { 'application/json': { schema: createSuccessSchema(ConnectionResponseSchema) } },
			},
			...errorResponses,
		},
	})

	registry.registerPath({
		method: 'patch',
		path: '/connections/v1/{connectionId}',
		tags: ['Connections'],
		summary: 'Update a connection',
		description: 'Partially update a connection. Only send the fields you want to change.',
		security: [{ bearerAuth: [] }],
		request: {
			params: connectionIdParam,
			body: { content: { 'application/json': { schema: ConnectionPatchBodySchema } }, required: true },
		},
		responses: {
			200: {
				description: 'Updated connection',
				content: { 'application/json': { schema: createSuccessSchema(ConnectionResponseSchema) } },
			},
			...errorResponses,
		},
	})

	registry.registerPath({
		method: 'delete',
		path: '/connections/v1/{connectionId}',
		tags: ['Connections'],
		summary: 'Delete a connection',
		description: 'Delete a connection and all its associated configuration.',
		security: [{ bearerAuth: [] }],
		request: { params: connectionIdParam },
		responses: {
			204: { description: 'Connection deleted' },
			...errorResponses,
		},
	})

	registry.registerPath({
		method: 'post',
		path: '/connections/v1/{connectionId}/restart',
		tags: ['Connections'],
		summary: 'Restart a connection',
		description: 'Force-restart the connection process. Fails if the connection is disabled.',
		security: [{ bearerAuth: [] }],
		request: { params: connectionIdParam },
		responses: {
			200: {
				description: 'Restart triggered',
				content: {
					'application/json': {
						schema: createSuccessSchema(z.object({ id: z.string(), message: z.string() })),
					},
				},
			},
			409: {
				description: 'Connection is inactive',
				content: { 'application/json': { schema: ErrorResponseSchema } },
			},
			...errorResponses,
		},
	})
}
