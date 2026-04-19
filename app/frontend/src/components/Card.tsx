import type { PropsWithChildren, ReactNode } from "react";

export function Card(props: PropsWithChildren<{ title?: string; extra?: ReactNode }>) {
  return (
    <section className="card">
      {props.title ? (
        <header className="card-header">
          <h3>{props.title}</h3>
          {props.extra}
        </header>
      ) : null}
      {props.children}
    </section>
  );
}
