import type { ReactNode } from "react";

type PanelProps = {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
};

export function Panel({ title, description, actions, footer, children }: PanelProps) {
  return (
    <section className="overflow-hidden rounded-lg border border-muted-subtle bg-canvas-sheet">
      <header className="flex flex-wrap items-center gap-x-12 gap-y-6 border-b border-muted-subtle px-16 py-12">
        <h2 className="heading-5-semi-bold text-base">{title}</h2>
        {description && <span className="body-3 text-muted">{description}</span>}
        {actions && <div className="ml-auto flex items-center gap-8">{actions}</div>}
      </header>
      {children}
      {footer && <footer className="flex flex-wrap gap-x-16 gap-y-4 border-t border-muted-subtle px-16 py-10 body-4 text-muted">{footer}</footer>}
    </section>
  );
}
