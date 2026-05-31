import { createFileRoute, useSearch } from "@tanstack/react-router";
import { ImportScreen } from "@/components/import/import-screen";

export const Route = createFileRoute("/budget/_shell/import")({
  component: ImportView,
});

function ImportView() {
  const { path, name } = useSearch({ from: "/budget" });

  return <ImportScreen budgetPath={path} budgetName={name} />;
}
