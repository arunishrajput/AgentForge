"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { api, ApiRequestError } from "@/lib/canvas/client";

/**
 * The accept button.
 *
 * A client component doing a POST rather than a server action, for one reason worth
 * stating: **accepting must never be a GET.** A page that joined a workspace as a side
 * effect of being rendered would be triggered by a link preview, an email scanner or a
 * browser prefetch — the link would be spent before the person ever clicked it. A form
 * post would be equally safe; this is a `fetch` because the accept route already exists
 * for the API surface and one code path is better than two.
 *
 * On success the route has already switched the active workspace, so this pushes to the
 * workflow list and refreshes — the header, the list and the settings page are all server
 * components reading a cookie that has just changed.
 */
export function AcceptInvitation({ token, workspace }: { token: string; workspace: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const accept = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.acceptInvitation(token);
      router.push("/workflows");
      router.refresh();
    } catch (caught) {
      setError(
        caught instanceof ApiRequestError
          ? caught.message
          : "That invitation could not be accepted.",
      );
      setBusy(false);
    }
  };

  return (
    <div className="mt-3 space-y-3">
      <Button tone="primary" size="lg" loading={busy} onClick={() => void accept()}>
        Join {workspace}
      </Button>
      {error && <Notice tone="bad" title={error} />}
    </div>
  );
}
