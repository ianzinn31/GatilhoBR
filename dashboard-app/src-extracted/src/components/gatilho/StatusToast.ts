import { toast } from "sonner";

/**
 * Feedback padronizado. Nenhuma ação importante deve parecer silenciosa.
 */
export const statusToast = {
  bindForwarded(key: string, target: string) {
    toast.info(`Bind ${key} encaminhada`, { description: target });
  },
  bindExecuted(key: string, target: string) {
    toast.success(`Bind ${key} executada`, { description: target });
  },
  blocked(reason: string) {
    toast.warning("Ação bloqueada", { description: reason });
  },
  success(title: string, description?: string) {
    toast.success(title, { description });
  },
  error(title: string, description?: string) {
    toast.error(title, { description });
  },
  info(title: string, description?: string) {
    toast(title, { description });
  },
};
