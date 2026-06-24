import { createFileRoute } from "@tanstack/react-router";
import { AccountView } from "@/components/budget/account-view";

export const Route = createFileRoute("/budget/_shell/account/$accountId")({
  component: AccountRoute,
});

function AccountRoute() {
  const { accountId } = Route.useParams();
  return <AccountView accountId={accountId} />;
}
