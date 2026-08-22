import { COOKIE_NAME } from "../shared/const.js";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { getSessionCookieOptions } from "./_core/cookies";
import { sendSignerInvitation } from "./invitation-mail";
import {
  acceptSignerInvitation,
  createCaptureForSigner,
  createSignerInvitation,
  deleteSignerSession,
  getSignerFromSessionToken,
  signInSigner,
} from "./signer-service";
import { extractBearerToken } from "./signer-security";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";
import { getWorkflowConfig } from "./workflow-config";

export const appRouter = router({
  // if you need to use socket.io, read and register route in server/_core/index.ts, all api should start with '/api/' so that the gateway can route correctly
  system: systemRouter,
  auth: router({
    me: publicProcedure.query((opts) => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return {
        success: true,
      } as const;
    }),
  }),
  workflow: router({
    getConfig: publicProcedure.query(() => getWorkflowConfig()),
  }),
  signer: router({
    me: publicProcedure.query(async ({ ctx }) => {
      const token = extractBearerToken(ctx.req.headers.authorization);
      return token ? getSignerFromSessionToken(token) : null;
    }),
    signIn: publicProcedure
      .input(z.object({ email: z.string().email().max(320), password: z.string().min(1).max(256) }))
      .mutation(async ({ input }) => {
        try {
          return await signInSigner(input);
        } catch {
          throw new TRPCError({ code: "UNAUTHORIZED", message: "Email or password is incorrect." });
        }
      }),
    acceptInvitation: publicProcedure
      .input(z.object({ token: z.string().min(20).max(256), password: z.string().min(12).max(128) }))
      .mutation(async ({ input }) => {
        try {
          return await acceptSignerInvitation(input);
        } catch (error) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: error instanceof Error ? error.message : "The invitation could not be accepted.",
          });
        }
      }),
    signOut: publicProcedure.mutation(async ({ ctx }) => {
      const token = extractBearerToken(ctx.req.headers.authorization);
      if (token) await deleteSignerSession(token);
      return { success: true } as const;
    }),
  }),
  internalAdmin: router({
    inviteSigner: publicProcedure
      .input(z.object({ email: z.string().email().max(320), displayName: z.string().trim().max(160).optional() }))
      .mutation(async ({ ctx, input }) => {
        const suppliedKey = ctx.req.headers["x-internal-admin-key"];
        const expectedKey = process.env.INTERNAL_ADMIN_KEY;
        if (!expectedKey || suppliedKey !== expectedKey) {
          throw new TRPCError({ code: "FORBIDDEN", message: "Internal administrator authorization is required." });
        }
        const invitation = await createSignerInvitation(input);
        await sendSignerInvitation({
          email: invitation.signer.email,
          displayName: invitation.signer.displayName,
          token: invitation.token,
          expiresAt: invitation.expiresAt,
        });
        return { signer: invitation.signer, expiresAt: invitation.expiresAt, status: "sent" as const };
      }),
  }),
  capture: router({
    submit: publicProcedure
      .input(
        z.object({
          clientRecordedAt: z.string().datetime(),
          mimeType: z.literal("video/mp4").default("video/mp4"),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const token = extractBearerToken(ctx.req.headers.authorization);
        const signer = token ? await getSignerFromSessionToken(token) : null;
        if (!signer) throw new TRPCError({ code: "UNAUTHORIZED", message: "Sign in before submitting a capture." });
        const capture = await createCaptureForSigner({
          signerId: signer.id,
          mimeType: input.mimeType,
          clientRecordedAt: new Date(input.clientRecordedAt),
        });
        return {
          id: capture.id,
          status: "accepted" as const,
          uploadKey: capture.uploadKey,
          signerId: signer.id,
          clientRecordedAt: input.clientRecordedAt,
          message: "Capture metadata accepted for the authenticated signer.",
        };
      }),
  }),
  evaluation: router({
    next: publicProcedure.query(() => ({
      id: "initial-fixture",
      status: "ready" as const,
      englishResponse: "I would like to learn more about this project.",
      sampleStatus: "fixture" as const,
    })),
  }),
  feedback: router({
    submit: publicProcedure
      .input(
        z.object({
          evaluationId: z.string().min(1).max(128),
          vote: z.enum(["accurate", "needs_correction"]),
          note: z.string().trim().max(280).optional(),
          createdAt: z.string().datetime(),
        }),
      )
      .mutation(({ input }) => ({
        id: crypto.randomUUID(),
        status: "accepted" as const,
        ...input,
      })),
  }),
});

export type AppRouter = typeof appRouter;
