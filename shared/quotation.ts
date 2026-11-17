import { z } from "zod";

export const quotationResponseInputSchema = z.object({
  quotationId: z.number().int().positive(),
  quotedPriceCents: z.number().int().positive(),
  sellerNote: z.string().max(600).optional(),
  status: z.enum(["responded", "declined"]),
});
