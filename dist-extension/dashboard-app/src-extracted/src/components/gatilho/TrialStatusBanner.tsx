import { AlertTriangle, Clock } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import type { AuthProfile } from "@/services/supabaseRest";

const TRIAL_DURATION_MS = 24 * 60 * 60 * 1000;

function getTrialEndsAt(profile: AuthProfile) {
  const explicitEnd = profile.trial_ends_at
    ? new Date(profile.trial_ends_at).getTime()
    : Number.POSITIVE_INFINITY;
  const createdAt = profile.created_at ? new Date(String(profile.created_at)) : null;
  if (!createdAt || Number.isNaN(createdAt.getTime())) {
    return Number.isFinite(explicitEnd) ? new Date(explicitEnd) : null;
  }
  return new Date(Math.min(explicitEnd, createdAt.getTime() + TRIAL_DURATION_MS));
}

function formatCountdown(milliseconds: number) {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds].map((value) => String(value).padStart(2, "0")).join(":");
}

export function TrialStatusBanner({ profile }: { profile: AuthProfile }) {
  const role = String(profile.role || "").toLowerCase();
  const isUnlimited = role === "admin" || role === "dev";
  const trialEndsAt = getTrialEndsAt(profile);
  const subscriptionEndsAt = profile.subscription_ends_at
    ? new Date(profile.subscription_ends_at)
    : null;
  const [now, setNow] = useState(() => Date.now());
  const trialRemainingMs = trialEndsAt ? trialEndsAt.getTime() - now : 0;
  const isTrial = profile.status === "trial" && trialRemainingMs > 0;
  const isExpired =
    profile.status === "past_due" ||
    (profile.status === "trial" && trialRemainingMs <= 0) ||
    (profile.status === "active" &&
      subscriptionEndsAt &&
      Number.isFinite(subscriptionEndsAt.getTime()) &&
      subscriptionEndsAt.getTime() <= now);

  useEffect(() => {
    if (!isTrial) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [isTrial]);

  if (isUnlimited || (!isTrial && !isExpired)) return null;

  if (isTrial) {
    return (
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-info/35 bg-info/10 px-4 py-3 text-info">
        <div className="flex min-w-0 items-start gap-2.5">
          <Clock className="mt-0.5 size-4 shrink-0" />
          <div>
            <p className="text-sm font-semibold">Período de teste ativo</p>
            <p className="text-[12px] text-info/80">
              Você tem mais{" "}
              <span className="font-semibold tabular text-info">
                {formatCountdown(trialRemainingMs)}
              </span>{" "}
              de acesso gratuito.
            </p>
          </div>
        </div>
        <Link
          to="/assinatura"
          className="shrink-0 rounded-md bg-info px-3 py-1.5 text-[12px] font-semibold text-info-foreground transition-opacity hover:opacity-90"
        >
          Ver planos
        </Link>
      </div>
    );
  }

  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-danger/35 bg-danger/10 px-4 py-3 text-danger">
      <div className="flex min-w-0 items-start gap-2.5">
        <AlertTriangle className="mt-0.5 size-4 shrink-0" />
        <div>
          <p className="text-sm font-semibold">Seu acesso está vencido</p>
          <p className="text-[12px] text-danger/80">
            Renove sua assinatura para continuar usando binds e disparos.
          </p>
        </div>
      </div>
      <Link
        to="/assinatura"
        className="shrink-0 rounded-md bg-danger px-3 py-1.5 text-[12px] font-semibold text-danger-foreground transition-opacity hover:opacity-90"
      >
        Renovar agora
      </Link>
    </div>
  );
}
