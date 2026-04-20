import type Express from 'express'
import { createHash } from 'crypto'
import { RestApiError } from './errors.js'
import type { Logger } from '../../Log/Controller.js'

export type ApiTokenScope = 'read' | 'write' | 'execute' | 'admin'

export interface ApiToken {
	id: string
	name: string
	tokenHash: string
	scopes: ApiTokenScope[]
	createdAt: number
	lastUsedAt: number | null
}

/** Maps HTTP method + route semantics to the required scope */
export type RequiredScope = 'read' | 'write' | 'execute' | 'admin'

/**
 * Check if a token's scopes satisfy the required scope.
 * admin implies all scopes. write and execute each imply read.
 */
function hasScope(tokenScopes: ApiTokenScope[], required: RequiredScope): boolean {
	if (tokenScopes.includes('admin')) return true
	if (required === 'read') {
		return tokenScopes.includes('read') || tokenScopes.includes('write') || tokenScopes.includes('execute')
	}
	return tokenScopes.includes(required)
}

export interface ApiTokenStore {
	findByHash(hash: string): ApiToken | undefined
	updateLastUsed(tokenId: string): void
}

/**
 * Create Bearer token authentication middleware.
 * Extracts token from Authorization header, looks up by SHA-256 hash,
 * and attaches the token to the request.
 */
export function createAuthMiddleware(logger: Logger, tokenStore: ApiTokenStore) {
	return (req: Express.Request, _res: Express.Response, next: Express.NextFunction): void => {
		const authHeader = req.headers.authorization
		if (!authHeader || !authHeader.startsWith('Bearer ')) {
			next(RestApiError.unauthorized('Missing or invalid Authorization header'))
			return
		}

		const plainToken = authHeader.slice(7)
		const hash = createHash('sha256').update(plainToken).digest('hex')

		const token = tokenStore.findByHash(hash)
		if (!token) {
			next(RestApiError.unauthorized('Invalid API token'))
			return
		}

		// Attach token to request for scope checks
		;(req as any).apiToken = token

		// Update last used (fire-and-forget)
		tokenStore.updateLastUsed(token.id)

		logger.debug(`API request authenticated: token="${token.name}" path=${req.path}`)
		next()
	}
}

/**
 * Create scope-checking middleware for a specific required scope.
 */
export function requireScope(scope: RequiredScope) {
	return (req: Express.Request, _res: Express.Response, next: Express.NextFunction): void => {
		const token = (req as any).apiToken as ApiToken | undefined
		if (!token) {
			next(RestApiError.unauthorized())
			return
		}

		if (!hasScope(token.scopes, scope)) {
			next(RestApiError.forbidden(`Insufficient scope: requires '${scope}'`))
			return
		}

		next()
	}
}
