import z from 'zod'

/** Pagination metadata in list responses */
export const PaginationMetaSchema = z.object({
	total: z.number(),
	limit: z.number(),
	offset: z.number(),
})

/** Single-item success response */
export function successResponse<T>(data: T): { data: T } {
	return { data }
}

/** Collection success response with pagination */
export function collectionResponse<T>(
	data: T[],
	meta: { total: number; limit: number; offset: number }
): { data: T[]; meta: { total: number; limit: number; offset: number } } {
	return { data, meta }
}

/** Error response envelope */
export function errorResponse(
	code: string,
	message: string,
	details?: unknown
): { error: { code: string; message: string; details?: unknown } } {
	return {
		error: {
			code,
			message,
			...(details !== undefined ? { details } : {}),
		},
	}
}
