import { useCallback } from "react";
import type { TFunction } from "i18next";
import {
  PROVIDER_LABELS,
  ollamaOrigin,
  type BatchFailureCause,
  type DeadEndKind,
  type FileFailureCause,
  type ImportNotice,
  type Sample,
} from "@capybudget/intelligence";
import { useTranslation } from "@capybudget/i18n";
import type { ImportKey } from "@/lib/i18n-keys";
import { useIntelligenceStore } from "@/stores/intelligence-store";

interface NoticeContext {
  t: TFunction<["import", "common"]>;
  ollamaBaseUrl: string;
  withDetail?: boolean;
}

type Renderers = {
  [C in ImportNotice["code"]]: (notice: Extract<ImportNotice, { code: C }>, ctx: NoticeContext) => string;
};

const FILE_CAUSE_KEYS = {
  cutOff: "run.cause.file.cutOff",
  refused: "run.cause.file.refused",
  unusable: "run.cause.file.unusable",
  pdfUnsupported: "run.cause.file.pdfUnsupported",
  noVision: "run.cause.file.noVision",
  rateLimited: "run.cause.file.rateLimited",
} as const satisfies Record<Exclude<FileFailureCause["kind"], "other">, ImportKey>;

const BATCH_CAUSE_KEYS = {
  cutOff: "run.cause.batch.cutOff",
  refused: "run.cause.batch.refused",
  unusable: "run.cause.batch.unusable",
  rateLimited: "run.cause.batch.rateLimited",
} as const satisfies Record<Exclude<BatchFailureCause["kind"], "other">, ImportKey>;

const DEAD_END_KEYS = {
  unreachable: "errors.unreachable",
  keyRejected: "errors.keyRejected",
  forbidden: "errors.forbidden",
  modelNotFound: "errors.modelNotFound",
} as const satisfies Record<DeadEndKind, ImportKey>;

function errorText(detail: string, t: NoticeContext["t"]): string {
  return detail.trim() || t("run.cause.unknown");
}

function logDetail(detail: string | undefined, { withDetail }: NoticeContext): string | undefined {
  return (withDetail && detail?.trim()) || undefined;
}

function appendDetail(text: string, detail: string | undefined, ctx: NoticeContext): string {
  const shown = logDetail(detail, ctx);
  return shown ? `${text} (${shown})` : text;
}

function fileCause(cause: FileFailureCause, ctx: NoticeContext): string {
  if (cause.kind === "other") return errorText(cause.detail, ctx.t);
  return appendDetail(ctx.t(FILE_CAUSE_KEYS[cause.kind]), "detail" in cause ? cause.detail : undefined, ctx);
}

function batchCause(cause: BatchFailureCause, ctx: NoticeContext): string {
  if (cause.kind === "other") return errorText(cause.detail, ctx.t);
  return appendDetail(ctx.t(BATCH_CAUSE_KEYS[cause.kind]), "detail" in cause ? cause.detail : undefined, ctx);
}

function sampleText({ items, more }: Sample, separator: string, t: NoticeContext["t"]): string {
  const listed = items.join(separator);
  return more > 0 ? t("run.log.sampleMore", { sample: listed, count: more }) : listed;
}

const sampleCount = ({ items, more }: Sample) => items.length + more;

const RENDERERS: Renderers = {
  "normalize.extracting": ({ params }, { t }) => t("run.status.extracting", params),
  "normalize.readingOfx": ({ params }, { t }) => t("run.status.readingOfx", params),
  "normalize.mappingColumns": ({ params }, { t }) => t("run.status.mappingColumns", params),
  "history.matching": (_, { t }) => t("run.status.matchingHistory"),
  "categorize.progress": ({ params }, { t }) => t("run.status.categorizing", params),

  "reading.files": ({ params: { files } }, { t }) => t("run.log.readFiles", { count: files.length, files }),
  "normalize.visionUnknown": (_, { t }) => t("run.log.visionUnknown"),
  "normalize.noData": ({ params: { file, detail } }, ctx) => {
    const shown = logDetail(detail, ctx);
    return shown ? ctx.t("run.log.noDataDetail", { file, detail: shown }) : ctx.t("run.log.noData", { file });
  },
  "normalize.fileSkipped": ({ params: { file, cause } }, ctx) =>
    ctx.t("run.log.fileSkipped", { file, cause: fileCause(cause, ctx) }),
  "normalize.rowsUnparsed": ({ params: { file, sample } }, { t }) =>
    t("run.log.rowsUnparsed", { file, count: sampleCount(sample), sample: sampleText(sample, "; ", t) }),
  "normalize.skipRules": ({ params: { file, sample, held } }, { t }) => {
    const quoted = { ...sample, items: sample.items.map((item) => JSON.stringify(item)) };
    const options = { file, held, count: sampleCount(sample), sample: sampleText(quoted, ", ", t) };
    return held > 0 ? t("run.log.skipRulesHeld", options) : t("run.log.skipRules", options);
  },
  "normalize.countMismatch": ({ params: { file, counted, returned } }, { t }) =>
    t("run.log.countMismatch", { file, counted, returned, missing: counted - returned }),
  "normalize.wholeUnits": ({ params }, { t }) => t("run.log.wholeUnits", params),
  "normalize.droppedCents": ({ params }, { t }) => t("run.log.droppedCents", params),
  "normalize.done": ({ params }, { t }) => t("run.log.normalized", params),
  "history.payoff": ({ params: { resolved, total, duplicates } }, { t }) =>
    duplicates > 0
      ? t("run.log.payoffDuplicates", { resolved, total, count: duplicates })
      : t("run.log.payoff", { resolved, total }),
  "categorize.resuming": ({ params }, { t }) => t("run.log.resuming", params),
  "categorize.droppedRows": ({ params: { sample } }, { t }) =>
    t("run.log.droppedRows", { count: sampleCount(sample), sample: sampleText(sample, "; ", t) }),
  "categorize.nothingToDo": (_, { t }) => t("run.log.nothingToDo"),
  "categorize.transfers": ({ params }, { t }) => t("run.log.transfers", params),
  "categorize.batchFailed": ({ params: { batch, count, cause } }, ctx) =>
    ctx.t("run.log.batchFailed", { batch, count, cause: batchCause(cause, ctx) }),
  "categorize.transferBatchFailed": ({ params: { count, cause } }, ctx) =>
    ctx.t("run.log.transferBatchFailed", { count, cause: batchCause(cause, ctx) }),
  "categorize.stopped": (_, { t }) => t("run.log.categorizeStopped"),
  stopped: (_, { t }) => t("run.log.stopped"),

  "read.noSources": (_, { t }) => t("errors.noSources"),
  "enrich.noStaging": (_, { t }) => t("errors.noStaging"),
  "normalize.fileFailed": ({ params: { file, cause } }, ctx) =>
    ctx.t("errors.fileFailed", { file, cause: fileCause(cause, ctx) }),
  "categorize.noneLanded": ({ params: { count, cause } }, ctx) =>
    cause
      ? ctx.t("errors.noneLanded", { count, cause: batchCause(cause, ctx) })
      : ctx.t("errors.noneLandedNoCause", { count }),
  deadEnd: ({ params: { kind, provider } }, { t, ollamaBaseUrl }) =>
    kind === "unreachable" && provider === "ollama"
      ? t("errors.ollamaUnreachable", { url: ollamaOrigin(ollamaBaseUrl) })
      : t(DEAD_END_KEYS[kind], { provider: PROVIDER_LABELS[provider] }),
  failed: ({ params }, { t }) => t("errors.failed", { detail: errorText(params.detail, t) }),
};

export function importNoticeText(notice: ImportNotice, ctx: NoticeContext): string {
  const render = RENDERERS[notice.code] as (notice: ImportNotice, ctx: NoticeContext) => string;
  return render(notice, ctx);
}

export function useImportNoticeText({ withDetail = false }: { withDetail?: boolean } = {}): (notice: ImportNotice) => string {
  const { t } = useTranslation(["import", "common"]);
  const ollamaBaseUrl = useIntelligenceStore((s) => s.config.ollama.baseUrl);
  return useCallback(
    (notice: ImportNotice) => importNoticeText(notice, { t, ollamaBaseUrl, withDetail }),
    [t, ollamaBaseUrl, withDetail],
  );
}
