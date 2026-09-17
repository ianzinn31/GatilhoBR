import { useState } from "react";
import { CheckCircle2, Clock, Rocket } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { CHANNEL_LABEL } from "@/lib/affiliate-format";
import { formatCurrency } from "@/lib/format";
import { formatPercent } from "@/lib/affiliate-format";
import type {
  AffiliateApplicationInput,
  AffiliateProfile,
  AffiliateProgramRules,
  PromotionChannel,
} from "@/types/affiliate";
import { PanelCard } from "./shared";

const CHANNELS: PromotionChannel[] = [
  "instagram",
  "whatsapp",
  "telegram",
  "youtube",
  "tiktok",
  "facebook",
  "x",
  "site",
  "other",
];

const AUDIENCES = [
  "Menos de 1.000",
  "1.000 a 5.000",
  "5.000 a 20.000",
  "20.000 a 100.000",
  "Mais de 100.000",
];

export function AffiliateOnboarding({
  profile,
  rules,
  submitting,
  onApply,
}: {
  profile: AffiliateProfile;
  rules: AffiliateProgramRules | null;
  submitting: boolean;
  onApply: (input: AffiliateApplicationInput) => void;
}) {
  const [form, setForm] = useState<AffiliateApplicationInput>({
    displayName: "",
    mainChannel: "instagram",
    channelUrl: "",
    audienceEstimate: AUDIENCES[1],
    promotionPlan: "",
    acceptedTerms: false,
  });

  if (profile.status === "pending") {
    return (
      <PanelCard title="Cadastro em análise">
        <div className="flex flex-col items-center gap-2 py-8 text-center">
          <Clock className="size-8 text-odds" aria-hidden />
          <p className="text-sm font-semibold text-foreground">Sua solicitação está em análise</p>
          <p className="max-w-md text-xs text-muted-foreground">
            {profile.statusReason ??
              "Retornamos em até 2 dias úteis. Você receberá o código de afiliado e o link individual assim que for aprovado."}
          </p>
        </div>
      </PanelCard>
    );
  }

  const valid =
    form.displayName.trim().length >= 2 &&
    form.channelUrl.trim().length >= 4 &&
    form.promotionPlan.trim().length >= 10 &&
    form.acceptedTerms;

  return (
    <div className="space-y-3">
      <PanelCard
        title="Programa de Afiliados GatilhoBR"
        description="Indique o painel, acompanhe cada clique e receba comissão recorrente."
      >
        <div className="grid gap-2.5 sm:grid-cols-3">
          {[
            {
              icon: <Rocket className="size-4" />,
              title: "Comissão recorrente",
              text: rules
                ? `${formatPercent(rules.commissionRate, 0)} sobre cada mensalidade paga pelo indicado.`
                : "Comissão recorrente sobre cada mensalidade.",
            },
            {
              icon: <CheckCircle2 className="size-4" />,
              title: "Métricas transparentes",
              text: "Cliques, cadastros, conversões e extrato de comissões em tempo real.",
            },
            {
              icon: <Clock className="size-4" />,
              title: "Saque rápido",
              text: rules
                ? `A partir de ${formatCurrency(rules.minWithdrawal)}, pago via Pix em até ${rules.payoutEtaDays} dias úteis.`
                : "Saque via Pix após validação.",
            },
          ].map((item) => (
            <div key={item.title} className="rounded-lg border border-border bg-surface p-3">
              <div className="flex items-center gap-2 text-primary">{item.icon}</div>
              <p className="mt-1.5 text-sm font-semibold text-foreground">{item.title}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">{item.text}</p>
            </div>
          ))}
        </div>
      </PanelCard>

      <PanelCard title="Solicitar participação">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Label htmlFor="aff-name">Nome ou nome comercial</Label>
            <Input
              id="aff-name"
              maxLength={80}
              value={form.displayName}
              onChange={(event) => setForm({ ...form, displayName: event.target.value })}
            />
          </div>
          <div>
            <Label>Principal canal de divulgação</Label>
            <Select
              value={form.mainChannel}
              onValueChange={(value) => setForm({ ...form, mainChannel: value as PromotionChannel })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CHANNELS.map((channel) => (
                  <SelectItem key={channel} value={channel}>
                    {CHANNEL_LABEL[channel]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="aff-url">Perfil ou URL do canal</Label>
            <Input
              id="aff-url"
              maxLength={200}
              placeholder="https://"
              value={form.channelUrl}
              onChange={(event) => setForm({ ...form, channelUrl: event.target.value })}
            />
          </div>
          <div>
            <Label>Estimativa de audiência</Label>
            <Select
              value={form.audienceEstimate}
              onValueChange={(value) => setForm({ ...form, audienceEstimate: value })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {AUDIENCES.map((audience) => (
                  <SelectItem key={audience} value={audience}>
                    {audience}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="aff-plan">Como pretende divulgar</Label>
            <Textarea
              id="aff-plan"
              rows={3}
              maxLength={600}
              placeholder="Descreva os formatos e a frequência de divulgação."
              value={form.promotionPlan}
              onChange={(event) => setForm({ ...form, promotionPlan: event.target.value })}
            />
          </div>
          <label className="flex items-start gap-2 text-xs text-muted-foreground sm:col-span-2">
            <Checkbox
              checked={form.acceptedTerms}
              onCheckedChange={(value) => setForm({ ...form, acceptedTerms: value === true })}
              className="mt-0.5"
            />
            <span>
              Li e aceito os termos do programa, incluindo as regras de divulgação responsável e a
              política antifraude e de autoindicação.
            </span>
          </label>
        </div>

        <Button
          className="mt-3"
          disabled={!valid || submitting}
          onClick={() => onApply(form)}
        >
          {submitting ? "Enviando…" : "Enviar solicitação"}
        </Button>
      </PanelCard>
    </div>
  );
}
