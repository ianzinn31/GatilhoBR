import { Link2, QrCode, ShieldCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  AFFILIATE_STATUS_LABEL,
  AFFILIATE_STATUS_TONE,
  CHANNEL_LABEL,
} from "@/lib/affiliate-format";
import type { AffiliateProfile, ReferralLink } from "@/types/affiliate";
import { CopyButton, PseudoQrCode, ShareMenu, StatusPill } from "./shared";

export function AffiliateHeader({
  profile,
  primaryLink,
  shareMessage,
  onCreateCustomLink,
}: {
  profile: AffiliateProfile;
  primaryLink: ReferralLink;
  shareMessage: string;
  onCreateCustomLink: () => void;
}) {
  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto]">
        <div className="min-w-0 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill
              label={`Afiliado ${AFFILIATE_STATUS_LABEL[profile.status].toLowerCase()}`}
              tone={AFFILIATE_STATUS_TONE[profile.status]}
            />
            <span className="text-xs text-muted-foreground">
              Canal principal: {CHANNEL_LABEL[profile.mainChannel]}
            </span>
          </div>

          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Código individual
            </span>
            <span className="odds-num text-lg font-semibold text-primary">{profile.code}</span>
          </div>

          <div>
            <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Link principal de indicação
            </span>
            <div className="mt-1 flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2">
              <Link2 className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              <span className="truncate text-xs text-foreground sm:text-sm">
                {primaryLink.url}
              </span>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <CopyButton value={primaryLink.url} variant="default" />
            <ShareMenu linkId={primaryLink.id} url={primaryLink.url} message={shareMessage} />
            <Button type="button" size="sm" variant="outline" onClick={onCreateCustomLink}>
              <QrCode className="size-4" />
              Gerar link personalizado
            </Button>
          </div>

          {profile.status === "suspended" && profile.statusReason ? (
            <p className="rounded-md border border-danger/40 bg-danger/8 px-3 py-2 text-xs text-danger">
              {profile.statusReason}
            </p>
          ) : null}
        </div>

        <div className="flex flex-col items-center gap-2 justify-self-start lg:justify-self-end">
          <PseudoQrCode value={primaryLink.url} />
          <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
            <ShieldCheck className="size-3" aria-hidden />
            QR do link principal
          </span>
        </div>
      </div>
    </section>
  );
}
