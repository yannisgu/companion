import z from 'zod'
import { InstanceVersionUpdatePolicy } from '@companion-app/shared/Model/Instance.js'

/** Schema for connection status info */
export const ConnectionStatusSchema = z.object({
	category: z.string().nullable(),
	level: z.string().nullable(),
	message: z.string().nullable(),
})

/** Schema for a connection in API responses */
export const ConnectionResponseSchema = z.object({
	id: z.string(),
	label: z.string(),
	moduleId: z.string(),
	moduleVersionId: z.string().nullable(),
	updatePolicy: z.enum(InstanceVersionUpdatePolicy),
	enabled: z.boolean(),
	sortOrder: z.number(),
	collectionId: z.string().nullable(),
	status: ConnectionStatusSchema.nullable(),
})

/** Schema for creating a new connection */
export const ConnectionCreateBodySchema = z.object({
	module: z.object({
		type: z.string(),
		product: z.string().optional(),
	}),
	label: z.string(),
	versionId: z.string().nullable().optional(),
	enabled: z.boolean().optional(),
})

/** Schema for partially updating a connection */
export const ConnectionPatchBodySchema = z.object({
	label: z.string().optional(),
	enabled: z.boolean().optional(),
	config: z.record(z.string(), z.unknown()).optional(),
	updatePolicy: z.enum(InstanceVersionUpdatePolicy).optional(),
	collectionId: z.string().nullable().optional(),
})

export type ConnectionResponse = z.infer<typeof ConnectionResponseSchema>
export type ConnectionCreateBody = z.infer<typeof ConnectionCreateBodySchema>
export type ConnectionPatchBody = z.infer<typeof ConnectionPatchBodySchema>
