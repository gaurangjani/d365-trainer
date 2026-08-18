"use client";

import { useState, useRef } from "react";
import ReactMarkdown from "react-markdown";

const EXAMPLES = [
  "Post an approved expense report",
  "Set up a vendor invoice matching policy",
  "Create a new fixed asset and run depreciation",
  "Configure a purchase order approval workflow",
];

function GuideReadout({ text }: { text: string }) {
  const blocks = text.split(/\n(?=## )/g).filter(Boolean);

  return (
    <div className="space-y-6">
      {blocks.map((block, i) => {
        const lines = block.trim().split("\n");
        const heading = lines[0].replace(/^##\s*/, "");
        const body = lines.slice(1).join("\n").trim();

        return (
          <div key={i} className={i > 0 ? "pt-6 border-t border-steel/30" : ""}>
            <div className="flex items-center gap-2 mb-2.5">
              <span className="text-amber font-mono text-xs tracking-widest">
                {String(i + 1).padStart(2, "0")}
              </span>
              <h3 className="font-display text-sm tracking-wide uppercase text-sky">
                {heading}
              </h3>
            </div>
            <div className="text-[15px] leading-relaxed text-[#dbe2ea]">
              <ReactMarkdown
                components={{
                  p: ({ children }) => <p className="mb-3">{children}</p>,
                  ul: ({ children }) => <ul className="list-disc mb-3 space-y-2 pl-6">{children}</ul>,
                  ol: ({ children }) => <ol className="list-decimal mb-3 space-y-2 pl-6">{children}</ol>,
                  li: ({ children }) => <li className="text-[15px]">{children}</li>,
                  strong: ({ children }) => <strong className="font-semibold text-white">{children}</strong>,
                  em: ({ children }) => <em className="italic">{children}</em>,
                  a: ({ href, children }) => (
                    <a href={href} target="_blank" rel="noreferrer" className="text-sky underline hover:text-white">
                      {children}
                    </a>
                  ),
                  code: ({ children }) => <code className="bg-navy/60 px-1.5 py-0.5 rounded text-sm font-mono">{children}</code>,
                }}
              >
                {body}
              </ReactMarkdown>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function Home() {
  const [question, setQuestion] = useState("");
  const [guide, setGuide] = useState<string | null>(null);
  const [sources, setSources] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const outputRef = useRef<HTMLDivElement>(null);

  async function handleTrain() {
    setError(null);
    setGuide(null);
    setSources([]);
    setLoading(true);
    try {
      const res = await fetch("/api/train", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Something went wrong.");
      } else {
        setGuide(data.guide);
        setSources(Array.isArray(data.sources) ? data.sources : []);
        setTimeout(() => outputRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 100);
      }
    } catch (e: any) {
      setError(e?.message || "Network error — please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function handleCopy() {
    if (!guide) return;
    await navigator.clipboard.writeText(guide);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <main className="min-h-screen px-5 py-12 sm:py-16">
      <div className="mx-auto max-w-5xl">
        {/* Header */}
        <div className="mb-10">
          <p className="font-mono text-xs tracking-[0.2em] text-steellight uppercase mb-3">
            D365 Finance &amp; Operations · Training
          </p>
          <h1 className="font-display text-4xl sm:text-5xl font-semibold text-white blink-caret">
            D365 Trainer
          </h1>
          <p className="mt-3 text-steellight text-[15px] max-w-xl">
            Ask about any task or process in Dynamics 365 Finance &amp; Operations. This app
            connects directly to the official Microsoft Learn MCP server, searches real
            documentation before answering, then returns a structured, step-by-step training
            guide — ready to copy into your own notes or a client-facing guide.
          </p>
        </div>

        {/* Input console */}
        <div className="rounded-lg border border-steel/40 bg-navy console-surface overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-steel/40 bg-slate">
            <div className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-[#3E4C59]" />
              <span className="h-2.5 w-2.5 rounded-full bg-[#3E4C59]" />
              <span className="h-2.5 w-2.5 rounded-full bg-amber" />
            </div>
            <span className="font-mono text-xs text-steellight">question.txt</span>
          </div>
          <textarea
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="e.g. Post an approved expense report"
            rows={4}
            className="w-full resize-y bg-transparent px-4 py-4 font-mono text-[13px] leading-relaxed text-[#c9d4de] outline-none"
          />
        </div>

        {/* Example chips */}
        <div className="mt-3 flex flex-wrap gap-2">
          {EXAMPLES.map((ex) => (
            <button
              key={ex}
              onClick={() => setQuestion(ex)}
              className="rounded-full border border-steel/40 px-3 py-1 font-mono text-xs text-steellight transition hover:border-sky hover:text-sky"
            >
              {ex}
            </button>
          ))}
        </div>

        {/* Action row */}
        <div className="mt-5 flex items-center gap-3">
          <button
            onClick={handleTrain}
            disabled={loading || question.trim().length < 3}
            className="inline-flex items-center gap-2 rounded-md bg-amber px-5 py-2.5 font-mono text-sm font-medium text-ink transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {loading ? (
              <>
                <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-ink/30 border-t-ink" />
                Searching Microsoft Learn…
              </>
            ) : (
              <>$ train</>
            )}
          </button>
          <button
            onClick={() => {
              setQuestion("");
              setGuide(null);
              setError(null);
            }}
            className="font-mono text-sm text-steellight transition hover:text-white"
          >
            clear
          </button>
        </div>

        {/* Error */}
        {error && (
          <div className="mt-6 rounded-md border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300 fade-in">
            {error}
          </div>
        )}

        {/* Output */}
        {guide && (
          <div ref={outputRef} className="mt-8 fade-in">
            <div className="flex items-center justify-between mb-3">
              <p className="font-mono text-xs tracking-[0.2em] text-steellight uppercase">
                Training Guide
              </p>
              <button
                onClick={handleCopy}
                className="font-mono text-xs text-sky transition hover:text-white"
              >
                {copied ? "copied ✓" : "copy output"}
              </button>
            </div>
            <div className="readout rounded-lg border border-steel/40 bg-slate px-6 py-6">
              <GuideReadout text={guide} />
            </div>

            {sources.length > 0 && (
              <div className="mt-6 pt-6 border-t border-steel/30">
                <p className="font-mono text-xs tracking-[0.15em] text-steellight uppercase mb-3">
                  Sources consulted
                </p>
                <div className="text-[15px] leading-relaxed text-[#dbe2ea] space-y-2">
                  {sources.map((url, idx) => (
                    <div key={url} className="flex items-start gap-2">
                      <span className="text-amber font-mono text-xs mt-0.5">•</span>
                      <a
                        href={url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-sky underline hover:text-white break-all"
                      >
                        {url}
                      </a>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        <p className="mt-12 text-xs text-steel">
          Each guide is generated live: this app connects to the official Microsoft Learn MCP
          server (learn.microsoft.com/api/mcp), lets the model search and fetch real
          documentation, and only cites URLs it actually retrieved. Documentation and product
          behavior can change — re-run a question if it's been a while since you last generated a
          guide for that task.
        </p>

        {/* Footer disclaimer */}
        <div className="mt-12 pt-8 border-t border-steel/30">
          <div className="space-y-3 text-xs text-steel">
            <p>
              <strong className="text-steellight">⚠️ Usage Limit:</strong> Maximum 50 questions/scenarios per day per IP address. This helps us manage server load on free infrastructure.
            </p>
            <p>
              <strong className="text-steellight">🔒 Privacy Notice:</strong> Do not submit personal information, confidential data, or sensitive business details. This app uses free AI models in the background — treat it as a public service. Do not paste real employee names, financial data, or proprietary information.
            </p>
            <p className="mt-4">
              Want more? Get professional D365 Finance training and consulting at{" "}
              <a
                href="https://d365finance.uk"
                target="_blank"
                rel="noreferrer"
                className="text-sky hover:text-white underline font-mono"
              >
                d365finance.uk
              </a>
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}
