import { createFileRoute } from "@tanstack/react-router";
import { ImportNotice } from "../../../components/import-notice";

export const Route = createFileRoute("/budget/_shell/import")({
  component: ImportNotice,
});
