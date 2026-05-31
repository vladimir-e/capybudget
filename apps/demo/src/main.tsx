import ReactDOM from "react-dom/client";
import { Analytics } from "@vercel/analytics/react";
import "./styles.css";
import { routeTree } from "./routeTree.gen";
import { bootstrapApp } from "@/bootstrap";
import { MobileNotice } from "./components/mobile-notice";

void bootstrapApp(routeTree);

// Demo-only chrome rendered beside the shared app root: visit-counting
// analytics and the small-screen notice. Both are fixed-position overlays, so
// living in a sibling root keeps them clear of the app's full-height layout.
ReactDOM.createRoot(document.getElementById("demo-overlays")!).render(
  <>
    <MobileNotice />
    <Analytics />
  </>,
);
