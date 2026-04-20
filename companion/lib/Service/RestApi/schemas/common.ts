import z from 'zod'

/** Pagination metadata in list responses */
export const PaginationMetaSchema = z.object({
	total: z.number(),
	limit: z.number(),
	offset: z.number(),
})

/** Error body schema for OpenAPI docs */
export const ErrorResponseSchema = z.object({
	error: z.object({
		code: z.string(),
		message: z.string(),
		details: z.unknown().optional(),
	}),
})

/** Create a typed single-item success envelope schema for OpenAPI docs */
// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
export function createSuccessSchema<T extends z.ZodType>(itemSchema: T) {
	return z.object({ data: itemSchema })
}

/** Create a typed collection envelope schema for OpenAPI docs */
// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
export function createCollectionSchema<T extends z.ZodType>(itemSchema: T) {
	return z.object({
		data: z.array(itemSchema),
		meta: PaginationMetaSchema,
	})
}

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
