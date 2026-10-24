import "./style.css";

import { Link, Outlet } from "react-router";

export const metadata = {
  title: { default: "Todos", template: "%s · Todos" },
  description: "A framestack app",
};

/** The document shell shared by every page. */
export default function Layout() {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
      </head>
      <body>
        <nav>
          <Link to="/">Todos</Link>
          <a href="/api/openapi">OpenAPI</a>
        </nav>
        <main>
          <Outlet />
        </main>
      </body>
    </html>
  );
}
