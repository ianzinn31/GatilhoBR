import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { ShieldCheck } from "lucide-react";
import { toast } from "sonner";

import { SectionHeader } from "@/components/gatilho/primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { getAuthSummary, supabaseRequest } from "@/services/supabaseRest";

export const Route = createFileRoute("/admin-afiliados")({
  component: AdminAffiliatesPage,
});

type Row = Record<string, any>;
type TermsDraft = {
  model: "first_payment" | "fixed_months" | "recurring";
  payments: number;
  rate: number;
  regularPrice: number;
  promotionalPrice: number;
  keepPromotionalPrice: boolean;
};

const DEFAULT_TERMS: TermsDraft = {
  model: "fixed_months",
  payments: 1,
  rate: 20,
  regularPrice: 97,
  promotionalPrice: 50,
  keepPromotionalPrice: true,
};

function AdminAffiliatesPage() {
  const [authorized, setAuthorized] = useState<boolean | null>(null);
  const [applications, setApplications] = useState<Row[]>([]);
  const [affiliates, setAffiliates] = useState<Row[]>([]);
  const [terms, setTerms] = useState<Row[]>([]);
  const [draft, setDraft] = useState<TermsDraft>(DEFAULT_TERMS);
  const [selectedAffiliate, setSelectedAffiliate] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const account = await getAuthSummary();
    const role = String(account?.profile?.role || "");
    const canManage = role === "admin" || role === "dev";
    setAuthorized(canManage);
    if (!canManage) return;
    const [applicationRows, affiliateRows, termRows] = await Promise.all([
      supabaseRequest<Row[]>("/rest/v1/affiliate_applications?status=eq.pending&select=*&order=created_at.asc"),
      supabaseRequest<Row[]>("/rest/v1/affiliate_profiles?select=*&order=joined_at.desc"),
      supabaseRequest<Row[]>("/rest/v1/affiliate_terms?active=eq.true&select=*&order=created_at.desc"),
    ]);
    setApplications(applicationRows);
    setAffiliates(affiliateRows);
    setTerms(termRows);
    if (!selectedAffiliate && affiliateRows[0]) setSelectedAffiliate(affiliateRows[0].user_id);
  }, [selectedAffiliate]);

  useEffect(() => {
    void load().catch((error) => {
      setAuthorized(false);
      toast.error(error instanceof Error ? error.message : "Falha ao carregar afiliados.");
    });
  }, [load]);

  async function approve(applicationId: string) {
    setSaving(true);
    try {
      await supabaseRequest("/rest/v1/rpc/approve_affiliate_application", {
        method: "POST",
        body: JSON.stringify({
          p_application_id: applicationId,
          p_commission_model: draft.model,
          p_commission_payment_count: draft.model === "recurring" ? null : draft.payments,
          p_commission_rate: draft.rate,
          p_regular_price: draft.regularPrice,
          p_promotional_price: draft.promotionalPrice,
          p_keep_promotional_price: draft.keepPromotionalPrice,
        }),
      });
      toast.success("Afiliado aprovado e link principal criado.");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível aprovar.");
    } finally {
      setSaving(false);
    }
  }

  async function updateTerms() {
    if (!selectedAffiliate) return;
    setSaving(true);
    try {
      await supabaseRequest("/rest/v1/rpc/set_affiliate_terms", {
        method: "POST",
        body: JSON.stringify({
          p_affiliate_user_id: selectedAffiliate,
          p_commission_model: draft.model,
          p_commission_payment_count: draft.model === "recurring" ? null : draft.payments,
          p_commission_rate: draft.rate,
          p_regular_price: draft.regularPrice,
          p_promotional_price: draft.promotionalPrice,
          p_keep_promotional_price: draft.keepPromotionalPrice,
          p_validation_days: 14,
          p_cookie_days: 30,
          p_minimum_withdrawal: 50,
        }),
      });
      toast.success("Nova versão das condições ativada.");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível atualizar.");
    } finally {
      setSaving(false);
    }
  }

  if (authorized === null) return <div className="h-64 animate-pulse rounded-xl bg-card" />;
  if (!authorized) {
    return (
      <div className="rounded-xl border border-danger/30 bg-danger/10 p-5">
        <h1 className="font-semibold text-danger">Acesso administrativo necessário</h1>
        <p className="mt-1 text-sm text-muted-foreground">Esta área não está disponível para esta conta.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <SectionHeader
        title="Administração de afiliados"
        description="Aprove influenciadores e versione condições comerciais sem alterar indicações antigas."
      />

      <TermsEditor draft={draft} onChange={setDraft} />

      <section className="rounded-xl border border-border bg-card p-4">
        <h2 className="text-sm font-semibold">Solicitações pendentes ({applications.length})</h2>
        <div className="mt-3 space-y-2">
          {applications.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhuma solicitação pendente.</p>
          ) : applications.map((application) => (
            <article key={application.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-surface p-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{application.display_name}</p>
                <p className="text-xs text-muted-foreground">
                  {application.main_channel} · {application.audience_estimate || "audiência não informada"}
                </p>
              </div>
              <Button disabled={saving} onClick={() => void approve(application.id)}>
                <ShieldCheck className="size-4" /> Aprovar com estas condições
              </Button>
            </article>
          ))}
        </div>
      </section>

      <section className="rounded-xl border border-border bg-card p-4">
        <h2 className="text-sm font-semibold">Alterar condições de um afiliado ativo</h2>
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <div className="min-w-64 flex-1">
            <Label className="mb-1 block text-xs">Afiliado</Label>
            <Select value={selectedAffiliate} onValueChange={setSelectedAffiliate}>
              <SelectTrigger><SelectValue placeholder="Escolha o afiliado" /></SelectTrigger>
              <SelectContent>
                {affiliates.map((affiliate) => {
                  const activeTerms = terms.find((item) => item.affiliate_user_id === affiliate.user_id);
                  return (
                    <SelectItem key={affiliate.user_id} value={affiliate.user_id}>
                      {affiliate.display_name} · {activeTerms?.commission_rate ?? 0}% · versão {activeTerms?.version ?? "—"}
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          </div>
          <Button disabled={saving || !selectedAffiliate} onClick={() => void updateTerms()}>
            Salvar nova versão
          </Button>
        </div>
      </section>
    </div>
  );
}

function TermsEditor({ draft, onChange }: { draft: TermsDraft; onChange: (value: TermsDraft) => void }) {
  const patch = (partial: Partial<TermsDraft>) => onChange({ ...draft, ...partial });
  return (
    <section className="rounded-xl border border-primary/30 bg-primary/5 p-4">
      <h2 className="text-sm font-semibold">Condições a aplicar</h2>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <div>
          <Label className="mb-1 block text-xs">Modelo</Label>
          <Select value={draft.model} onValueChange={(value) => patch({ model: value as TermsDraft["model"] })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="first_payment">Somente 1º pagamento</SelectItem>
              <SelectItem value="fixed_months">Quantidade de pagamentos</SelectItem>
              <SelectItem value="recurring">Enquanto estiver ativo</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <NumberField label="Pagamentos" value={draft.payments} disabled={draft.model !== "fixed_months"} onChange={(payments) => patch({ payments })} />
        <NumberField label="Comissão (%)" value={draft.rate} onChange={(rate) => patch({ rate })} />
        <NumberField label="Preço cheio (R$)" value={draft.regularPrice} onChange={(regularPrice) => patch({ regularPrice })} />
        <NumberField label="Preço pelo link (R$)" value={draft.promotionalPrice} onChange={(promotionalPrice) => patch({ promotionalPrice })} />
      </div>
      <div className="mt-3 flex items-center gap-2">
        <Switch checked={draft.keepPromotionalPrice} onCheckedChange={(keepPromotionalPrice) => patch({ keepPromotionalPrice })} />
        <span className="text-xs text-muted-foreground">Manter o preço do link enquanto a assinatura permanecer ativa</span>
      </div>
    </section>
  );
}

function NumberField({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string;
  value: number;
  disabled?: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <div>
      <Label className="mb-1 block text-xs">{label}</Label>
      <Input type="number" min={0} disabled={disabled} value={value} onChange={(event) => onChange(Number(event.target.value))} />
    </div>
  );
}

