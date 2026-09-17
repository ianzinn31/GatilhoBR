import { useState } from "react";
import { Download, Eye, Image as ImageIcon, Info, Type } from "lucide-react";
import { toast } from "sonner";

import { EmptyState } from "@/components/gatilho/primitives";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CHANNEL_LABEL, MATERIAL_FORMAT_LABEL, formatDate } from "@/lib/affiliate-format";
import { copyText } from "@/services/affiliateBridge";
import type {
  MaterialFormat,
  PromotionChannel,
  PromotionalMaterial,
  ReferralLink,
} from "@/types/affiliate";
import { CopyButton, DemoDataBadge, LoadingRows, PanelCard, PseudoQrCode, StatusPill } from "./shared";

const FORMATS: MaterialFormat[] = [
  "banner",
  "story",
  "square",
  "text",
  "description",
  "logo",
  "qr_code",
  "script",
];

const TEXT_FORMATS: MaterialFormat[] = ["text", "description", "script"];

export function MaterialsLibrary({
  materials,
  loading,
  links,
}: {
  materials: PromotionalMaterial[];
  loading: boolean;
  links: ReferralLink[];
}) {
  const [format, setFormat] = useState<MaterialFormat | "all">("all");
  const [channel, setChannel] = useState<PromotionChannel | "all">("all");
  const [campaignId, setCampaignId] = useState(links[0]?.id ?? "");
  const [preview, setPreview] = useState<PromotionalMaterial | null>(null);

  const activeLink = links.find((link) => link.id === campaignId) ?? links[0];
  const visible = materials.filter((material) => {
    if (format !== "all" && material.format !== format) return false;
    if (channel !== "all" && !material.channels.includes(channel)) return false;
    return true;
  });

  const channelOptions = Array.from(
    new Set(materials.flatMap((material) => material.channels)),
  );

  function resolveText(material: PromotionalMaterial) {
    return (material.text ?? "").replace("{{link}}", activeLink?.url ?? "");
  }

  return (
    <PanelCard
      title="Materiais de divulgação"
      description="Textos e artes prontos, já com o link da campanha selecionada."
      actions={<DemoDataBadge />}
    >
      <div className="mb-3 grid gap-2 sm:grid-cols-3">
        <Select value={format} onValueChange={(value) => setFormat(value as MaterialFormat | "all")}>
          <SelectTrigger className="h-9">
            <SelectValue placeholder="Formato" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os formatos</SelectItem>
            {FORMATS.map((item) => (
              <SelectItem key={item} value={item}>
                {MATERIAL_FORMAT_LABEL[item]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={channel}
          onValueChange={(value) => setChannel(value as PromotionChannel | "all")}
        >
          <SelectTrigger className="h-9">
            <SelectValue placeholder="Canal" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os canais</SelectItem>
            {channelOptions.map((item) => (
              <SelectItem key={item} value={item}>
                {CHANNEL_LABEL[item]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={campaignId} onValueChange={setCampaignId}>
          <SelectTrigger className="h-9">
            <SelectValue placeholder="Campanha do link" />
          </SelectTrigger>
          <SelectContent>
            {links.map((link) => (
              <SelectItem key={link.id} value={link.id}>
                {link.campaignName}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <p className="mb-3 flex items-start gap-1.5 rounded-md border border-border bg-surface px-3 py-2 text-[11px] text-muted-foreground">
        <Info className="mt-0.5 size-3 shrink-0" aria-hidden />
        Os materiais devem respeitar as regras da marca e de publicidade responsável: sem promessa
        de lucro, sempre com aviso de conteúdo para maiores de 18 anos.
      </p>

      {loading ? (
        <LoadingRows rows={4} />
      ) : visible.length === 0 ? (
        <EmptyState title="Nenhum material neste filtro" />
      ) : (
        <ul className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
          {visible.map((material) => {
            const isText = TEXT_FORMATS.includes(material.format);
            return (
              <li
                key={material.id}
                className="flex flex-col rounded-lg border border-border bg-surface p-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="min-w-0 truncate text-sm font-medium text-foreground">
                    {material.title}
                  </span>
                  <StatusPill label={MATERIAL_FORMAT_LABEL[material.format]} tone="info" />
                </div>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  {material.dimensions ? `${material.dimensions} · ` : ""}
                  {material.channels.map((item) => CHANNEL_LABEL[item]).join(", ")} · atualizado em{" "}
                  {formatDate(material.updatedAt)}
                </p>

                {isText ? (
                  <p className="mt-2 line-clamp-3 rounded-md border border-border bg-card p-2 text-[11px] text-muted-foreground">
                    {resolveText(material)}
                  </p>
                ) : (
                  <div className="mt-2 flex h-24 items-center justify-center rounded-md border border-border bg-card text-muted-foreground">
                    {material.format === "qr_code" ? (
                      <PseudoQrCode value={activeLink?.url ?? ""} size={80} />
                    ) : (
                      <ImageIcon className="size-6" aria-hidden />
                    )}
                  </div>
                )}

                <div className="mt-2.5 flex flex-wrap gap-1.5">
                  <Button size="sm" variant="outline" onClick={() => setPreview(material)}>
                    <Eye className="size-4" />
                    Visualizar
                  </Button>
                  {isText ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        void copyText(resolveText(material)).then((ok) =>
                          toast[ok ? "success" : "error"](
                            ok ? "Texto copiado" : "Não foi possível copiar",
                          ),
                        )
                      }
                    >
                      <Type className="size-4" />
                      Copiar texto
                    </Button>
                  ) : (
                    <Button size="sm" variant="outline" asChild>
                      <a href={material.downloadUrl ?? "#"} download>
                        <Download className="size-4" />
                        Baixar
                      </a>
                    </Button>
                  )}
                  <CopyButton
                    value={activeLink?.url ?? ""}
                    label="Copiar link da campanha"
                    size="sm"
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <Dialog open={Boolean(preview)} onOpenChange={(open) => !open && setPreview(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{preview?.title}</DialogTitle>
            <DialogDescription>
              {preview ? MATERIAL_FORMAT_LABEL[preview.format] : ""}
              {preview?.dimensions ? ` · ${preview.dimensions}` : ""}
            </DialogDescription>
          </DialogHeader>
          {preview && TEXT_FORMATS.includes(preview.format) ? (
            <p className="whitespace-pre-wrap rounded-lg border border-border bg-surface p-3 text-sm text-foreground">
              {resolveText(preview)}
            </p>
          ) : preview?.format === "qr_code" ? (
            <div className="flex justify-center">
              <PseudoQrCode value={activeLink?.url ?? ""} size={180} />
            </div>
          ) : (
            <div className="flex h-48 items-center justify-center rounded-lg border border-border bg-surface">
              <img
                src={preview?.downloadUrl ?? "./logo-gatilho.png"}
                alt={preview?.title ?? "Material de divulgação"}
                className="max-h-40 object-contain"
              />
            </div>
          )}
        </DialogContent>
      </Dialog>
    </PanelCard>
  );
}
