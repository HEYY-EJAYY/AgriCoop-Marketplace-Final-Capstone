import { z } from "zod";

const userMappingSchema = z.object({
  legacyUserId: z.string().regex(/^[1-9]\d*$/),
  legacyRole: z.string().trim().min(1),
  targetAuthUserId: z.string().uuid().nullable(),
  mappingStatus: z.enum(["approved", "unresolved"]),
  verificationSource: z.string().trim().min(1).nullable(),
  approvedBy: z.string().trim().min(1).nullable(),
}).superRefine((mapping, context) => {
  const isApproved = mapping.mappingStatus === "approved";
  if (isApproved && (!mapping.targetAuthUserId || !mapping.verificationSource || !mapping.approvedBy)) {
    context.addIssue({
      code: "custom",
      message: "Approved user mappings require an Auth UUID, verification source, and approver.",
    });
  }
  if (!isApproved && mapping.targetAuthUserId !== null) {
    context.addIssue({
      code: "custom",
      message: "Unresolved user mappings must not contain a target Auth UUID.",
    });
  }
});

const cooperativeMappingSchema = z.object({
  legacyCooperativeId: z.string().regex(/^[1-9]\d*$/),
  targetCooperativeId: z.string().uuid().nullable(),
  mappingStatus: z.enum(["approved", "unresolved"]),
  verificationSource: z.string().trim().min(1).nullable(),
  approvedBy: z.string().trim().min(1).nullable(),
}).superRefine((mapping, context) => {
  const isApproved = mapping.mappingStatus === "approved";
  if (isApproved && (!mapping.targetCooperativeId || !mapping.verificationSource || !mapping.approvedBy)) {
    context.addIssue({
      code: "custom",
      message: "Approved cooperative mappings require a target UUID, verification source, and approver.",
    });
  }
  if (!isApproved && mapping.targetCooperativeId !== null) {
    context.addIssue({
      code: "custom",
      message: "Unresolved cooperative mappings must not contain a target UUID.",
    });
  }
});

export const migrationCrosswalkSchema = z.object({
  version: z.literal(1),
  users: z.array(userMappingSchema),
  cooperatives: z.array(cooperativeMappingSchema),
}).superRefine((crosswalk, context) => {
  const legacyUserIds = new Set<string>();
  const authUserIds = new Set<string>();
  for (const [index, mapping] of crosswalk.users.entries()) {
    if (legacyUserIds.has(mapping.legacyUserId)) {
      context.addIssue({
        code: "custom",
        path: ["users", index, "legacyUserId"],
        message: "Legacy user IDs must be unique.",
      });
    }
    legacyUserIds.add(mapping.legacyUserId);
    if (mapping.targetAuthUserId) {
      if (authUserIds.has(mapping.targetAuthUserId)) {
        context.addIssue({
          code: "custom",
          path: ["users", index, "targetAuthUserId"],
          message: "An Auth UUID cannot be assigned to multiple legacy users.",
        });
      }
      authUserIds.add(mapping.targetAuthUserId);
    }
  }

  const legacyCooperativeIds = new Set<string>();
  const targetCooperativeIds = new Set<string>();
  for (const [index, mapping] of crosswalk.cooperatives.entries()) {
    if (legacyCooperativeIds.has(mapping.legacyCooperativeId)) {
      context.addIssue({
        code: "custom",
        path: ["cooperatives", index, "legacyCooperativeId"],
        message: "Legacy cooperative IDs must be unique.",
      });
    }
    legacyCooperativeIds.add(mapping.legacyCooperativeId);
    if (mapping.targetCooperativeId) {
      if (targetCooperativeIds.has(mapping.targetCooperativeId)) {
        context.addIssue({
          code: "custom",
          path: ["cooperatives", index, "targetCooperativeId"],
          message: "A target cooperative UUID cannot be assigned to multiple legacy cooperatives.",
        });
      }
      targetCooperativeIds.add(mapping.targetCooperativeId);
    }
  }
});

export type MigrationCrosswalk = z.infer<typeof migrationCrosswalkSchema>;

export function parseMigrationCrosswalk(input: unknown): MigrationCrosswalk {
  return migrationCrosswalkSchema.parse(input);
}

export function summarizeMigrationCrosswalk(crosswalk: MigrationCrosswalk) {
  return {
    users: {
      total: crosswalk.users.length,
      approved: crosswalk.users.filter(mapping => mapping.mappingStatus === "approved").length,
      unresolved: crosswalk.users.filter(mapping => mapping.mappingStatus === "unresolved").length,
    },
    cooperatives: {
      total: crosswalk.cooperatives.length,
      approved: crosswalk.cooperatives.filter(mapping => mapping.mappingStatus === "approved").length,
      unresolved: crosswalk.cooperatives.filter(mapping => mapping.mappingStatus === "unresolved").length,
    },
  };
}
