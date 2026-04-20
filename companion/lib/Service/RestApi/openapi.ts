import { OpenApiGeneratorV3 } from '@asteasolutions/zod-to-openapi'
import { registry } from './registry.js'
import { registerConnectionPaths } from './routes/ConnectionsRouter.js'

/**
 * Generate the OpenAPI 3.0 JSON document from the registry.
 * All route modules register their paths before this is called.
 */
export function generateOpenApiDocument(): ReturnType<OpenApiGeneratorV3['generateDocument']> {
	// Register all route paths into the registry
	registerConnectionPaths()

	const generator = new OpenApiGeneratorV3(registry.definitions)

	return generator.generateDocument({
		openapi: '3.0.3',
		info: {
			title: 'Bitfocus Companion REST API',
			version: '1.0.0',
			description: 'REST API for programmatic configuration management of Bitfocus Companion.',
		},
		servers: [{ url: '/api/v1', description: 'REST API v1' }],
		security: [{ bearerAuth: [] }],
	})
}
