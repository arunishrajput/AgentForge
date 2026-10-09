-- ---------------------------------------------------------------------------
-- Phase 41 — personal access tokens.
--
-- **One new table, additive, nothing altered.** The previous revision never reads it and keeps
-- serving correctly while this is applied. `access_token` holds only `sha256(token)` (D192) — the
-- plaintext exists once, in the response that creates it.
--
-- Rollback: `rollback_0019.sql`. Past it an older revision answers a bearer request 401 and has no
-- token routes; every script using a token stops working until the revision is rolled forward.
-- ---------------------------------------------------------------------------
CREATE TABLE "access_token" (
	"id" text PRIMARY KEY NOT NULL,
	"workspaceId" text NOT NULL,
	"userId" text NOT NULL,
	"name" text NOT NULL,
	"role" text NOT NULL,
	"tokenHash" text NOT NULL,
	"hint" text NOT NULL,
	"expiresAt" timestamp with time zone NOT NULL,
	"lastUsedAt" timestamp with time zone,
	"revokedAt" timestamp with time zone,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "access_token_tokenHash_unique" UNIQUE("tokenHash")
);
--> statement-breakpoint
ALTER TABLE "access_token" ADD CONSTRAINT "access_token_workspaceId_workspace_id_fk" FOREIGN KEY ("workspaceId") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_token" ADD CONSTRAINT "access_token_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "access_token_owner_idx" ON "access_token" USING btree ("workspaceId","userId","createdAt");