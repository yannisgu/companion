import Express from 'express'
import { requireScope } from '../RestApiAuth.js'
import { RestApiError } from '../errors.js'
import { successResponse, collectionResponse } from '../schemas/common.js'
import {
	ConnectionCreateBodySchema,
	ConnectionPatchBodySchema,
	type ConnectionResponse,
} from '../schemas/connections.js'
import type { InstanceController } from '../../../Instance/Controller.js'
import { InstanceVersionUpdatePolicy } from '@companion-app/shared/Model/Instance.js'
import type { Logger } from '../../../Log/Controller.js'

/**
 * Create the connections router for /api/v1/connections
 */
export function createConnectionsRouter(logger: Logger, instanceController: InstanceController): Express.Router {
	const router = Express.Router()

	/**
	 * GET /connections — List all connections with config + status
	 */
	router.get('/', requireScope('read'), (_req, res) => {
		const clientConnections = instanceController.getConnectionClientJson(true)

		const connections: ConnectionResponse[] = Object.entries(clientConnections).map(([id, config]) => {
			const status = instanceController.getInstanceStatus(id)
			return {
				id,
				label: config.label,
				moduleId: config.moduleId,
				moduleVersionId: config.moduleVersionId,
				updatePolicy: config.updatePolicy,
				enabled: config.enabled,
				sortOrder: config.sortOrder,
				collectionId: config.collectionId,
				status: status ?? null,
			}
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

		try {
			const [id, config] = instanceController.addConnectionWithLabel(module, label, {
				versionId: versionId ?? null,
				updatePolicy: InstanceVersionUpdatePolicy.Stable,
				disabled: enabled === false,
			})

			const status = instanceController.getInstanceStatus(id)

			const response: ConnectionResponse = {
				id,
				label: config.label,
				moduleId: config.moduleId,
				moduleVersionId: config.moduleVersionId,
				updatePolicy: config.updatePolicy,
				enabled: config.enabled,
				sortOrder: config.sortOrder,
				collectionId: config.collectionId ?? null,
				status: status ?? null,
			}

			logger.info(`REST API: Created connection "${label}" (${id})`)
			res.status(201).location(`/api/v1/connections/${id}`).json(successResponse(response))
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

		const response: ConnectionResponse = {
			id: connectionId,
			label: config.label,
			moduleId: config.moduleId,
			moduleVersionId: config.moduleVersionId,
			updatePolicy: config.updatePolicy,
			enabled: config.enabled,
			sortOrder: config.sortOrder,
			collectionId: config.collectionId,
			status: status ?? null,
		}

		res.json(successResponse(response))
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

		const { label, enabled, config, updatePolicy } = parsed.data

		const result = instanceController.setConnectionLabelAndConfig(connectionId, {
			label: label ?? null,
			enabled: enabled ?? null,
			config: config ?? null,
			secrets: null,
			updatePolicy: updatePolicy ?? null,
			upgradeIndex: null,
		})

		if (!result.ok) {
			next(RestApiError.badRequest(result.message))
			return
		}

		// Re-fetch updated data
		const updatedConnections = instanceController.getConnectionClientJson(false)
		const updatedConfig = updatedConnections[connectionId]
		const status = instanceController.getInstanceStatus(connectionId)

		const response: ConnectionResponse = {
			id: connectionId,
			label: updatedConfig.label,
			moduleId: updatedConfig.moduleId,
			moduleVersionId: updatedConfig.moduleVersionId,
			updatePolicy: updatedConfig.updatePolicy,
			enabled: updatedConfig.enabled,
			sortOrder: updatedConfig.sortOrder,
			collectionId: updatedConfig.collectionId,
			status: status ?? null,
		}

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
