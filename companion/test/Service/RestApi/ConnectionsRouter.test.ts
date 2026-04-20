import { describe, test, expect } from 'vitest'
import { mockDeep } from 'vitest-mock-extended'
import express from 'express'
import Express from 'express'
import supertest from 'supertest'
import { createRestApiRouter } from '../../../lib/Service/RestApi/RestApiRouter.js'
import { RestApiTokenStoreMemory } from '../../../lib/Service/RestApi/RestApiTokenStore.js'
import type { InstanceController } from '../../../lib/Instance/Controller.js'
import type { DataUserConfig } from '../../../lib/Data/UserConfig.js'
import type { ClientConnectionConfig } from '../../../../shared-lib/lib/Model/Connections.js'
import {
	ModuleInstanceType,
	InstanceVersionUpdatePolicy,
	type InstanceConfig,
} from '../../../../shared-lib/lib/Model/Instance.js'

const mockOptions = {
	fallbackMockImplementation: () => {
		throw new Error('not mocked')
	},
}

describe('REST API v1 — Connections', () => {
	function createService() {
		const instanceController = mockDeep<InstanceController>(mockOptions)
		const userconfig = mockDeep<DataUserConfig>(mockOptions, {
			getKey: () => true,
		})

		const tokenStore = new RestApiTokenStoreMemory()

		// Create a token for tests
		const { plaintext: validToken } = tokenStore.createToken('test-token', ['read', 'write', 'execute', 'admin'])
		const { plaintext: readOnlyToken } = tokenStore.createToken('read-only', ['read'])

		const restApiRouter = createRestApiRouter(instanceController, userconfig, tokenStore)

		const app = express()
		app.use(Express.json())
		app.use('/api/v1', restApiRouter)

		return {
			app,
			instanceController,
			userconfig,
			tokenStore,
			validToken,
			readOnlyToken,
		}
	}

	function createConnectionConfigs(): Record<string, ClientConnectionConfig> {
		return {
			'conn-1': {
				id: 'conn-1',
				label: 'My OBS',
				moduleId: 'obs-websocket',
				enabled: true,
				sortOrder: 0,
				moduleType: ModuleInstanceType.Connection,
				moduleVersionId: null,
				updatePolicy: InstanceVersionUpdatePolicy.Stable,
				hasRecordActionsHandler: false,
				collectionId: null,
			},
			'conn-2': {
				id: 'conn-2',
				label: 'My ATEM',
				moduleId: 'bmd-atem',
				enabled: false,
				sortOrder: 1,
				moduleType: ModuleInstanceType.Connection,
				moduleVersionId: 'v1.2.0',
				updatePolicy: InstanceVersionUpdatePolicy.Manual,
				hasRecordActionsHandler: true,
				collectionId: 'group-a',
			},
		}
	}

	const mockStatus = { category: 'good', level: 'ok', message: 'Connected' }

	describe('authentication', () => {
		test('returns 401 without Authorization header', async () => {
			const { app } = createService()

			const res = await supertest(app).get('/api/v1/connections').send()
			expect(res.status).toBe(401)
			expect(res.body.error.code).toBe('UNAUTHORIZED')
		})

		test('returns 401 with invalid token', async () => {
			const { app } = createService()

			const res = await supertest(app)
				.get('/api/v1/connections')
				.set('Authorization', 'Bearer cpn_invalid_token')
				.send()
			expect(res.status).toBe(401)
			expect(res.body.error.code).toBe('UNAUTHORIZED')
		})

		test('returns 401 with malformed Authorization header', async () => {
			const { app } = createService()

			const res = await supertest(app).get('/api/v1/connections').set('Authorization', 'Basic abc123').send()
			expect(res.status).toBe(401)
		})
	})

	describe('scope enforcement', () => {
		test('read-only token can access GET endpoints', async () => {
			const { app, instanceController, readOnlyToken } = createService()
			instanceController.getConnectionClientJson.mockReturnValue({})

			const res = await supertest(app)
				.get('/api/v1/connections')
				.set('Authorization', `Bearer ${readOnlyToken}`)
				.send()
			expect(res.status).toBe(200)
		})

		test('read-only token gets 403 on write endpoints', async () => {
			const { app, readOnlyToken } = createService()

			const res = await supertest(app)
				.post('/api/v1/connections')
				.set('Authorization', `Bearer ${readOnlyToken}`)
				.send({ module: { type: 'obs' }, label: 'test' })
			expect(res.status).toBe(403)
			expect(res.body.error.code).toBe('FORBIDDEN')
		})

		test('read-only token gets 403 on execute endpoints', async () => {
			const { app, readOnlyToken } = createService()

			const res = await supertest(app)
				.post('/api/v1/connections/conn-1/restart')
				.set('Authorization', `Bearer ${readOnlyToken}`)
				.send()
			expect(res.status).toBe(403)
		})
	})

	describe('api disabled', () => {
		test('returns 403 when rest_api_enabled is false', async () => {
			// Create a service with REST API disabled
			const instanceController = mockDeep<InstanceController>(mockOptions)
			const userconfig = mockDeep<DataUserConfig>(mockOptions, {
				getKey: () => false,
			})

			const tokenStore = new RestApiTokenStoreMemory()
			const { plaintext: token } = tokenStore.createToken('test', ['admin'])

			const restApiRouter = createRestApiRouter(instanceController, userconfig, tokenStore)
			const app = express()
			app.use(Express.json())
			app.use('/api/v1', restApiRouter)

			const res = await supertest(app)
				.get('/api/v1/connections')
				.set('Authorization', `Bearer ${token}`)
				.send()
			expect(res.status).toBe(403)
			expect(res.body.error.code).toBe('API_DISABLED')
		})
	})

	describe('GET /connections', () => {
		test('returns paginated list of connections', async () => {
			const { app, instanceController, validToken } = createService()

			instanceController.getConnectionClientJson.mockReturnValue(createConnectionConfigs())
			instanceController.getInstanceStatus.mockImplementation((id: string) => {
				if (id === 'conn-1') return mockStatus
				return undefined
			})

			const res = await supertest(app)
				.get('/api/v1/connections')
				.set('Authorization', `Bearer ${validToken}`)
				.send()

			expect(res.status).toBe(200)
			expect(res.body.data).toHaveLength(2)
			expect(res.body.meta).toEqual({ total: 2, limit: 2, offset: 0 })

			expect(res.body.data[0]).toEqual({
				id: 'conn-1',
				label: 'My OBS',
				moduleId: 'obs-websocket',
				moduleVersionId: null,
				updatePolicy: 'stable',
				enabled: true,
				sortOrder: 0,
				collectionId: null,
				status: mockStatus,
			})

			expect(res.body.data[1]).toEqual({
				id: 'conn-2',
				label: 'My ATEM',
				moduleId: 'bmd-atem',
				moduleVersionId: 'v1.2.0',
				updatePolicy: 'manual',
				enabled: false,
				sortOrder: 1,
				collectionId: 'group-a',
				status: null,
			})
		})

		test('returns empty array when no connections', async () => {
			const { app, instanceController, validToken } = createService()

			instanceController.getConnectionClientJson.mockReturnValue({})

			const res = await supertest(app)
				.get('/api/v1/connections')
				.set('Authorization', `Bearer ${validToken}`)
				.send()

			expect(res.status).toBe(200)
			expect(res.body.data).toEqual([])
			expect(res.body.meta).toEqual({ total: 0, limit: 0, offset: 0 })
		})

		test('strips extra fields from response via Zod (e.g. hasRecordActionsHandler)', async () => {
			const { app, instanceController, validToken } = createService()

			instanceController.getConnectionClientJson.mockReturnValue(createConnectionConfigs())
			instanceController.getInstanceStatus.mockReturnValue(undefined)

			const res = await supertest(app)
				.get('/api/v1/connections')
				.set('Authorization', `Bearer ${validToken}`)
				.send()

			expect(res.status).toBe(200)
			// hasRecordActionsHandler and moduleType should NOT appear in response
			for (const conn of res.body.data) {
				expect(conn).not.toHaveProperty('hasRecordActionsHandler')
				expect(conn).not.toHaveProperty('moduleType')
			}
		})
	})

	describe('GET /connections/:connectionId', () => {
		test('returns a single connection', async () => {
			const { app, instanceController, validToken } = createService()

			instanceController.getConnectionClientJson.mockReturnValue(createConnectionConfigs())
			instanceController.getInstanceStatus.mockReturnValue(mockStatus)

			const res = await supertest(app)
				.get('/api/v1/connections/conn-1')
				.set('Authorization', `Bearer ${validToken}`)
				.send()

			expect(res.status).toBe(200)
			expect(res.body.data).toEqual({
				id: 'conn-1',
				label: 'My OBS',
				moduleId: 'obs-websocket',
				moduleVersionId: null,
				updatePolicy: 'stable',
				enabled: true,
				sortOrder: 0,
				collectionId: null,
				status: mockStatus,
			})
		})

		test('returns 404 for unknown connection', async () => {
			const { app, instanceController, validToken } = createService()

			instanceController.getConnectionClientJson.mockReturnValue(createConnectionConfigs())

			const res = await supertest(app)
				.get('/api/v1/connections/unknown-id')
				.set('Authorization', `Bearer ${validToken}`)
				.send()

			expect(res.status).toBe(404)
			expect(res.body.error.code).toBe('NOT_FOUND')
		})
	})

	describe('POST /connections', () => {
		test('creates a new connection', async () => {
			const { app, instanceController, validToken } = createService()

			const newConfig: InstanceConfig = {
				moduleInstanceType: ModuleInstanceType.Connection,
				moduleId: 'obs-websocket',
				moduleVersionId: 'v2.0.0',
				label: 'New OBS',
				config: {},
				secrets: undefined,
				isFirstInit: true,
				lastUpgradeIndex: 0,
				enabled: true,
				sortOrder: 2,
				updatePolicy: InstanceVersionUpdatePolicy.Stable,
			}

			instanceController.addConnectionWithLabel.mockReturnValue(['new-id', newConfig])
			instanceController.getConnectionClientJson.mockReturnValue({
				'new-id': {
					id: 'new-id',
					label: 'New OBS',
					moduleId: 'obs-websocket',
					moduleVersionId: 'v2.0.0',
					updatePolicy: InstanceVersionUpdatePolicy.Stable,
					enabled: true,
					sortOrder: 2,
					moduleType: ModuleInstanceType.Connection,
					hasRecordActionsHandler: false,
					collectionId: null,
				},
			})
			instanceController.getInstanceStatus.mockReturnValue(undefined)

			const res = await supertest(app)
				.post('/api/v1/connections')
				.set('Authorization', `Bearer ${validToken}`)
				.send({
					module: { type: 'obs-websocket' },
					label: 'New OBS',
					versionId: 'v2.0.0',
				})

			expect(res.status).toBe(201)
			expect(res.headers.location).toBe('/api/v1/connections/new-id')
			expect(res.body.data.id).toBe('new-id')
			expect(res.body.data.label).toBe('New OBS')
			expect(res.body.data.moduleId).toBe('obs-websocket')
			expect(res.body.data).not.toHaveProperty('hasRecordActionsHandler')

			expect(instanceController.addConnectionWithLabel).toHaveBeenCalledTimes(1)
			expect(instanceController.addConnectionWithLabel).toHaveBeenCalledWith(
				{ type: 'obs-websocket' },
				'New OBS',
				{
					versionId: 'v2.0.0',
					updatePolicy: InstanceVersionUpdatePolicy.Stable,
					disabled: false,
				}
			)
		})

		test('returns 400 for invalid body', async () => {
			const { app, validToken } = createService()

			const res = await supertest(app)
				.post('/api/v1/connections')
				.set('Authorization', `Bearer ${validToken}`)
				.send({ invalid: true })

			expect(res.status).toBe(400)
			expect(res.body.error.code).toBe('BAD_REQUEST')
		})

		test('returns 400 when addConnectionWithLabel throws', async () => {
			const { app, instanceController, validToken } = createService()

			instanceController.addConnectionWithLabel.mockImplementation(() => {
				throw new Error('Module not found')
			})

			const res = await supertest(app)
				.post('/api/v1/connections')
				.set('Authorization', `Bearer ${validToken}`)
				.send({
					module: { type: 'nonexistent' },
					label: 'test',
				})

			expect(res.status).toBe(400)
			expect(res.body.error.message).toBe('Module not found')
		})
	})

	describe('PATCH /connections/:connectionId', () => {
		test('updates connection label', async () => {
			const { app, instanceController, validToken } = createService()

			instanceController.getConnectionClientJson.mockReturnValueOnce(createConnectionConfigs())
			instanceController.setConnectionLabelAndConfig.mockReturnValue({ ok: true })

			const updatedConfigs = createConnectionConfigs()
			updatedConfigs['conn-1'].label = 'Renamed OBS'
			instanceController.getConnectionClientJson.mockReturnValueOnce(updatedConfigs)
			instanceController.getInstanceStatus.mockReturnValue(mockStatus)

			const res = await supertest(app)
				.patch('/api/v1/connections/conn-1')
				.set('Authorization', `Bearer ${validToken}`)
				.send({ label: 'Renamed OBS' })

			expect(res.status).toBe(200)
			expect(res.body.data.label).toBe('Renamed OBS')

			expect(instanceController.setConnectionLabelAndConfig).toHaveBeenCalledWith('conn-1', {
				label: 'Renamed OBS',
				enabled: null,
				config: null,
				secrets: null,
				updatePolicy: null,
				upgradeIndex: null,
			})
		})

		test('updates connection enabled state', async () => {
			const { app, instanceController, validToken } = createService()

			instanceController.getConnectionClientJson.mockReturnValueOnce(createConnectionConfigs())
			instanceController.setConnectionLabelAndConfig.mockReturnValue({ ok: true })

			const updatedConfigs = createConnectionConfigs()
			updatedConfigs['conn-1'].enabled = false
			instanceController.getConnectionClientJson.mockReturnValueOnce(updatedConfigs)
			instanceController.getInstanceStatus.mockReturnValue(undefined)

			const res = await supertest(app)
				.patch('/api/v1/connections/conn-1')
				.set('Authorization', `Bearer ${validToken}`)
				.send({ enabled: false })

			expect(res.status).toBe(200)
			expect(res.body.data.enabled).toBe(false)
		})

		test('returns 404 for unknown connection', async () => {
			const { app, instanceController, validToken } = createService()

			instanceController.getConnectionClientJson.mockReturnValue(createConnectionConfigs())

			const res = await supertest(app)
				.patch('/api/v1/connections/unknown-id')
				.set('Authorization', `Bearer ${validToken}`)
				.send({ label: 'test' })

			expect(res.status).toBe(404)
		})

		test('returns 400 when setConnectionLabelAndConfig fails', async () => {
			const { app, instanceController, validToken } = createService()

			instanceController.getConnectionClientJson.mockReturnValue(createConnectionConfigs())
			instanceController.setConnectionLabelAndConfig.mockReturnValue({ ok: false, message: 'duplicate label' })

			const res = await supertest(app)
				.patch('/api/v1/connections/conn-1')
				.set('Authorization', `Bearer ${validToken}`)
				.send({ label: 'duplicate' })

			expect(res.status).toBe(400)
			expect(res.body.error.message).toBe('duplicate label')
		})

		test('returns 400 for invalid body', async () => {
			const { app, instanceController, validToken } = createService()

			instanceController.getConnectionClientJson.mockReturnValue(createConnectionConfigs())

			const res = await supertest(app)
				.patch('/api/v1/connections/conn-1')
				.set('Authorization', `Bearer ${validToken}`)
				.send({ enabled: 'not-a-boolean' })

			expect(res.status).toBe(400)
			expect(res.body.error.code).toBe('BAD_REQUEST')
		})
	})

	describe('DELETE /connections/:connectionId', () => {
		test('deletes a connection', async () => {
			const { app, instanceController, validToken } = createService()

			instanceController.getConnectionClientJson.mockReturnValue(createConnectionConfigs())
			instanceController.removeConnection.mockResolvedValue(undefined)

			const res = await supertest(app)
				.delete('/api/v1/connections/conn-1')
				.set('Authorization', `Bearer ${validToken}`)
				.send()

			expect(res.status).toBe(204)
			expect(instanceController.removeConnection).toHaveBeenCalledWith('conn-1')
		})

		test('returns 404 for unknown connection', async () => {
			const { app, instanceController, validToken } = createService()

			instanceController.getConnectionClientJson.mockReturnValue(createConnectionConfigs())

			const res = await supertest(app)
				.delete('/api/v1/connections/unknown-id')
				.set('Authorization', `Bearer ${validToken}`)
				.send()

			expect(res.status).toBe(404)
		})
	})

	describe('POST /connections/:connectionId/restart', () => {
		test('triggers restart for existing enabled connection', async () => {
			const { app, instanceController, validToken } = createService()

			instanceController.getConnectionClientJson.mockReturnValue(createConnectionConfigs())
			instanceController.restartConnection.mockReturnValue(true)

			const res = await supertest(app)
				.post('/api/v1/connections/conn-1/restart')
				.set('Authorization', `Bearer ${validToken}`)
				.send()

			expect(res.status).toBe(200)
			expect(res.body.data).toEqual({ id: 'conn-1', message: 'Restart triggered' })
			expect(instanceController.restartConnection).toHaveBeenCalledWith('conn-1')
		})

		test('returns 409 for inactive connection', async () => {
			const { app, instanceController, validToken } = createService()

			instanceController.getConnectionClientJson.mockReturnValue(createConnectionConfigs())
			instanceController.restartConnection.mockReturnValue(false)

			const res = await supertest(app)
				.post('/api/v1/connections/conn-2/restart')
				.set('Authorization', `Bearer ${validToken}`)
				.send()

			expect(res.status).toBe(409)
			expect(res.body.error.code).toBe('CONFLICT')
		})

		test('returns 404 for unknown connection', async () => {
			const { app, instanceController, validToken } = createService()

			instanceController.getConnectionClientJson.mockReturnValue(createConnectionConfigs())

			const res = await supertest(app)
				.post('/api/v1/connections/unknown-id/restart')
				.set('Authorization', `Bearer ${validToken}`)
				.send()

			expect(res.status).toBe(404)
		})
	})

	describe('unknown endpoint', () => {
		test('returns 404 for unmatched routes', async () => {
			const { app, validToken } = createService()

			const res = await supertest(app)
				.get('/api/v1/nonexistent')
				.set('Authorization', `Bearer ${validToken}`)
				.send()

			expect(res.status).toBe(404)
			expect(res.body.error.code).toBe('NOT_FOUND')
		})
	})
})
