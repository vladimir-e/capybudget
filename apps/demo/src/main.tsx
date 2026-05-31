import ReactDOM from "react-dom/client";
import { Analytics } from "@vercel/analytics/react";
import "./styles.css";
import { routeTree } from "./routeTree.gen";
import { bootstrapApp } from "@/bootstrap";
import { MobileNotice } from "./components/mobile-notice";

void bootstrapApp(routeTree);

// Demo-only chrome in a sibling root, clear of the shared app's full-height layout.
ReactDOM.createRoot(document.getElementById("demo-overlays")!).render(
  <>
    <MobileNotice />
    <Analytics />
  </>,
);
