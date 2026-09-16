import { useState } from "react";
import { Pencil, Plus, Power, Share2 } from "lucide-react";

import { EmptyState } from "@/components/gatilho/primitives";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AFFILIATE_BASE_URL } from "@/data/mocks/affiliate";
import { CHANNEL_LABEL, formatDate, normalizeSlug } from "@/lib/affiliate-format";
import { formatCurrency } from "@/lib/format";
import type { PromotionChannel, ReferralLink, ReferralLinkInput } from "@/types/affiliate";
import { CopyButton, DemoDataBadge, LoadingRows, PanelCard, ShareMenu, StatusPill } from "./shared";

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

const DESTINATIONS = [
  { value: "/", label: "Página inicial" },
  { value: "/assinatura", label: "Assinatura" },
  { value: "/mercados", label: "Mercados ao vivo" },
  { value: "/binds", label: "Central de binds" },
];

const EMPTY_FORM: ReferralLinkInput = {
  campaignName: "",
  channel: "instagram",
  slug: "",
  destination: "/",
  utm: { source: "", medium: "", campaign: "", content: "" },
};

export function ReferralLinkEditor({
  open,
  onOpenChange,
  editing,
  onSubmit,
  submitting,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing: ReferralLink | null;
  onSubmit: (data: ReferralLinkInput) => void;
  submitting: boolean;
}) {
  const [form, setForm] = useState<ReferralLinkInput>(EMPTY_FORM);
  const [touchedKey, setTouchedKey] = useState<string | null>(null);

  // Reinicializa o formulário quando o diálogo abre para outro link.
  const key = editing?.id ?? "new";
  if (touchedKey !== key && open) {
    setTouchedKey(key);
    setForm(
      editing
        ? {
            campaignName: editing.campaignName,
            channel: editing.channel,
            slug: editing.slug,
            destination: editing.destination,
            utm: editing.utm ?? { source: "", medium: "", campaign: "", content: "" },
          }
        : EMPTY_FORM,
    );
  }
  if (!open && touchedKey !== null) setTouchedKey(null);

  const slug = normalizeSlug(form.slug);
  const valid = form.campaignName.trim().length >= 2 && slug.length >= 3;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? "Editar campanha" : "Novo link personalizado"}</DialogTitle>
          <DialogDescription>
            Cada campanha gera um link com métricas separadas, mantendo o mesmo afiliado.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <Label htmlFor="camp-name">Nome da campanha</Label>
            <Input
              id="camp-name"
              value={form.campaignName}
              maxLength={60}
              placeholder="Ex.: Grupo Telegram VIP"
              onChange={(event) => setForm({ ...form, campaignName: event.target.value })}
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label>Canal de divulgação</Label>
              <Select
                value={form.channel}
                onValueChange={(value) => setForm({ ...form, channel: value as PromotionChannel })}
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
              <Label>Página de destino</Label>
              <Select
                value={form.destination}
                onValueChange={(value) => setForm({ ...form, destination: value })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DESTINATIONS.map((destination) => (
                    <SelectItem key={destination.value} value={destination.value}>
                      {destination.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <Label htmlFor="camp-slug">Código ou slug personalizado</Label>
            <Input
              id="camp-slug"
              value={form.slug}
              maxLength={40}
              placeholder="GATILHO123-tg"
              onChange={(event) => setForm({ ...form, slug: event.target.value })}
            />
            <p className="mt-1 truncate text-[11px] text-muted-foreground">
              {AFFILIATE_BASE_URL}/{slug || "seu-slug"}
            </p>
          </div>

          <details className="rounded-lg border border-border bg-surface p-2.5">
            <summary className="cursor-pointer text-xs font-medium text-foreground">
              Parâmetros UTM (opcional)
            </summary>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {(["source", "medium", "campaign", "content"] as const).map((field) => (
                <div key={field}>
                  <Label htmlFor={`utm-${field}`} className="text-[11px] text-muted-foreground">
                    utm_{field}
                  </Label>
                  <Input
                    id={`utm-${field}`}
                    className="h-8"
                    maxLength={40}
                    value={form.utm?.[field] ?? ""}
                    onChange={(event) =>
                      setForm({ ...form, utm: { ...form.utm, [field]: event.target.value } })
                    }
                  />
                </div>
              ))}
            </div>
          </details>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            disabled={!valid || submitting}
            onClick={() => onSubmit({ ...form, slug })}
          >
            {submitting ? "Salvando…" : editing ? "Salvar alterações" : "Criar link"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ReferralLinksManager({
  links,
  loading,
  shareMessage,
  onCreate,
  onEdit,
  onToggle,
}: {
  links: ReferralLink[];
  loading: boolean;
  shareMessage: string;
  onCreate: () => void;
  onEdit: (link: ReferralLink) => void;
  onToggle: (link: ReferralLink) => void;
}) {
  return (
    <PanelCard
      title="Links e campanhas"
      description="Cada link tem ID próprio e métricas isoladas."
      actions={
        <>
          <DemoDataBadge />
          <Button size="sm" onClick={onCreate}>
            <Plus className="size-4" />
            Nova campanha
          </Button>
        </>
      }
    >
      {loading ? (
        <LoadingRows />
      ) : links.length === 0 ? (
        <EmptyState
          title="Nenhuma campanha criada"
          description="Crie links diferentes para medir cada canal separadamente."
          action={
            <Button size="sm" onClick={onCreate}>
              Criar primeira campanha
            </Button>
          }
        />
      ) : (
        <ul className="space-y-2.5">
          {links.map((link) => (
            <li
              key={link.id}
              className="rounded-lg border border-border bg-surface p-3 transition-colors hover:border-ring/40"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-sm font-semibold text-foreground">
                      {link.campaignName}
                    </span>
                    <StatusPill label={CHANNEL_LABEL[link.channel]} tone="info" />
                    <StatusPill
                      label={link.status === "active" ? "Ativo" : "Desativado"}
                      tone={link.status === "active" ? "ok" : "default"}
                    />
                    {link.isPrimary ? <StatusPill label="Principal" tone="odds" /> : null}
                  </div>
                  <p className="mt-1 truncate text-xs text-muted-foreground">{link.url}</p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    Criado em {formatDate(link.createdAt)} · destino {link.destination}
                  </p>
                </div>

                <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                  <CopyButton value={link.url} iconOnly label="Copiar link" />
                  <ShareMenu
                    linkId={link.id}
                    url={link.url}
                    message={shareMessage.replace("{{link}}", link.url)}
                    trigger={
                      <Button size="icon" variant="outline" aria-label="Compartilhar">
                        <Share2 className="size-4" />
                      </Button>
                    }
                  />
                  <Button
                    size="icon"
                    variant="outline"
                    aria-label="Editar campanha"
                    onClick={() => onEdit(link)}
                  >
                    <Pencil className="size-4" />
                  </Button>
                  <Button
                    size="icon"
                    variant="outline"
                    aria-label={link.status === "active" ? "Desativar link" : "Reativar link"}
                    onClick={() => onToggle(link)}
                    disabled={link.isPrimary}
                  >
                    <Power className="size-4" />
                  </Button>
                </div>
              </div>

              <dl className="mt-2.5 grid grid-cols-2 gap-2 border-t border-border pt-2.5 sm:grid-cols-4">
                {[
                  { label: "Cliques", value: link.clicks.toLocaleString("pt-BR") },
                  { label: "Cadastros", value: link.signups.toLocaleString("pt-BR") },
                  { label: "Conversões", value: link.conversions.toLocaleString("pt-BR") },
                  { label: "Comissão", value: formatCurrency(link.commission) },
                ].map((metric) => (
                  <div key={metric.label}>
                    <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">
                      {metric.label}
                    </dt>
                    <dd className="odds-num text-sm font-semibold text-foreground">
                      {metric.value}
                    </dd>
                  </div>
                ))}
              </dl>
            </li>
          ))}
        </ul>
      )}
    </PanelCard>
  );
}
