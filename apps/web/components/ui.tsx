"use client";

export function Panel({ title, children, right }: { title: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <section className="rounded-[18px] border border-slate-700/70 bg-[#0b1530] p-5 shadow-[0_12px_28px_rgba(2,6,23,0.55)]">
      <div className="mb-3 flex items-center justify-between border-b border-slate-700/50 pb-2">
        <h2 className="text-[31px] text-base font-extrabold text-white md:text-lg">{title}</h2>
        {right}
      </div>
      {children}
    </section>
  );
}

export function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`rounded-[18px] border border-slate-700/70 bg-[#0b1530] p-5 ${className}`}>{children}</div>;
}

export function SectionPanel({
  title,
  subtitle,
  children,
  right
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  right?: React.ReactNode;
}) {
  return (
    <Panel right={right} title={title}>
      {subtitle ? <p className="mb-3 text-sm text-slate-300">{subtitle}</p> : null}
      {children}
    </Panel>
  );
}

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`w-full rounded-xl border border-slate-600/80 bg-[#0f1b36] px-3 py-2 text-sm font-medium text-slate-100 outline-none placeholder:text-slate-400 focus:border-cyan-400 focus:ring-2 focus:ring-cyan-500/35 ${
        props.className ?? ""
      }`}
    />
  );
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={`w-full rounded-xl border border-slate-600/80 bg-[#0f1b36] px-3 py-2 text-sm font-medium text-slate-100 outline-none focus:border-cyan-400 focus:ring-2 focus:ring-cyan-500/35 ${
        props.className ?? ""
      }`}
    />
  );
}

export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={`w-full rounded-xl border border-slate-600/80 bg-[#0f1b36] px-3 py-2 text-sm font-medium text-slate-100 outline-none placeholder:text-slate-400 focus:border-cyan-400 focus:ring-2 focus:ring-cyan-500/35 ${
        props.className ?? ""
      }`}
    />
  );
}

export function Button({
  children,
  variant = "primary",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "danger" }) {
  const cls =
    variant === "primary"
      ? "border-green-400/70 bg-[#22c55e] text-[#021014] hover:bg-[#2dd96b]"
      : variant === "danger"
        ? "border-red-400/70 bg-[#991b1b] text-white hover:bg-[#b91c1c]"
        : "border-slate-500 bg-[#23314f] text-slate-100 hover:bg-[#2f3f63]";
  return (
    <button
      {...props}
      className={`rounded-[12px] border px-4 py-2 text-sm font-bold shadow-[0_2px_10px_rgba(2,6,23,0.35)] transition ${cls} disabled:cursor-not-allowed disabled:opacity-50 ${
        props.className ?? ""
      }`}
      type={props.type ?? "button"}
    >
      {children}
    </button>
  );
}

export function RoleBadge({ role }: { role: string }) {
  const color =
    role === "OWNER"
      ? "bg-purple-500/20 text-purple-100 border-purple-400/70"
      : role === "ADMIN"
        ? "bg-blue-500/20 text-blue-100 border-blue-400/70"
        : role === "VIEW_ONLY"
          ? "bg-slate-700/60 text-slate-100 border-slate-500"
          : "bg-emerald-500/20 text-emerald-100 border-emerald-400/60";
  return <span className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${color}`}>{role}</span>;
}

export function Badge({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "neutral" | "green" | "purple" | "red" }) {
  const cls =
    tone === "green"
      ? "border-green-400/70 bg-green-500/20 text-green-100"
      : tone === "purple"
        ? "border-purple-400/70 bg-purple-500/20 text-purple-100"
        : tone === "red"
          ? "border-red-400/70 bg-red-500/20 text-red-100"
          : "border-slate-500 bg-slate-700/60 text-slate-100";
  return <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${cls}`}>{children}</span>;
}

export function Modal({
  open,
  title,
  children,
  onClose
}: {
  open: boolean;
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4">
      <div className="w-full max-w-lg rounded-[18px] border border-slate-600 bg-[#0f1b36] p-5 shadow-[0_18px_32px_rgba(2,6,23,0.75)]">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-lg font-bold text-white">{title}</h3>
          <Button onClick={onClose} variant="secondary">
            Close
          </Button>
        </div>
        {children}
      </div>
    </div>
  );
}
