import { createHash, randomBytes } from 'crypto'
import { nanoid } from 'nanoid'
import type { ApiToken, ApiTokenScope, ApiTokenStore } from './RestApiAuth.js'
import LogController from '../../Log/Controller.js'

const TOKEN_PREFIX = 'cpn_'

/**
 * In-memory token store for the REST API prototype.
 * In production this would be backed by SQLite (api_tokens table).
 */
export class RestApiTokenStoreMemory implements ApiTokenStore {
	readonly #logger = LogController.createLogger('Service/RestApi/TokenStore')
	readonly #tokens: Map<string, ApiToken> = new Map() // keyed by token hash

	/**
	 * Create a new API token. Returns the plaintext token (shown only once).
	 */
	createToken(name: string, scopes: ApiTokenScope[]): { token: ApiToken; plaintext: string } {
		const id = nanoid()
		const rawBytes = randomBytes(32).toString('hex')
		const plaintext = `${TOKEN_PREFIX}${rawBytes}`
		const tokenHash = createHash('sha256').update(plaintext).digest('hex')

		const token: ApiToken = {
			id,
			name,
			tokenHash,
			scopes,
			createdAt: Date.now(),
			lastUsedAt: null,
		}

		this.#tokens.set(tokenHash, token)
		this.#logger.info(`Created API token "${name}" (id=${id})`)

		return { token, plaintext }
	}

	/**
	 * Find a token by its SHA-256 hash.
	 */
	findByHash(hash: string): ApiToken | undefined {
		return this.#tokens.get(hash)
	}

	/**
	 * Update the lastUsedAt timestamp for a token.
	 */
	updateLastUsed(tokenId: string): void {
		for (const token of this.#tokens.values()) {
			if (token.id === tokenId) {
				token.lastUsedAt = Date.now()
				break
			}
		}
	}

	/**
	 * List all tokens (without hashes).
	 */
	listTokens(): Omit<ApiToken, 'tokenHash'>[] {
		return Array.from(this.#tokens.values()).map(({ tokenHash: _hash, ...rest }) => rest)
	}

	/**
	 * Delete a token by ID.
	 */
	deleteToken(tokenId: string): boolean {
		for (const [hash, token] of this.#tokens.entries()) {
			if (token.id === tokenId) {
				this.#tokens.delete(hash)
				this.#logger.info(`Deleted API token "${token.name}" (id=${tokenId})`)
				return true
			}
		}
		return false
	}
}
