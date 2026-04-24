import type { PropsWithChildren, ReactNode } from "react";

export function Page(props: PropsWithChildren<{ title: ReactNode; subtitle?: ReactNode; aside?: ReactNode }>) {
  return (
    <section className="page">
      <header className="page-header">
        <div>
          <h2>{props.title}</h2>
          {props.subtitle ? <div className="page-subtitle">{props.subtitle}</div> : null}
        </div>
        {props.aside}
      </header>
      <div className="page-body">{props.children}</div>
    </section>
  );
}
