import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  LEGAL_EFFECTIVE_DATE,
  legalDocuments,
  type LegalDocumentKind,
} from "@/content/legal";

type LegalDocumentDialogProps = {
  document: LegalDocumentKind | null;
  onOpenChange(open: boolean): void;
};

export function LegalDocumentDialog({ document, onOpenChange }: LegalDocumentDialogProps) {
  const content = document ? legalDocuments[document] : null;

  return (
    <Dialog open={document !== null} onOpenChange={onOpenChange}>
      {content ? (
        <DialogContent className="flex max-h-[85vh] h-[85vh] w-[min(92vw,760px)] max-w-3xl flex-col gap-0 overflow-hidden p-0">
          <DialogHeader className="shrink-0 border-b border-border px-6 py-5 pr-12">
            <DialogTitle>{content.title}</DialogTitle>
            <DialogDescription>
              Versão {content.version} · vigente desde {LEGAL_EFFECTIVE_DATE}
            </DialogDescription>
          </DialogHeader>
          <div className="flex-1 min-h-0 overflow-y-auto px-6 py-5 text-sm leading-6 text-muted-foreground">
            <article className="space-y-6">
              <p className="font-medium text-foreground">{content.introduction}</p>
              {content.sections.map((section) => (
                <section key={section.title}>
                  <h3 className="mb-2 font-semibold text-foreground">{section.title}</h3>
                  {section.paragraphs?.map((paragraph) => (
                    <p key={paragraph} className="mb-2 last:mb-0">
                      {paragraph}
                    </p>
                  ))}
                  {section.bullets ? (
                    <ul className="list-disc space-y-1.5 pl-5">
                      {section.bullets.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  ) : null}
                </section>
              ))}
            </article>
          </div>
        </DialogContent>
      ) : null}
    </Dialog>
  );
}

