import React, { memo, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';

function MarkdownMessage({ content, streaming = false }) {
  const text = useMemo(() => (typeof content === 'string' ? content : ''), [content]);

  const markdownComponents = useMemo(() => {
    if (streaming) {
      return {
        code({ children, ...props }) {
          return (
            <code {...props}>
              {children}
            </code>
          );
        },
        pre({ children, ...props }) {
          return (
            <pre {...props}>
              {children}
            </pre>
          );
        }
      };
    }

    return {
      code({ node, inline, className, children, ...props }) {
        const match = /language-(\w+)/.exec(className || '');
        if (inline) {
          return (
            <code className={className} {...props}>
              {children}
            </code>
          );
        }
        return (
          <SyntaxHighlighter
            language={match?.[1] ?? 'text'}
            style={oneDark}
            wrapLongLines
            {...props}
          >
            {String(children).replace(/\n$/, '')}
          </SyntaxHighlighter>
        );
      },
      pre({ children }) {
        return <>{children}</>;
      },
      a({ node, ...props }) {
        return <a {...props} target="_blank" rel="noreferrer" />;
      }
    };
  }, [streaming]);

  return (
    <ReactMarkdown
      className="markdown-body"
      remarkPlugins={[remarkGfm]}
      components={markdownComponents}
    >
      {text}
    </ReactMarkdown>
  );
}

export default memo(MarkdownMessage);
