import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { SectionHeader } from "@/components/gatilho/primitives";
import { AffiliateHeader } from "@/components/gatilho/affiliate/AffiliateHeader";
import { AffiliateOnboarding } from "@/components/gatilho/affiliate/AffiliateOnboarding";
import {
  ConversionFunnel,
  PeriodFilter,
  SummaryCards,
} from "@/components/gatilho/affiliate/AffiliateOverview";
import {
  BalanceExplainer,
  CommissionsPanel,
} from "@/components/gatilho/affiliate/CommissionsPanel";
import { MaterialsLibrary } from "@/components/gatilho/affiliate/MaterialsLibrary";
import { ProgramRules } from "@/components/gatilho/affiliate/ProgramRules";
import {
  ReferralLinkEditor,
  ReferralLinksManager,
} from "@/components/gatilho/affiliate/ReferralLinksManager";
import { ReferralsTable } from "@/components/gatilho/affiliate/ReferralsTable";
import {
  WithdrawalDialog,
  WithdrawalsPanel,
} from "@/components/gatilho/affiliate/WithdrawalsPanel";
import { ErrorState, PanelCard } from "@/components/gatilho/affiliate/shared";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { affiliateBridge } from "@/services/affiliateBridge";
import type {
  AffiliateApplicationInput,
  AffiliateProfile,
  AffiliateProgramRules,
  AffiliateSummary,
  Commission,
  CommissionStatus,
  CommissionType,
  PromotionalMaterial,
  Referral,
  ReferralLink,
  ReferralLinkInput,
  ReferralStatus,
  SummaryPeriod,
  Withdrawal,
  WithdrawalRequestInput,
} from "@/types/affiliate";

export const Route = createFileRoute("/afiliados")({
  head: () => ({
    meta: [
      { title: "Programa de Afiliados — GatilhoBR" },
      {
        name: "description",
        content:
          "Gere seu link de indicação, crie campanhas, acompanhe cliques, conversões, comissões e solicite saques no GatilhoBR.",
      },
      { property: "og:title", content: "Programa de Afiliados — GatilhoBR" },
      {
        property: "og:description",
        content: "Link individual, campanhas, comissões e saques do afiliado GatilhoBR.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: AffiliatesPage,
});

const SHARE_MESSAGE =
  "Uso o GatilhoBR para organizar mercados de jogadores ao vivo na Bet365 e Betfair com atalho de teclado. Vale conferir: {{link}}";

function AffiliatesPage() {
  const [profile, setProfile] = useState<AffiliateProfile | null>(null);
  const [rules, setRules] = useState<AffiliateProgramRules | null>(null);
  const [summary, setSummary] = useState<AffiliateSummary | null>(null);
  const [links, setLinks] = useState<ReferralLink[]>([]);
  const [referrals, setReferrals] = useState<Referral[]>([]);
  const [commissions, setCommissions] = useState<Commission[]>([]);
  const [withdrawals, setWithdrawals] = useState<Withdrawal[]>([]);
  const [materials, setMaterials] = useState<PromotionalMaterial[]>([]);

  const [period, setPeriod] = useState<SummaryPeriod>({ preset: "last_30_days" });
  const [referralStatus, setReferralStatus] = useState<ReferralStatus | "all">("all");
  const [referralLinkFilter, setReferralLinkFilter] = useState<string>("all");
  const [commissionStatus, setCommissionStatus] = useState<CommissionStatus | "all">("all");
  const [commissionType, setCommissionType] = useState<CommissionType | "all">("all");

  const [loading, setLoading] = useState(true);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [listsLoading, setListsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [editorOpen, setEditorOpen] = useState(false);
  const [editingLink, setEditingLink] = useState<ReferralLink | null>(null);
  const [savingLink, setSavingLink] = useState(false);
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);
  const [applying, setApplying] = useState(false);

  const loadBase = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [profileData, rulesData, linksData, withdrawalsData, materialsData] = await Promise.all([
        affiliateBridge.getAffiliateProfile(),
        affiliateBridge.getProgramRules(),
        affiliateBridge.getReferralLinks(),
        affiliateBridge.getWithdrawalHistory(),
        affiliateBridge.getPromotionalMaterials(),
      ]);
      setProfile(profileData);
      setRules(rulesData);
      setLinks(linksData);
      setWithdrawals(withdrawalsData);
      setMaterials(materialsData);
    } catch {
      setError("Não foi possível carregar os dados do programa de afiliados.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadBase();
  }, [loadBase]);

  useEffect(() => {
    let active = true;
    setSummaryLoading(true);
    void affiliateBridge.getAffiliateSummary(period).then((data) => {
      if (!active) return;
      setSummary(data);
      setSummaryLoading(false);
    });
    return () => {
      active = false;
    };
  }, [period]);

  useEffect(() => {
    let active = true;
    setListsLoading(true);
    void Promise.all([
      affiliateBridge.getReferrals({ status: referralStatus, linkId: referralLinkFilter }),
      affiliateBridge.getCommissions({ status: commissionStatus, type: commissionType }),
    ]).then(([referralsData, commissionsData]) => {
      if (!active) return;
      setReferrals(referralsData);
      setCommissions(commissionsData);
      setListsLoading(false);
    });
    return () => {
      active = false;
    };
  }, [referralStatus, referralLinkFilter, commissionStatus, commissionType]);

  async function handleSubmitLink(data: ReferralLinkInput) {
    setSavingLink(true);
    try {
      if (editingLink) {
        const updated = await affiliateBridge.updateReferralLink(editingLink.id, data);
        setLinks((current) => current.map((link) => (link.id === updated.id ? updated : link)));
        toast.success("Campanha atualizada");
      } else {
        const created = await affiliateBridge.createReferralLink(data);
        setLinks((current) => [...current, created]);
        toast.success("Link personalizado criado", { description: created.url });
      }
      setEditorOpen(false);
      setEditingLink(null);
    } catch {
      toast.error("Não foi possível salvar a campanha");
    } finally {
      setSavingLink(false);
    }
  }

  async function handleToggleLink(link: ReferralLink) {
    const updated = await affiliateBridge.disableReferralLink(link.id);
    setLinks((current) => current.map((item) => (item.id === updated.id ? updated : item)));
    toast.info(updated.status === "active" ? "Link reativado" : "Link desativado");
  }

  async function handleWithdraw(input: WithdrawalRequestInput) {
    setWithdrawing(true);
    try {
      const created = await affiliateBridge.requestWithdrawal(input);
      setWithdrawals((current) => [created, ...current]);
      setWithdrawOpen(false);
      toast.success("Saque solicitado", {
        description: "Acompanhe a análise e o pagamento na aba Saques.",
      });
    } catch {
      toast.error("Não foi possível solicitar o saque");
    } finally {
      setWithdrawing(false);
    }
  }

  async function handleApply(input: AffiliateApplicationInput) {
    setApplying(true);
    try {
      const updated = await affiliateBridge.applyToAffiliateProgram(input);
      setProfile(updated);
      toast.success("Solicitação enviada", { description: "Status: em análise." });
    } catch {
      toast.error("Não foi possível enviar a solicitação");
    } finally {
      setApplying(false);
    }
  }

  if (error) {
    return (
      <div className="space-y-4">
        <SectionHeader title="Programa de Afiliados" />
        <ErrorState message={error} onRetry={() => void loadBase()} />
      </div>
    );
  }

  if (loading || !profile || !rules) {
    return (
      <div className="space-y-4">
        <SectionHeader title="Programa de Afiliados" description="Carregando seus dados…" />
        <div className="h-40 animate-pulse rounded-xl bg-surface-2/60" />
        <div className="h-64 animate-pulse rounded-xl bg-surface-2/60" />
      </div>
    );
  }

  const isRegistered = profile.status === "active" || profile.status === "suspended";
  const primaryLink = links.find((link) => link.isPrimary) ?? links[0];

  return (
    <div className="space-y-4">
      <SectionHeader
        title="Programa de Afiliados"
        description="Divulgue o GatilhoBR, acompanhe indicações e receba comissões."
      />

      {!isRegistered || !primaryLink ? (
        <AffiliateOnboarding
          profile={profile}
          rules={rules}
          submitting={applying}
          onApply={(input) => void handleApply(input)}
        />
      ) : (
        <>
          <AffiliateHeader
            profile={profile}
            primaryLink={primaryLink}
            shareMessage={SHARE_MESSAGE.replace("{{link}}", primaryLink.url)}
            onCreateCustomLink={() => {
              setEditingLink(null);
              setEditorOpen(true);
            }}
          />

          <Tabs defaultValue="overview" className="space-y-3">
            <div className="-mx-1 overflow-x-auto px-1">
              <TabsList className="w-max">
                <TabsTrigger value="overview">Visão geral</TabsTrigger>
                <TabsTrigger value="links">Links e materiais</TabsTrigger>
                <TabsTrigger value="referrals">Indicações</TabsTrigger>
                <TabsTrigger value="commissions">Comissões</TabsTrigger>
                <TabsTrigger value="withdrawals">Saques</TabsTrigger>
                <TabsTrigger value="rules">Regras</TabsTrigger>
              </TabsList>
            </div>

            <TabsContent value="overview" className="space-y-3">
              <PanelCard title="Desempenho" description="Filtre o período para recalcular o resumo.">
                <PeriodFilter period={period} onChange={setPeriod} />
                <div className="mt-3">
                  <SummaryCards summary={summary} loading={summaryLoading} />
                </div>
              </PanelCard>
              <ConversionFunnel summary={summaryLoading ? null : summary} />
              <BalanceExplainer summary={summary} />
            </TabsContent>

            <TabsContent value="links" className="space-y-3">
              <ReferralLinksManager
                links={links}
                loading={false}
                shareMessage={SHARE_MESSAGE}
                onCreate={() => {
                  setEditingLink(null);
                  setEditorOpen(true);
                }}
                onEdit={(link) => {
                  setEditingLink(link);
                  setEditorOpen(true);
                }}
                onToggle={(link) => void handleToggleLink(link)}
              />
              <MaterialsLibrary materials={materials} loading={false} links={links} />
            </TabsContent>

            <TabsContent value="referrals">
              <ReferralsTable
                referrals={referrals}
                links={links}
                loading={listsLoading}
                statusFilter={referralStatus}
                linkFilter={referralLinkFilter}
                onStatusFilter={setReferralStatus}
                onLinkFilter={setReferralLinkFilter}
              />
            </TabsContent>

            <TabsContent value="commissions" className="space-y-3">
              <BalanceExplainer summary={summary} />
              <CommissionsPanel
                commissions={commissions}
                loading={listsLoading}
                statusFilter={commissionStatus}
                typeFilter={commissionType}
                onStatusFilter={setCommissionStatus}
                onTypeFilter={setCommissionType}
              />
            </TabsContent>

            <TabsContent value="withdrawals">
              <WithdrawalsPanel
                withdrawals={withdrawals}
                loading={false}
                availableBalance={summary?.availableBalance ?? 0}
                rules={rules}
                onRequest={() => setWithdrawOpen(true)}
              />
            </TabsContent>

            <TabsContent value="rules">
              <ProgramRules rules={rules} />
            </TabsContent>
          </Tabs>

          <ReferralLinkEditor
            open={editorOpen}
            onOpenChange={(open) => {
              setEditorOpen(open);
              if (!open) setEditingLink(null);
            }}
            editing={editingLink}
            submitting={savingLink}
            onSubmit={(data) => void handleSubmitLink(data)}
          />

          <WithdrawalDialog
            open={withdrawOpen}
            onOpenChange={setWithdrawOpen}
            availableBalance={summary?.availableBalance ?? 0}
            rules={rules}
            payoutMethod={profile.payoutMethod}
            submitting={withdrawing}
            onConfirm={(input) => void handleWithdraw(input)}
          />
        </>
      )}
    </div>
  );
}
