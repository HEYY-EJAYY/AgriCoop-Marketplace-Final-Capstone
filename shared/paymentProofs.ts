export const PAYMENT_PROOF_CONTENT_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export const PAYMENT_PROOF_BUCKET = "payment-proofs";
export const PAYMENT_PROOF_MAX_BYTES = 5 * 1024 * 1024;

export { matchesImageContentTypeSignature as matchesPaymentProofImageSignature } from "./imageValidation";
