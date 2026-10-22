import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

const components: Components = {
  p: ({ children }) => <p className="mt-8 body-3 text-base first:mt-0">{children}</p>,
  h1: ({ children }) => <h4 className="mt-12 body-1-semi-bold text-base first:mt-0">{children}</h4>,
  h2: ({ children }) => <h4 className="mt-12 body-1-semi-bold text-base first:mt-0">{children}</h4>,
  h3: ({ children }) => <h5 className="mt-10 body-2-semi-bold text-base first:mt-0">{children}</h5>,
  h4: ({ children }) => <h5 className="mt-10 body-2-semi-bold text-base first:mt-0">{children}</h5>,
  strong: ({ children }) => <strong className="body-3-semi-bold">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  ul: ({ children }) => <ul className="mt-6 list-disc pl-20 body-3 text-base first:mt-0">{children}</ul>,
  ol: ({ children }) => <ol className="mt-6 list-decimal pl-20 body-3 text-base first:mt-0">{children}</ol>,
  li: ({ children }) => <li className="mt-2 [&>p]:mt-0">{children}</li>,
  a: ({ children, href }) => (
    <a href={href} target="_blank" rel="noreferrer" className="text-interactive underline underline-offset-2">
      {children}
    </a>
  ),
  blockquote: ({ children }) => <blockquote className="mt-8 border-l-2 border-muted pl-12 text-muted">{children}</blockquote>,
  hr: () => <hr className="my-12 border-muted-subtle" />,
  pre: ({ children }) => <pre className="mt-8 overflow-x-auto rounded-sm bg-muted px-12 py-10 body-4 text-base [&>code]:bg-transparent [&>code]:p-0">{children}</pre>,
  code: ({ children }) => <code className="rounded-xs bg-muted px-4 py-1 body-4 text-base">{children}</code>,
  table: ({ children }) => (
    <div className="mt-8 overflow-x-auto">
      <table className="w-full border-collapse body-4 text-base">{children}</table>
    </div>
  ),
  th: ({ children }) => <th className="border-b border-muted px-8 py-4 text-left body-4-semi-bold text-muted">{children}</th>,
  td: ({ children }) => <td className="border-b border-muted-subtle px-8 py-4 align-top">{children}</td>,
};

export function Markdown({ children }: { children: string }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
      {children}
    </ReactMarkdown>
  );
}
