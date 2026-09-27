-- ---------------------------------------------------------------------------
-- Phase 19B — invitations.
--
-- **One new table and nothing else, which is why this is a single migration where
-- Phase 19A needed two.** Nothing existing is altered, so the previous revision — which
-- knows nothing about this table — keeps serving correctly while it is applied, and
-- there is no contract half to wait for.
--
-- The unique index is partial and it is load-bearing rather than decorative: it is what
-- makes re-inviting an address an atomic upsert that rotates the token, instead of a
-- read-then-write race that can leave two live links to one workspace. `neon-http` has
-- no transactions (D6), so an index is the only interlock available — the same argument
-- `workspace_personal_idx` is built on.
--
-- To roll back: `drizzle/rollback_0007.sql`. It drops one table that nothing else
-- references, so the rollback is genuinely reversible in a way 19A's was not.
-- ---------------------------------------------------------------------------

CREATE TABLE "workspace_invitation" (
	"id" text PRIMARY KEY NOT NULL,
	"workspaceId" text NOT NULL,
	"email" text NOT NULL,
	"role" text DEFAULT 'editor' NOT NULL,
	"tokenHash" text NOT NULL,
	"invitedBy" text,
	"expiresAt" timestamp with time zone NOT NULL,
	"acceptedAt" timestamp with time zone,
	"acceptedBy" text,
	"revokedAt" timestamp with time zone,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_invitation_tokenHash_unique" UNIQUE("tokenHash")
);
--> statement-breakpoint
ALTER TABLE "workspace_invitation" ADD CONSTRAINT "workspace_invitation_workspaceId_workspace_id_fk" FOREIGN KEY ("workspaceId") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_invitation" ADD CONSTRAINT "workspace_invitation_invitedBy_user_id_fk" FOREIGN KEY ("invitedBy") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_invitation" ADD CONSTRAINT "workspace_invitation_acceptedBy_user_id_fk" FOREIGN KEY ("acceptedBy") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_invitation_live_idx" ON "workspace_invitation" USING btree ("workspaceId","email") WHERE "workspace_invitation"."acceptedAt" is null and "workspace_invitation"."revokedAt" is null;--> statement-breakpoint
CREATE INDEX "workspace_invitation_workspace_idx" ON "workspace_invitation" USING btree ("workspaceId","createdAt");